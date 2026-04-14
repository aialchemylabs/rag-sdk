import { describe, expect, it, vi } from 'vitest';
import type { ValidatedConfig } from '../config/validate.js';
import type { OcrAdapter } from '../ocr/mistralAdapter.js';
import type { EmbeddingService } from '../embeddings/service.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import type { JobManager } from '../jobs/jobManager.js';
import type { DocumentStore } from '../documents/documentStore.types.js';
import { RagSdkError } from '../errors/ragError.js';
import { IngestService } from './service.js';

vi.mock('../telemetry/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock('../utils/id.js', () => ({
	generateId: (prefix?: string) => (prefix ? `${prefix}_mock-id` : 'mock-id'),
}));

vi.mock('../normalize/normalizer.js', () => ({
	normalizeOcrResult: vi.fn(() => ({
		documentId: 'doc_mock-id',
		sourceName: 'test.pdf',
		mimeType: 'application/pdf',
		pageCount: 1,
		pages: [
			{
				pageIndex: 0,
				markdown: 'Page content',
				text: 'Page content',
				characterCount: 12,
				hasImages: false,
				hasTablesOnPage: false,
				warnings: [],
			},
		],
		tables: [],
		links: [],
		warnings: [],
		providerMetadata: { provider: 'mistral', model: 'mistral-ocr-latest', processingTimeMs: 50, rawPageCount: 1 },
		totalCharacters: 12,
		createdAt: '2026-01-01T00:00:00.000Z',
	})),
}));

vi.mock('../chunking/chunker.js', () => ({
	chunkDocument: vi.fn(() => ({
		documentId: 'doc_mock-id',
		chunks: [
			{
				chunkId: 'chk_1',
				documentId: 'doc_mock-id',
				content: 'Page content',
				tokenCount: 3,
				metadata: {
					documentId: 'doc_mock-id',
					chunkId: 'chk_1',
					chunkIndex: 0,
					sourceName: 'test.pdf',
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					embeddingVersion: 'openai:text-embedding-3-small',
					ocrProvider: 'mistral',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				embedding: [0.1, 0.2, 0.3],
			},
		],
		totalChunks: 1,
		totalTokens: 3,
		averageTokensPerChunk: 3,
	})),
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
		retrieval: { topK: 10, scoreThreshold: 0 },
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

function makeMocks() {
	const ocr: OcrAdapter = {
		processFile: vi.fn(async () => ({
			pages: [{ index: 0, markdown: 'Page content', images: [], dimensions: null }],
			model: 'mistral-ocr-latest',
			usageInfo: { pagesProcessed: 1 },
		})),
		processBuffer: vi.fn(async () => ({
			pages: [{ index: 0, markdown: 'Page content', images: [], dimensions: null }],
			model: 'mistral-ocr-latest',
			usageInfo: { pagesProcessed: 1 },
		})),
		processUrl: vi.fn(async () => ({
			pages: [{ index: 0, markdown: 'Page content', images: [], dimensions: null }],
			model: 'mistral-ocr-latest',
			usageInfo: { pagesProcessed: 1 },
		})),
	};

	const embeddings = {
		embedTexts: vi.fn(async () => [[0.1, 0.2, 0.3]]),
		embedChunks: vi.fn(async (chunks: unknown[]) =>
			chunks.map((c) => ({ ...(c as Record<string, unknown>), embedding: [0.1, 0.2, 0.3] })),
		),
		getVersionLabel: vi.fn(() => 'openai:text-embedding-3-small'),
	} as unknown as EmbeddingService;

	const vector = {
		ensureCollection: vi.fn(async () => {}),
		upsertChunks: vi.fn(async () => ({ upserted: 1 })),
		search: vi.fn(async () => []),
		hybridSearch: vi.fn(async () => []),
	} as unknown as QdrantAdapter;

	const telemetry = {
		emit: vi.fn(),
		metric: vi.fn(),
		trackDuration: vi.fn(),
		withOverride: vi.fn(function (this: unknown) {
			return this as TelemetryEmitter;
		}),
	} as unknown as TelemetryEmitter;

	const jobManager = {
		createJob: vi.fn(async (_docId: string, _fileName: string, _tenantId: string, _task: unknown) => ({
			jobId: 'job_mock-id',
			documentId: 'doc_mock-id',
			sourceName: 'test.pdf',
			tenantId: 'tenant-a',
			status: 'pending',
			progress: 0,
			createdAt: '2026-01-01T00:00:00.000Z',
		})),
	} as unknown as JobManager;

	const documentStore = {
		put: vi.fn(async () => {}),
		get: vi.fn(async () => null),
		list: vi.fn(async () => []),
		delete: vi.fn(async () => false),
		update: vi.fn(async () => {}),
	} as unknown as DocumentStore;

	return { ocr, embeddings, vector, telemetry, jobManager, documentStore };
}

describe('IngestService', () => {
	describe('input validation', () => {
		it('rejects unsupported mime types', async () => {
			const mocks = makeMocks();
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await expect(service.file('/path/to/file.xyz')).rejects.toThrow(RagSdkError);
		});

		it('rejects files exceeding max size', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig({ maxFileSizeBytes: 10 }),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
			);

			const bigBuffer = Buffer.alloc(100);
			await expect(service.buffer(bigBuffer, 'big.pdf')).rejects.toThrow(RagSdkError);
		});

		it('requires tenantId', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig({ defaults: { processingMode: 'hybrid', tenantId: undefined as unknown as string } }),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
			);

			await expect(service.text('hello')).rejects.toThrow('tenantId is required');
		});
	});

	describe('text ingestion', () => {
		it('ingests text without calling OCR', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig(),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
				undefined,
				mocks.documentStore,
			);

			const result = await service.text('Hello world content');

			expect(result.status).toBe('completed');
			expect(result.documentId).toBeTruthy();
			expect(result.sourceName).toBe('text-input.txt');
			expect(mocks.ocr.processFile).not.toHaveBeenCalled();
			expect(mocks.ocr.processBuffer).not.toHaveBeenCalled();
			expect(mocks.ocr.processUrl).not.toHaveBeenCalled();
			expect(mocks.embeddings.embedChunks).toHaveBeenCalled();
			expect(mocks.vector.upsertChunks).toHaveBeenCalled();
		});
	});

	describe('async ingestion', () => {
		it('returns jobId and pending status when async is true', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig(),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
				mocks.jobManager,
			);

			const result = await service.text('Some text', { async: true });

			expect(result.status).toBe('pending');
			expect(result.jobId).toBe('job_mock-id');
			expect(result.chunksIndexed).toBe(0);
			expect(mocks.jobManager.createJob).toHaveBeenCalled();
		});

		it('falls back to sync when no jobManager is provided', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig(),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
				undefined,
			);

			const result = await service.text('Some text', { async: true });

			expect(result.status).toBe('completed');
			expect(result.jobId).toBeUndefined();
		});
	});

	describe('telemetry', () => {
		it('emits ingestion_started and ingestion_completed events', async () => {
			const mocks = makeMocks();
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.text('Hello');

			const emitCalls = (mocks.telemetry.emit as ReturnType<typeof vi.fn>).mock.calls;
			const eventNames = emitCalls.map((c: unknown[]) => c[0]);
			expect(eventNames).toContain('ingestion_started');
			expect(eventNames).toContain('ingestion_completed');
		});

		it('emits per-stage _started and _completed events for chunking, embeddings, and qdrant_upsert', async () => {
			const mocks = makeMocks();
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.text('Hello world content');

			const eventNames = (mocks.telemetry.emit as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
			expect(eventNames).toEqual(
				expect.arrayContaining([
					'ingestion_started',
					'chunking_started',
					'chunking_completed',
					'embeddings_started',
					'embeddings_completed',
					'qdrant_upsert_started',
					'qdrant_upsert_completed',
					'ingestion_completed',
				]),
			);
		});

		it('emits embeddings_failed and terminal ingestion_failed when embedChunks throws', async () => {
			const mocks = makeMocks();
			(mocks.embeddings.embedChunks as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('embed boom'));
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await expect(service.text('Hello')).rejects.toThrow('embed boom');

			const emitCalls = (mocks.telemetry.emit as ReturnType<typeof vi.fn>).mock.calls;
			const eventNames = emitCalls.map((c: unknown[]) => c[0]);
			expect(eventNames).toContain('embeddings_started');
			expect(eventNames).toContain('embeddings_failed');
			expect(eventNames).toContain('ingestion_failed');
			expect(eventNames).not.toContain('embeddings_completed');

			const embeddingsFailedCall = emitCalls.find((c) => c[0] === 'embeddings_failed');
			expect((embeddingsFailedCall?.[1] as { error?: string })?.error).toBe('embed boom');
		});

		it('emits qdrant_upsert_failed when the upsert step throws', async () => {
			const mocks = makeMocks();
			(mocks.vector.upsertChunks as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('qdrant boom'));
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await expect(service.text('Hello')).rejects.toThrow('qdrant boom');

			const eventNames = (mocks.telemetry.emit as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
			expect(eventNames).toContain('qdrant_upsert_started');
			expect(eventNames).toContain('qdrant_upsert_failed');
			expect(eventNames).toContain('ingestion_failed');
			expect(eventNames).not.toContain('qdrant_upsert_completed');
		});

		it('routes events to a per-call telemetry override in addition to the client handler', async () => {
			const mocks = makeMocks();
			const overrideEvents: string[] = [];
			(mocks.telemetry.withOverride as ReturnType<typeof vi.fn>).mockImplementationOnce(
				(handler: (event: { type: string }) => void) => ({
					emit: vi.fn((type: string, data: unknown) => {
						handler({ type });
						(mocks.telemetry.emit as ReturnType<typeof vi.fn>)(type, data);
					}),
					metric: vi.fn(),
					trackDuration: vi.fn(),
					withOverride: vi.fn(),
				}),
			);
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await service.text('Hello', {
				telemetry: {
					onEvent: (event) => {
						overrideEvents.push(event.type);
					},
				},
			});

			expect(overrideEvents).toContain('ingestion_started');
			expect(overrideEvents).toContain('ingestion_completed');
		});
	});

	describe('external documentId', () => {
		it('uses options.documentId when provided instead of generating one', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig(),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
				undefined,
				mocks.documentStore,
			);

			const result = await service.text('Hello', { documentId: 'platform-uuid-123' });

			expect(result.documentId).toBe('platform-uuid-123');
			expect(mocks.documentStore.put).toHaveBeenCalledWith(
				expect.objectContaining({ documentId: 'platform-uuid-123' }),
			);
		});

		it('rejects empty string documentId', async () => {
			const mocks = makeMocks();
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await expect(service.text('Hello', { documentId: '' })).rejects.toThrow('non-empty');
		});

		it('rejects documentId over 256 chars', async () => {
			const mocks = makeMocks();
			const service = new IngestService(makeConfig(), mocks.ocr, mocks.embeddings, mocks.vector, mocks.telemetry);

			await expect(service.text('Hello', { documentId: 'x'.repeat(257) })).rejects.toThrow('256 characters');
		});

		it('threads options.documentId into async jobs', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig(),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
				mocks.jobManager,
			);

			const result = await service.text('Hello', { async: true, documentId: 'platform-uuid-async' });

			expect(result.documentId).toBe('platform-uuid-async');
			expect(mocks.jobManager.createJob).toHaveBeenCalledWith(
				'platform-uuid-async',
				expect.any(String),
				expect.any(String),
				expect.any(Function),
			);
		});
	});

	describe('embedding dimension validation', () => {
		it('throws a clear error when configured vectorSize does not match provider output', async () => {
			const mocks = makeMocks();
			// Mocked embedChunks returns length-3 embeddings; configure vectorSize as 1024 to force mismatch
			const service = new IngestService(
				makeConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'test-key',
						distanceMetric: 'cosine',
						versionLabel: 'openai:text-embedding-3-small',
						vectorSize: 1024,
					},
				}),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
			);

			await expect(service.text('Hello')).rejects.toThrow(/Embedding dimension mismatch.*1024.*3/);
			// Must not reach the upsert stage
			expect(mocks.vector.upsertChunks).not.toHaveBeenCalled();
		});

		it('allows ingestion when configured vectorSize matches provider output', async () => {
			const mocks = makeMocks();
			const service = new IngestService(
				makeConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'test-key',
						distanceMetric: 'cosine',
						versionLabel: 'openai:text-embedding-3-small',
						vectorSize: 3,
					},
				}),
				mocks.ocr,
				mocks.embeddings,
				mocks.vector,
				mocks.telemetry,
			);

			const result = await service.text('Hello');
			expect(result.status).toBe('completed');
			expect(mocks.vector.upsertChunks).toHaveBeenCalled();
		});
	});
});
