import type { ValidatedConfig } from '../config/validate.js';
import type { ChunkMetadata } from '../chunking/chunk.types.js';
import type { EmbeddingService } from '../embeddings/service.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import { createLogger } from '../telemetry/logger.js';
import type { DocumentListFilters, DocumentMetadataPatch, DocumentRecord } from './documentRecord.types.js';
import type { DocumentStore } from './documentStore.types.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';

function requireTenantId(tenantId: string | undefined): string {
	if (!tenantId) {
		throw new RagSdkError(
			RagErrorCode.VALIDATION_MISSING_TENANT,
			'tenantId is required. Provide it explicitly or set defaults.tenantId in config.',
		);
	}
	return tenantId;
}

const logger = createLogger('documents');

type ReindexChunkMetadataInput = Pick<
	ChunkMetadata,
	'sourceName' | 'pageStart' | 'pageEnd' | 'processingMode' | 'ocrProvider'
> &
	Partial<Pick<ChunkMetadata, 'sectionTitle' | 'domainId' | 'tags' | 'mimeType' | 'customMetadata'>>;

export class DocumentsService {
	constructor(
		private readonly config: ValidatedConfig,
		private readonly vector: QdrantAdapter,
		private readonly embeddings: EmbeddingService,
		private readonly documentStore: DocumentStore,
		_telemetry: TelemetryEmitter,
	) {}

	async get(documentId: string, tenantId?: string): Promise<DocumentRecord | null> {
		const resolvedTenant = requireTenantId(tenantId ?? this.config.defaults.tenantId);

		// Primary path: read from the document store
		const stored = await this.documentStore.get(documentId, resolvedTenant);
		if (stored) {
			return this.storedToRecord(stored);
		}

		// Fallback: reconstruct from chunks (handles pre-migration documents)
		const results = await this.vector.getByDocumentId(documentId, resolvedTenant);
		if (results.length === 0) return null;

		logger.warn('Document not in document store, reconstructing from chunks. Re-ingest for full support.', {
			documentId,
		});
		return this.buildDocumentRecordLegacy(documentId, results);
	}

	async list(filters?: DocumentListFilters): Promise<DocumentRecord[]> {
		const resolvedTenant = requireTenantId(filters?.tenantId ?? this.config.defaults.tenantId);

		// Primary path: read from the document store
		const storedDocs = await this.documentStore.list({
			tenantId: resolvedTenant,
			domainId: filters?.domainId,
			tags: filters?.tags,
			limit: filters?.limit,
			offset: filters?.offset,
		});

		if (storedDocs.length > 0) {
			return storedDocs.map((d) => this.storedToRecord(d));
		}

		// Fallback: reconstruct from chunks (handles pre-migration documents)
		const must: Record<string, unknown>[] = [];
		if (filters?.domainId) must.push({ key: 'domainId', match: { value: filters.domainId } });
		if (filters?.tags && filters.tags.length > 0) {
			for (const tag of filters.tags) {
				must.push({ key: 'tags', match: { value: tag } });
			}
		}
		const qdrantFilter: Record<string, unknown> = must.length > 0 ? { must } : {};

		const { results } = await this.vector.scroll(
			qdrantFilter,
			resolvedTenant,
			filters?.limit ?? 100,
			filters?.offset !== undefined ? String(filters.offset) : undefined,
		);

		if (results.length === 0) return [];

		logger.warn('No documents in document store, reconstructing from chunks. Re-ingest for full support.');

		const grouped = new Map<string, typeof results>();
		for (const result of results) {
			const docId = result.payload.documentId as string;
			const existing = grouped.get(docId) ?? [];
			existing.push(result);
			grouped.set(docId, existing);
		}

		const documents: DocumentRecord[] = [];
		for (const [docId, chunks] of grouped) {
			documents.push(this.buildDocumentRecordLegacy(docId, chunks));
		}

		return documents;
	}

	async delete(documentId: string, tenantId?: string): Promise<{ deleted: number }> {
		const resolvedTenant = requireTenantId(tenantId ?? this.config.defaults.tenantId);

		const result = await this.vector.deleteByDocumentId(documentId, resolvedTenant);
		await this.documentStore.delete(documentId, resolvedTenant);

		logger.info('Document deleted', { documentId, deleted: result.deleted });
		return result;
	}

	async reindex(
		documentId: string,
		chunks: Array<{ chunkId: string; content: string; metadata: Record<string, unknown> }>,
		tenantId?: string,
	): Promise<{ reindexed: number }> {
		const resolvedTenant = requireTenantId(tenantId ?? this.config.defaults.tenantId);
		const now = new Date().toISOString();

		// Validate metadata before any destructive operation.
		const validatedChunks = chunks.map((chunk, idx) => ({
			chunkId: chunk.chunkId,
			content: chunk.content,
			metadata: this.validateReindexChunkMetadata(documentId, chunk.chunkId, idx, chunk.metadata),
		}));

		// Re-embed and re-index.
		const texts = chunks.map((c) => c.content);
		const embeddings = await this.embeddings.embedTexts(texts);

		const newChunks = validatedChunks.map((chunk, idx) => ({
			chunkId: chunk.chunkId,
			documentId,
			content: chunk.content,
			tokenCount: Math.ceil(chunk.content.length / 4),
			metadata: {
				documentId,
				chunkId: chunk.chunkId,
				chunkIndex: idx,
				sourceName: chunk.metadata.sourceName,
				pageStart: chunk.metadata.pageStart,
				pageEnd: chunk.metadata.pageEnd,
				...(chunk.metadata.sectionTitle !== undefined && { sectionTitle: chunk.metadata.sectionTitle }),
				tenantId: resolvedTenant,
				...(chunk.metadata.domainId !== undefined && { domainId: chunk.metadata.domainId }),
				...(chunk.metadata.tags !== undefined && { tags: chunk.metadata.tags }),
				...(chunk.metadata.mimeType !== undefined && { mimeType: chunk.metadata.mimeType }),
				...(chunk.metadata.customMetadata !== undefined && { customMetadata: chunk.metadata.customMetadata }),
				processingMode: chunk.metadata.processingMode,
				embeddingVersion: this.embeddings.getVersionLabel(),
				ocrProvider: chunk.metadata.ocrProvider,
				createdAt: now,
			} as ChunkMetadata,
			embedding: embeddings[idx],
		}));

		// Delete existing chunks after validation/embedding succeeds.
		await this.vector.deleteByDocumentId(documentId, resolvedTenant);

		await this.vector.ensureCollection(
			resolvedTenant,
			embeddings[0]?.length ?? 1536,
			this.config.embeddings.distanceMetric,
		);

		const { upserted } = await this.vector.upsertChunks(newChunks, resolvedTenant);

		// Update document store with new counts
		const totalTokens = newChunks.reduce((sum, c) => sum + c.tokenCount, 0);
		await this.documentStore.update(documentId, resolvedTenant, {
			chunkCount: upserted,
			totalTokens,
			embeddingVersion: this.embeddings.getVersionLabel(),
			sourceName: newChunks[0]?.metadata.sourceName,
			processingMode: newChunks[0]?.metadata.processingMode,
			domainId: newChunks[0]?.metadata.domainId,
			tags: newChunks[0]?.metadata.tags,
			updatedAt: now,
		});

		logger.info('Document reindexed', { documentId, reindexed: upserted });
		return { reindexed: upserted };
	}

	private validateReindexChunkMetadata(
		documentId: string,
		chunkId: string,
		chunkIndex: number,
		metadata: Record<string, unknown>,
	): ReindexChunkMetadataInput {
		const formatReceived = (value: unknown): string => {
			if (value === undefined) return 'undefined';
			if (value === null) return 'null';
			if (typeof value === 'string') return value;
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		};

		const requireNonEmptyString = (field: string): string => {
			const value = metadata[field];
			if (typeof value !== 'string' || value.trim().length === 0) {
				throw new RagSdkError(
					RagErrorCode.VALIDATION_INVALID_INPUT,
					`reindex chunk "${chunkId}" is missing required metadata field "${field}"`,
					{
						details: { documentId, chunkId, chunkIndex, field, received: formatReceived(value) },
					},
				);
			}
			return value;
		};

		const requireNonNegativeInteger = (field: string): number => {
			const value = metadata[field];
			if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
				throw new RagSdkError(
					RagErrorCode.VALIDATION_INVALID_INPUT,
					`reindex chunk "${chunkId}" has invalid metadata field "${field}" (must be a non-negative integer)`,
					{
						details: { documentId, chunkId, chunkIndex, field, received: formatReceived(value) },
					},
				);
			}
			return value;
		};

		const pageStart = requireNonNegativeInteger('pageStart');
		const pageEnd = requireNonNegativeInteger('pageEnd');
		if (pageEnd < pageStart) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_INVALID_INPUT,
				`reindex chunk "${chunkId}" has invalid page range: pageEnd must be >= pageStart`,
				{
					details: { documentId, chunkId, chunkIndex, pageStart, pageEnd },
				},
			);
		}

		const sectionTitle =
			metadata.sectionTitle === undefined
				? undefined
				: typeof metadata.sectionTitle === 'string'
					? metadata.sectionTitle
					: undefined;

		const domainId =
			metadata.domainId === undefined
				? undefined
				: typeof metadata.domainId === 'string'
					? metadata.domainId
					: undefined;

		let tags: string[] | undefined;
		if (metadata.tags !== undefined) {
			if (!Array.isArray(metadata.tags) || !metadata.tags.every((tag) => typeof tag === 'string')) {
				throw new RagSdkError(
					RagErrorCode.VALIDATION_INVALID_INPUT,
					`reindex chunk "${chunkId}" has invalid metadata field "tags" (must be string[])`,
					{
						details: {
							documentId,
							chunkId,
							chunkIndex,
							field: 'tags',
							received: formatReceived(metadata.tags),
						},
					},
				);
			}
			tags = metadata.tags;
		}

		const mimeType =
			metadata.mimeType === undefined
				? undefined
				: typeof metadata.mimeType === 'string'
					? metadata.mimeType
					: undefined;

		const customMetadataCandidate = metadata.customMetadata ?? metadata.metadata;
		let customMetadata: Record<string, unknown> | undefined;
		if (customMetadataCandidate !== undefined) {
			if (
				typeof customMetadataCandidate !== 'object' ||
				customMetadataCandidate === null ||
				Array.isArray(customMetadataCandidate)
			) {
				throw new RagSdkError(
					RagErrorCode.VALIDATION_INVALID_INPUT,
					`reindex chunk "${chunkId}" has invalid metadata field "customMetadata"`,
					{
						details: {
							documentId,
							chunkId,
							chunkIndex,
							field: 'customMetadata',
							received: formatReceived(customMetadataCandidate),
						},
					},
				);
			}
			customMetadata = customMetadataCandidate as Record<string, unknown>;
		}

		return {
			sourceName: requireNonEmptyString('sourceName'),
			pageStart,
			pageEnd,
			processingMode: requireNonEmptyString('processingMode'),
			ocrProvider: requireNonEmptyString('ocrProvider'),
			...(sectionTitle !== undefined && { sectionTitle }),
			...(domainId !== undefined && { domainId }),
			...(tags !== undefined && { tags }),
			...(mimeType !== undefined && { mimeType }),
			...(customMetadata !== undefined && { customMetadata }),
		};
	}

	async updateMetadata(documentId: string, patch: DocumentMetadataPatch, tenantId?: string): Promise<void> {
		const resolvedTenant = requireTenantId(tenantId ?? this.config.defaults.tenantId);

		const existingResults = await this.vector.getByDocumentId(documentId, resolvedTenant);
		if (existingResults.length === 0) {
			throw new RagSdkError(RagErrorCode.VALIDATION_INVALID_INPUT, `Document not found: ${documentId}`, {
				details: { documentId },
			});
		}

		const payloadPatch: Record<string, unknown> = {};
		if (patch.tags !== undefined) payloadPatch.tags = patch.tags;
		if (patch.domainId !== undefined) payloadPatch.domainId = patch.domainId;
		if (patch.metadata !== undefined) payloadPatch.metadata = patch.metadata;

		await this.vector.setPayload(documentId, payloadPatch, resolvedTenant);

		// Update document store
		await this.documentStore.update(documentId, resolvedTenant, {
			...(patch.tags !== undefined && { tags: patch.tags }),
			...(patch.domainId !== undefined && { domainId: patch.domainId }),
			...(patch.metadata !== undefined && { metadata: patch.metadata }),
			updatedAt: new Date().toISOString(),
		});

		logger.info('Document metadata updated', { documentId, patch: Object.keys(patch) });
	}

	/** Convert a StoredDocument to the public DocumentRecord type. */
	private storedToRecord(stored: import('./documentStore.types.js').StoredDocument): DocumentRecord {
		return {
			documentId: stored.documentId,
			sourceName: stored.sourceName,
			mimeType: stored.mimeType,
			pageCount: stored.pageCount,
			chunkCount: stored.chunkCount,
			totalTokens: stored.totalTokens,
			tenantId: stored.tenantId,
			domainId: stored.domainId,
			tags: stored.tags,
			embeddingVersion: stored.embeddingVersion,
			processingMode: stored.processingMode,
			createdAt: stored.createdAt,
			updatedAt: stored.updatedAt,
			metadata: stored.metadata,
		};
	}

	/** Legacy fallback: reconstruct a DocumentRecord from chunk payloads. */
	private buildDocumentRecordLegacy(
		documentId: string,
		chunks: Array<{ id: string; score: number; payload: Record<string, unknown> }>,
	): DocumentRecord {
		const first = (chunks[0] as (typeof chunks)[number]).payload;
		const totalTokens = chunks.reduce((sum, c) => {
			const content = c.payload.content as string;
			return sum + Math.ceil(content.length / 4);
		}, 0);

		const pages = chunks.flatMap((c) => [c.payload.pageStart as number, c.payload.pageEnd as number]);
		const minPage = Math.min(...pages);
		const maxPage = Math.max(...pages);

		return {
			documentId,
			sourceName: first.sourceName as string,
			mimeType: (first.mimeType as string | undefined) ?? 'unknown',
			pageCount: maxPage - minPage + 1,
			chunkCount: chunks.length,
			totalTokens,
			tenantId: first.tenantId as string | undefined,
			domainId: first.domainId as string | undefined,
			tags: first.tags as string[] | undefined,
			embeddingVersion: first.embeddingVersion as string,
			processingMode: first.processingMode as string,
			createdAt: first.createdAt as string,
			updatedAt: first.createdAt as string,
			metadata: first.metadata as Record<string, unknown> | undefined,
		};
	}
}
