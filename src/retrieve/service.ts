import type { ValidatedConfig } from '../config/validate.js';
import type { EmbeddingService } from '../embeddings/service.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import type { CitationAnchor } from './citation.types.js';
import type { HybridRetrieveOptions, RetrieveMatch, RetrieveOptions, RetrieveResult } from './retrieve.types.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';

export class RetrieveService {
	constructor(
		private readonly config: ValidatedConfig,
		private readonly embeddings: EmbeddingService,
		private readonly vector: QdrantAdapter,
		private readonly telemetry: TelemetryEmitter,
	) {}

	async query(query: string, options?: RetrieveOptions): Promise<RetrieveResult> {
		const startTime = Date.now();
		const topK = options?.topK ?? this.config.retrieval.topK;
		const scoreThreshold = options?.scoreThreshold ?? this.config.retrieval.scoreThreshold;
		const tenantId = options?.security?.tenantId ?? this.config.defaults.tenantId;
		if (!tenantId) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_MISSING_TENANT,
				'tenantId is required. Provide it via options.security.tenantId or set defaults.tenantId in config.',
			);
		}

		try {
			const [queryEmbedding] = await this.embeddings.embedTexts([query]);

			if (!queryEmbedding) {
				throw new RagSdkError(RagErrorCode.EMBEDDING_PROVIDER_ERROR, 'Failed to generate query embedding');
			}

			const results = await this.vector.search(queryEmbedding, {
				topK,
				scoreThreshold,
				tenantId,
				filters: options?.filters,
			});

			const matches = results.filter((r) => r.score >= scoreThreshold).map((r) => this.toRetrieveMatch(r));

			const searchTimeMs = Date.now() - startTime;

			this.telemetry.emit('retrieval_executed', {
				durationMs: searchTimeMs,
				tenantId,
				metadata: { query: query.substring(0, 100), matchCount: matches.length, searchType: 'dense' },
			});

			return {
				query,
				matches,
				totalMatches: matches.length,
				searchTimeMs,
				searchType: 'dense',
			};
		} catch (err) {
			if (err instanceof RagSdkError) throw err;
			throw new RagSdkError(
				RagErrorCode.VECTOR_SEARCH_FAILED,
				`Retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true, cause: err instanceof Error ? err : undefined },
			);
		}
	}

	async hybrid(query: string, options?: HybridRetrieveOptions): Promise<RetrieveResult> {
		const hybridConfig = this.config.retrieval.hybrid;
		if (!hybridConfig?.enabled) {
			throw new RagSdkError(
				RagErrorCode.NOT_CONFIGURED,
				'Hybrid search is not enabled. Set retrieval.hybrid.enabled = true in config.',
			);
		}

		const startTime = Date.now();
		const topK = options?.topK ?? this.config.retrieval.topK;
		const scoreThreshold = options?.scoreThreshold ?? this.config.retrieval.scoreThreshold;
		const fusionAlpha = options?.fusionAlpha ?? hybridConfig.fusionAlpha;
		const tenantId = options?.security?.tenantId ?? this.config.defaults.tenantId;
		if (!tenantId) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_MISSING_TENANT,
				'tenantId is required. Provide it via options.security.tenantId or set defaults.tenantId in config.',
			);
		}

		try {
			const [queryEmbedding] = await this.embeddings.embedTexts([query]);

			if (!queryEmbedding) {
				throw new RagSdkError(RagErrorCode.EMBEDDING_PROVIDER_ERROR, 'Failed to generate query embedding');
			}

			const results = await this.vector.hybridSearch(queryEmbedding, query, {
				topK,
				scoreThreshold,
				tenantId,
				fusionAlpha,
				filters: options?.filters,
			});

			const matches = results.filter((r) => r.score >= scoreThreshold).map((r) => this.toRetrieveMatch(r));

			const searchTimeMs = Date.now() - startTime;

			this.telemetry.emit('retrieval_executed', {
				durationMs: searchTimeMs,
				tenantId,
				metadata: { query: query.substring(0, 100), matchCount: matches.length, searchType: 'hybrid' },
			});

			return {
				query,
				matches,
				totalMatches: matches.length,
				searchTimeMs,
				searchType: 'hybrid',
			};
		} catch (err) {
			if (err instanceof RagSdkError) throw err;
			throw new RagSdkError(
				RagErrorCode.VECTOR_SEARCH_FAILED,
				`Hybrid retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true, cause: err instanceof Error ? err : undefined },
			);
		}
	}

	private toRetrieveMatch(result: { id: string; score: number; payload: Record<string, unknown> }): RetrieveMatch {
		const payload = result.payload;
		const citation: CitationAnchor = {
			documentId: payload.documentId as string,
			sourceName: payload.sourceName as string,
			chunkId: payload.chunkId as string,
			pageStart: payload.pageStart as number,
			pageEnd: payload.pageEnd as number,
			excerpt: (payload.content as string)?.substring(0, 200),
		};

		return {
			chunkId: payload.chunkId as string,
			documentId: payload.documentId as string,
			content: payload.content as string,
			score: result.score,
			metadata: {
				documentId: payload.documentId as string,
				chunkId: payload.chunkId as string,
				chunkIndex: payload.chunkIndex as number,
				sourceName: payload.sourceName as string,
				pageStart: payload.pageStart as number,
				pageEnd: payload.pageEnd as number,
				sectionTitle: payload.sectionTitle as string | undefined,
				tenantId: payload.tenantId as string | undefined,
				domainId: payload.domainId as string | undefined,
				tags: payload.tags as string[] | undefined,
				processingMode: payload.processingMode as string,
				embeddingVersion: payload.embeddingVersion as string,
				ocrProvider: payload.ocrProvider as string,
				createdAt: payload.createdAt as string,
			},
			citation,
		};
	}
}
