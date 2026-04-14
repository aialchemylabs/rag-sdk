import { describe, expect, it, vi } from 'vitest';
import type { ValidatedConfig } from '../config/validate.js';
import type { EmbeddingService } from '../embeddings/service.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import { RetrieveService } from './service.js';

vi.mock('../telemetry/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

function makeConfig(overrides?: Partial<ValidatedConfig>): ValidatedConfig {
	return {
		mistral: { apiKey: 'test-key', model: 'mistral-ocr-latest' },
		qdrant: { url: 'http://localhost:6333', collection: 'test' },
		embeddings: {
			provider: 'openai',
			model: 'text-embedding-3-small',
			apiKey: 'test-key',
			distanceMetric: 'cosine',
			versionLabel: 'openai:text-embedding-3-small',
		},
		chunking: {
			targetTokens: 512,
			maxTokens: 1024,
			overlapTokens: 64,
			headingAware: true,
			preservePageBoundaries: false,
			preserveTables: true,
		},
		retrieval: { topK: 5, scoreThreshold: 0.5 },
		answering: {
			provider: 'openai',
			model: 'gpt-4o',
			apiKey: 'test-key',
			maxTokens: 2048,
			temperature: 0.1,
			noCitationPolicy: 'refuse',
		},
		telemetry: { enabled: true },
		security: { redactPii: false },
		defaults: { processingMode: 'hybrid', tenantId: 'tenant-a' },
		jobs: { concurrency: 5, timeoutMs: 300_000 },
		maxFileSizeBytes: 50 * 1024 * 1024,
		...overrides,
	};
}

function makeSearchResult(id: string, score: number, content: string) {
	return {
		id,
		score,
		payload: {
			documentId: 'doc-1',
			sourceName: 'test.pdf',
			chunkId: id,
			chunkIndex: 0,
			pageStart: 0,
			pageEnd: 0,
			content,
			processingMode: 'hybrid',
			embeddingVersion: 'openai:text-embedding-3-small',
			ocrProvider: 'mistral',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	};
}

function makeMocks() {
	const embeddings = {
		embedTexts: vi.fn(async () => [[0.1, 0.2, 0.3]]),
		embedChunks: vi.fn(async () => []),
		getVersionLabel: vi.fn(() => 'openai:text-embedding-3-small'),
	} as unknown as EmbeddingService;

	const vector = {
		ensureCollection: vi.fn(async () => {}),
		upsertChunks: vi.fn(async () => ({ upserted: 0 })),
		search: vi.fn(async () => [
			makeSearchResult('chk-1', 0.9, 'Relevant content'),
			makeSearchResult('chk-2', 0.7, 'Somewhat relevant'),
		]),
		hybridSearch: vi.fn(async () => [makeSearchResult('chk-1', 0.85, 'Hybrid result')]),
	} as unknown as QdrantAdapter;

	const telemetry = {
		emit: vi.fn(),
		metric: vi.fn(),
		trackDuration: vi.fn(),
		withOverride: vi.fn(function (this: unknown) {
			return this as TelemetryEmitter;
		}),
	} as unknown as TelemetryEmitter;

	return { embeddings, vector, telemetry };
}

describe('RetrieveService', () => {
	describe('dense retrieval (query)', () => {
		it('calls embedding service and vector adapter correctly', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			const result = await service.query('What is RAG?');

			expect(mocks.embeddings.embedTexts).toHaveBeenCalledWith(['What is RAG?']);
			expect(mocks.vector.search).toHaveBeenCalledWith(
				[0.1, 0.2, 0.3],
				expect.objectContaining({
					topK: 5,
					scoreThreshold: 0.5,
					tenantId: 'tenant-a',
				}),
			);
			expect(result.searchType).toBe('dense');
			expect(result.query).toBe('What is RAG?');
			expect(result.matches).toHaveLength(2);
		});

		it('uses options to override topK and scoreThreshold', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.query('query', { topK: 20, scoreThreshold: 0.8 });

			expect(mocks.vector.search).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ topK: 20, scoreThreshold: 0.8 }),
			);
		});

		it('requires tenantId', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(
				makeConfig({ defaults: { processingMode: 'hybrid', tenantId: undefined as unknown as string } }),
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
			);

			await expect(service.query('hello')).rejects.toThrow('tenantId is required');
		});

		it('uses tenantId from security context when provided', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.query('query', { security: { tenantId: 'tenant-b' } });

			expect(mocks.vector.search).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ tenantId: 'tenant-b' }),
			);
		});
	});

	describe('filters pass-through', () => {
		it('passes tags, documentIds, domainId filters to vector search', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.query('query', {
				filters: {
					tags: ['finance', 'report'],
					documentIds: ['doc-1', 'doc-2'],
					domainId: 'domain-x',
				},
			});

			expect(mocks.vector.search).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({
					filters: {
						tags: ['finance', 'report'],
						documentIds: ['doc-1', 'doc-2'],
						domainId: 'domain-x',
					},
				}),
			);
		});
	});

	describe('score threshold filtering', () => {
		it('filters out results below the score threshold', async () => {
			const mocks = makeMocks();
			(mocks.vector.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
				makeSearchResult('chk-1', 0.9, 'Good match'),
				makeSearchResult('chk-2', 0.3, 'Below threshold'),
			]);
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			const result = await service.query('query');

			expect(result.matches).toHaveLength(1);
			expect(result.matches[0]?.score).toBe(0.9);
		});
	});

	describe('empty results', () => {
		it('returns empty matches array when no results found', async () => {
			const mocks = makeMocks();
			(mocks.vector.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			const result = await service.query('obscure query');

			expect(result.matches).toEqual([]);
			expect(result.totalMatches).toBe(0);
		});
	});

	describe('hybrid retrieval', () => {
		function makeHybridConfig(overrides?: Record<string, unknown>) {
			return makeConfig({
				retrieval: {
					topK: 5,
					scoreThreshold: 0.5,
					hybrid: { enabled: true, fusionAlpha: 0.6 },
				},
				...overrides,
			});
		}

		describe('basic hybrid search', () => {
			it('calls embedding service for dense vector', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('hybrid query');

				expect(mocks.embeddings.embedTexts).toHaveBeenCalledWith(['hybrid query']);
			});

			it('calls vector adapter hybridSearch (not regular search)', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('hybrid query');

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					[0.1, 0.2, 0.3],
					'hybrid query',
					expect.objectContaining({
						topK: 5,
						scoreThreshold: 0.5,
						tenantId: 'tenant-a',
						fusionAlpha: 0.6,
					}),
				);
				expect(mocks.vector.search).not.toHaveBeenCalled();
			});

			it('returns properly structured RetrieveResult with matches', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('hybrid query');

				expect(result.query).toBe('hybrid query');
				expect(result.searchType).toBe('hybrid');
				expect(result.matches).toHaveLength(1);
				expect(result.totalMatches).toBe(1);
				expect(typeof result.searchTimeMs).toBe('number');
				expect(result.matches[0]).toEqual(
					expect.objectContaining({
						chunkId: 'chk-1',
						documentId: 'doc-1',
						content: 'Hybrid result',
						score: 0.85,
					}),
				);
				expect(result.matches[0]?.citation).toEqual({
					documentId: 'doc-1',
					sourceName: 'test.pdf',
					chunkId: 'chk-1',
					pageStart: 0,
					pageEnd: 0,
					excerpt: 'Hybrid result',
				});
			});

			it('emits telemetry with searchType hybrid', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('hybrid query');

				expect(mocks.telemetry.emit).toHaveBeenCalledWith(
					'retrieval_executed',
					expect.objectContaining({
						tenantId: 'tenant-a',
						metadata: expect.objectContaining({ searchType: 'hybrid' }),
					}),
				);
			});
		});

		describe('not enabled', () => {
			it('throws NOT_CONFIGURED when hybrid search is not enabled', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Hybrid search is not enabled');
			});

			it('throws NOT_CONFIGURED when hybrid config is missing', async () => {
				const mocks = makeMocks();
				const config = makeConfig({ retrieval: { topK: 5, scoreThreshold: 0.5 } });
				const service = new RetrieveService(config, mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Hybrid search is not enabled');
			});

			it('throws NOT_CONFIGURED when hybrid.enabled is false', async () => {
				const mocks = makeMocks();
				const config = makeConfig({
					retrieval: { topK: 5, scoreThreshold: 0.5, hybrid: { enabled: false, fusionAlpha: 0.5 } },
				});
				const service = new RetrieveService(config, mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Hybrid search is not enabled');
			});
		});

		describe('options handling', () => {
			it('respects topK override', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { topK: 20 });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ topK: 20 }),
				);
			});

			it('respects scoreThreshold override', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { scoreThreshold: 0.8 });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ scoreThreshold: 0.8 }),
				);
			});

			it('uses fusionAlpha from options when provided', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { fusionAlpha: 0.9 });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ fusionAlpha: 0.9 }),
				);
			});

			it('falls back to config fusionAlpha when not in options', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query');

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ fusionAlpha: 0.6 }),
				);
			});

			it('passes filter options (tags, documentIds, domainId)', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', {
					filters: {
						tags: ['finance', 'report'],
						documentIds: ['doc-1', 'doc-2'],
						domainId: 'domain-x',
					},
				});

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({
						filters: {
							tags: ['finance', 'report'],
							documentIds: ['doc-1', 'doc-2'],
							domainId: 'domain-x',
						},
					}),
				);
			});

			it('passes combined topK, scoreThreshold, and fusionAlpha overrides', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { topK: 10, scoreThreshold: 0.7, fusionAlpha: 0.3 });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ topK: 10, scoreThreshold: 0.7, fusionAlpha: 0.3 }),
				);
			});
		});

		describe('tenant isolation', () => {
			it('uses tenantId from options', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { security: { tenantId: 'tenant-b' } });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ tenantId: 'tenant-b' }),
				);
			});

			it('falls back to config default tenantId', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query');

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ tenantId: 'tenant-a' }),
				);
			});

			it('throws VALIDATION_MISSING_TENANT when no tenantId', async () => {
				const mocks = makeMocks();
				const config = makeHybridConfig({
					defaults: { processingMode: 'hybrid', tenantId: undefined as unknown as string },
				});
				const service = new RetrieveService(config, mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('tenantId is required');
			});

			it('prefers options tenantId over config default', async () => {
				const mocks = makeMocks();
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await service.hybrid('query', { security: { tenantId: 'tenant-override' } });

				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith(
					expect.any(Array),
					'query',
					expect.objectContaining({ tenantId: 'tenant-override' }),
				);
			});
		});

		describe('score threshold filtering', () => {
			it('filters out results below scoreThreshold', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
					makeSearchResult('chk-1', 0.9, 'Good match'),
					makeSearchResult('chk-2', 0.3, 'Below threshold'),
				]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('query');

				expect(result.matches).toHaveLength(1);
				expect(result.matches[0]?.score).toBe(0.9);
				expect(result.totalMatches).toBe(1);
			});

			it('returns empty matches when all results are below threshold', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
					makeSearchResult('chk-1', 0.2, 'Low score'),
					makeSearchResult('chk-2', 0.1, 'Very low'),
				]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('query');

				expect(result.matches).toEqual([]);
				expect(result.totalMatches).toBe(0);
			});

			it('applies options scoreThreshold override for filtering', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
					makeSearchResult('chk-1', 0.9, 'Great match'),
					makeSearchResult('chk-2', 0.7, 'Good match'),
					makeSearchResult('chk-3', 0.6, 'Okay match'),
				]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('query', { scoreThreshold: 0.75 });

				expect(result.matches).toHaveLength(1);
				expect(result.matches[0]?.score).toBe(0.9);
			});
		});

		describe('edge cases', () => {
			it('handles empty query string', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('');

				expect(mocks.embeddings.embedTexts).toHaveBeenCalledWith(['']);
				expect(mocks.vector.hybridSearch).toHaveBeenCalledWith([0.1, 0.2, 0.3], '', expect.any(Object));
				expect(result.matches).toEqual([]);
			});

			it('returns empty matches when vector search returns no results', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('query with no results');

				expect(result.matches).toEqual([]);
				expect(result.totalMatches).toBe(0);
				expect(result.searchType).toBe('hybrid');
			});

			it('handles single result', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
					makeSearchResult('chk-only', 0.95, 'Only match'),
				]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				const result = await service.hybrid('very specific query');

				expect(result.matches).toHaveLength(1);
				expect(result.totalMatches).toBe(1);
				expect(result.matches[0]?.content).toBe('Only match');
				expect(result.matches[0]?.score).toBe(0.95);
			});

			it('wraps non-RagSdkError as VECTOR_SEARCH_FAILED', async () => {
				const mocks = makeMocks();
				(mocks.vector.hybridSearch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network timeout'));
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Hybrid retrieval failed: network timeout');
			});

			it('re-throws RagSdkError without wrapping', async () => {
				const mocks = makeMocks();
				const originalError = new RagSdkError(RagErrorCode.EMBEDDING_PROVIDER_ERROR, 'Embedding failed');
				(mocks.embeddings.embedTexts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Embedding failed');
			});

			it('throws EMBEDDING_PROVIDER_ERROR when embedding returns undefined', async () => {
				const mocks = makeMocks();
				(mocks.embeddings.embedTexts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([undefined]);
				const service = new RetrieveService(makeHybridConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

				await expect(service.hybrid('query')).rejects.toThrow('Failed to generate query embedding');
			});
		});
	});

	describe('result mapping', () => {
		it('populates citation anchors from search results', async () => {
			const mocks = makeMocks();
			const service = new RetrieveService(makeConfig(), mocks.embeddings, mocks.vector, mocks.telemetry);

			const result = await service.query('query');

			const match = result.matches[0];
			expect(match?.citation).toEqual({
				documentId: 'doc-1',
				sourceName: 'test.pdf',
				chunkId: 'chk-1',
				pageStart: 0,
				pageEnd: 0,
				excerpt: 'Relevant content',
			});
			expect(match?.metadata.documentId).toBe('doc-1');
			expect(match?.content).toBe('Relevant content');
		});
	});
});
