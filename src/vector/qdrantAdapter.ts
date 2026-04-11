import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';
import type { Chunk } from '../chunking/chunk.types.js';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { encodeSparse } from './sparseEncoder.js';
import type { VectorSearchOptions, VectorSearchResult } from './vector.types.js';

const logger = createLogger('vector:qdrant');

const DISTANCE_MAP = {
	cosine: 'Cosine',
	euclid: 'Euclid',
	dot: 'Dot',
} as const;

const BATCH_SIZE = 100;

function toUuid(id: string): string {
	const hex = id.replace(/[^a-f0-9]/gi, '');
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
		return id;
	}
	const padded = hex.padEnd(32, '0').slice(0, 32);
	return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

function buildFilter(options: VectorSearchOptions): Record<string, unknown> | undefined {
	const must: Record<string, unknown>[] = [];

	if (options.tenantId) {
		must.push({ key: 'tenantId', match: { value: options.tenantId } });
	}

	if (options.filters?.documentIds?.length) {
		must.push({ key: 'documentId', match: { any: options.filters.documentIds } });
	}

	if (options.filters?.domainId) {
		must.push({ key: 'domainId', match: { value: options.filters.domainId } });
	}

	if (options.filters?.tags?.length) {
		for (const tag of options.filters.tags) {
			must.push({ key: 'tags', match: { value: tag } });
		}
	}

	if (options.filters?.metadata) {
		for (const [key, value] of Object.entries(options.filters.metadata)) {
			must.push({ key: `metadata.${key}`, match: { value } });
		}
	}

	if (must.length === 0) return undefined;
	return { must };
}

function mapScoredPoint(point: {
	id: string | number;
	score: number;
	payload?: Record<string, unknown> | null;
}): VectorSearchResult {
	return {
		id: String(point.id),
		score: point.score,
		payload: (point.payload as Record<string, unknown>) ?? {},
	};
}

function mapRecord(record: { id: string | number; payload?: Record<string, unknown> | null }): VectorSearchResult {
	return {
		id: String(record.id),
		score: 0,
		payload: (record.payload as Record<string, unknown>) ?? {},
	};
}

function isConnectionError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes('econnrefused') ||
			msg.includes('enotfound') ||
			msg.includes('timeout') ||
			msg.includes('fetch failed')
		);
	}
	return false;
}

function wrapError(error: unknown, code: RagErrorCode, message: string): RagSdkError {
	const cause = error instanceof Error ? error : new Error(String(error));

	if (isConnectionError(error)) {
		return new RagSdkError(RagErrorCode.VECTOR_CONNECTION_ERROR, `Qdrant connection failed: ${cause.message}`, {
			retryable: true,
			provider: 'qdrant',
			cause,
		});
	}

	return new RagSdkError(code, message, {
		retryable: false,
		provider: 'qdrant',
		cause,
	});
}

export class QdrantAdapter {
	private readonly client: QdrantClient;
	private readonly collectionPrefix: string;

	constructor(config: { url: string; apiKey?: string; collectionPrefix: string }) {
		this.client = new QdrantClient({
			url: config.url,
			apiKey: config.apiKey,
		});
		this.collectionPrefix = config.collectionPrefix;
	}

	private collectionName(tenantId: string): string {
		return `${this.collectionPrefix}_${tenantId}`;
	}

	async ensureCollection(
		tenantId: string,
		vectorSize: number,
		distanceMetric: 'cosine' | 'euclid' | 'dot',
	): Promise<void> {
		const name = this.collectionName(tenantId);
		try {
			const { exists } = await this.client.collectionExists(name);
			if (exists) {
				logger.debug('Collection already exists', { collection: name });
				return;
			}

			await this.client.createCollection(name, {
				vectors: {
					'': {
						size: vectorSize,
						distance: DISTANCE_MAP[distanceMetric],
					},
				},
				sparse_vectors: {
					text: {},
				},
			});

			logger.info('Created collection', { collection: name, vectorSize, distanceMetric });
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_CONNECTION_ERROR, `Failed to ensure collection "${name}": ${error}`);
		}
	}

	async upsertChunks(chunks: Chunk[], tenantId: string): Promise<{ upserted: number }> {
		const name = this.collectionName(tenantId);
		let totalUpserted = 0;

		try {
			for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
				const batch = chunks.slice(i, i + BATCH_SIZE);
				const points = batch.map((chunk) => {
					if (!chunk.embedding?.length) {
						throw new RagSdkError(RagErrorCode.VECTOR_UPSERT_FAILED, `Chunk "${chunk.chunkId}" has no embedding`, {
							provider: 'qdrant',
							details: { documentId: chunk.documentId },
						});
					}

					const sparse = encodeSparse(chunk.content);
					return {
						id: toUuid(chunk.chunkId),
						vector: {
							'': chunk.embedding,
							text: { indices: sparse.indices, values: sparse.values },
						},
						payload: {
							documentId: chunk.documentId,
							chunkId: chunk.chunkId,
							chunkIndex: chunk.metadata.chunkIndex,
							sourceName: chunk.metadata.sourceName,
							content: chunk.content,
							pageStart: chunk.metadata.pageStart,
							pageEnd: chunk.metadata.pageEnd,
							...(chunk.metadata.sectionTitle !== undefined && { sectionTitle: chunk.metadata.sectionTitle }),
							...(chunk.metadata.tenantId !== undefined && { tenantId: chunk.metadata.tenantId }),
							...(chunk.metadata.domainId !== undefined && { domainId: chunk.metadata.domainId }),
							...(chunk.metadata.tags?.length && { tags: chunk.metadata.tags }),
							...(chunk.metadata.mimeType !== undefined && { mimeType: chunk.metadata.mimeType }),
							...(chunk.metadata.customMetadata !== undefined && { metadata: chunk.metadata.customMetadata }),
							processingMode: chunk.metadata.processingMode,
							embeddingVersion: chunk.metadata.embeddingVersion,
							ocrProvider: chunk.metadata.ocrProvider,
							createdAt: chunk.metadata.createdAt,
						} as Record<string, unknown>,
					};
				});

				await this.client.upsert(name, { wait: true, points });
				totalUpserted += points.length;
			}

			logger.info('Upserted chunks', { collection: name, count: totalUpserted });
			return { upserted: totalUpserted };
		} catch (error) {
			if (error instanceof RagSdkError) throw error;
			throw wrapError(error, RagErrorCode.VECTOR_UPSERT_FAILED, `Failed to upsert chunks into "${name}": ${error}`);
		}
	}

	async search(embedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]> {
		const name = this.collectionName(options.tenantId);

		try {
			const results = await this.client.query(name, {
				query: embedding,
				filter: buildFilter(options),
				limit: options.topK,
				score_threshold: options.scoreThreshold,
				with_payload: true,
			});

			return (results.points ?? []).map(mapScoredPoint);
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_SEARCH_FAILED, `Search failed on "${name}": ${error}`);
		}
	}

	async hybridSearch(
		embedding: number[],
		query: string,
		options: VectorSearchOptions & { fusionAlpha?: number },
	): Promise<VectorSearchResult[]> {
		const name = this.collectionName(options.tenantId);
		const filter = buildFilter(options);
		const sparse = encodeSparse(query);

		const alpha = options.fusionAlpha ?? 0.5;
		const densePrefetchLimit = Math.ceil(options.topK * 2 * (1.5 - alpha));
		const sparsePrefetchLimit = Math.ceil(options.topK * 2 * (0.5 + alpha));

		try {
			const results = await this.client.query(name, {
				prefetch: [
					{
						query: embedding,
						limit: densePrefetchLimit,
						filter,
						score_threshold: options.scoreThreshold,
					},
					{
						query: { indices: sparse.indices, values: sparse.values },
						using: 'text',
						limit: sparsePrefetchLimit,
						filter,
					},
				],
				query: { fusion: 'rrf' },
				limit: options.topK,
				with_payload: true,
			});

			return (results.points ?? []).map(mapScoredPoint);
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_SEARCH_FAILED, `Hybrid search failed on "${name}": ${error}`);
		}
	}

	async deleteByDocumentId(documentId: string, tenantId: string): Promise<{ deleted: number }> {
		const name = this.collectionName(tenantId);

		try {
			const countBefore = await this.client.count(name, {
				filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
				exact: true,
			});

			await this.client.delete(name, {
				wait: true,
				filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
			});

			logger.info('Deleted by document ID', { collection: name, documentId, deleted: countBefore.count });
			return { deleted: countBefore.count };
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_DELETE_FAILED, `Delete by document ID failed on "${name}": ${error}`);
		}
	}

	async deleteByFilter(filter: Record<string, unknown>, tenantId: string): Promise<{ deleted: number }> {
		const name = this.collectionName(tenantId);

		try {
			const countBefore = await this.client.count(name, {
				filter: filter as Schemas['Filter'],
				exact: true,
			});

			await this.client.delete(name, {
				wait: true,
				filter: filter as Schemas['Filter'],
			});

			logger.info('Deleted by filter', { collection: name, deleted: countBefore.count });
			return { deleted: countBefore.count };
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_DELETE_FAILED, `Delete by filter failed on "${name}": ${error}`);
		}
	}

	async getByDocumentId(documentId: string, tenantId: string): Promise<VectorSearchResult[]> {
		const name = this.collectionName(tenantId);

		try {
			const result = await this.client.scroll(name, {
				filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
				with_payload: true,
				limit: 1000,
			});

			return result.points.map(mapRecord);
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_SEARCH_FAILED, `Get by document ID failed on "${name}": ${error}`);
		}
	}

	async scroll(
		filter: Record<string, unknown>,
		tenantId: string,
		limit = 100,
		offset?: string,
	): Promise<{ results: VectorSearchResult[]; nextOffset?: string }> {
		const name = this.collectionName(tenantId);

		try {
			const result = await this.client.scroll(name, {
				filter: filter as Schemas['Filter'],
				with_payload: true,
				limit,
				offset: offset ?? undefined,
			});

			return {
				results: result.points.map(mapRecord),
				nextOffset: result.next_page_offset != null ? String(result.next_page_offset) : undefined,
			};
		} catch (error) {
			throw wrapError(error, RagErrorCode.VECTOR_SEARCH_FAILED, `Scroll failed on "${name}": ${error}`);
		}
	}

	async setPayload(
		documentId: string,
		payload: Record<string, unknown>,
		tenantId: string,
	): Promise<{ updated: number }> {
		const name = this.collectionName(tenantId);
		const filter: Schemas['Filter'] = { must: [{ key: 'documentId', match: { value: documentId } }] };

		try {
			const countResult = await this.client.count(name, { filter, exact: true });

			await this.client.setPayload(name, {
				payload,
				filter,
				wait: true,
			});

			logger.info('Set payload by document ID', { collection: name, documentId, updated: countResult.count });
			return { updated: countResult.count };
		} catch (error) {
			throw wrapError(
				error,
				RagErrorCode.VECTOR_UPSERT_FAILED,
				`Set payload failed on "${name}" for document "${documentId}": ${error}`,
			);
		}
	}

	async healthcheck(): Promise<boolean> {
		try {
			await this.client.getCollections();
			return true;
		} catch {
			return false;
		}
	}
}
