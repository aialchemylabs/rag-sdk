import { resolveConfigFromEnv } from './config/resolve.js';
import { validateConfig } from './config/validate.js';
import { AnswerService } from './answer/service.js';
import { DocumentsService } from './documents/service.js';
import { InMemoryDocumentStore } from './documents/inMemoryDocumentStore.js';
import { EmbeddingService } from './embeddings/service.js';
import { RagErrorCode } from './errors/errorCodes.js';
import { RagSdkError } from './errors/ragError.js';
import { IngestService } from './ingest/service.js';
import { InMemoryJobStore } from './jobs/inMemoryStore.js';
import { JobManager } from './jobs/jobManager.js';
import { createEmbeddingProvider, createChatProvider } from './llmProviders/factory.js';
import { createMistralOcrAdapter } from './ocr/mistralAdapter.js';
import { RetrieveService } from './retrieve/service.js';
import { TelemetryEmitter } from './telemetry/emitter.js';
import { createLogger } from './telemetry/logger.js';
import type { AnswerOptions, AnswerResult } from './answer/answer.types.js';
import type { RagConfig } from './config/config.types.js';
import type { DocumentListFilters, DocumentMetadataPatch, DocumentRecord } from './documents/documentRecord.types.js';
import type { IngestOptions, IngestResult } from './ingest/ingest.types.js';
import type { JobListFilters, JobRecord } from './jobs/job.types.js';
import type { HybridRetrieveOptions, RetrieveOptions, RetrieveResult } from './retrieve/retrieve.types.js';
import { redactUrl } from './utils/redact.js';
import { QdrantAdapter } from './vector/qdrantAdapter.js';

const logger = createLogger('core');

declare const __SDK_VERSION__: string;
const SDK_VERSION = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';

/**
 * Main client interface returned by {@link createRag}.
 *
 * - **ingest** -- Ingest documents from files, buffers, URLs, or raw text.
 * - **documents** -- CRUD operations on ingested documents (get, list, delete, reindex, updateMetadata).
 * - **retrieve** -- Semantic similarity search over ingested chunks.
 * - **answer** -- Retrieve-then-generate: answers a question grounded in your documents.
 * - **jobs** -- Inspect and manage background ingest jobs.
 * - **healthcheck** -- Verify connectivity to backing services (Qdrant, etc.).
 * - **validateConfig** -- Re-validate the resolved configuration at runtime.
 * - **version** -- Returns the SDK version string.
 * - **close** -- Gracefully shuts down the client, cancelling running jobs and releasing resources.
 */
export interface RagClient {
	ingest: {
		file(filePath: string, options?: IngestOptions): Promise<IngestResult>;
		buffer(buffer: Buffer, fileName: string, options?: IngestOptions): Promise<IngestResult>;
		url(url: string, options?: IngestOptions): Promise<IngestResult>;
		text(text: string, options?: IngestOptions): Promise<IngestResult>;
	};
	documents: {
		get(documentId: string, tenantId?: string): Promise<DocumentRecord | null>;
		list(filters?: DocumentListFilters): Promise<DocumentRecord[]>;
		delete(documentId: string, tenantId?: string): Promise<{ deleted: number }>;
		reindex(
			documentId: string,
			chunks: Array<{ chunkId: string; content: string; metadata: Record<string, unknown> }>,
			tenantId?: string,
		): Promise<{ reindexed: number }>;
		updateMetadata(documentId: string, patch: DocumentMetadataPatch, tenantId?: string): Promise<void>;
	};
	retrieve: ((query: string, options?: RetrieveOptions) => Promise<RetrieveResult>) & {
		hybrid(query: string, options?: HybridRetrieveOptions): Promise<RetrieveResult>;
	};
	answer(query: string, options?: AnswerOptions): Promise<AnswerResult>;
	jobs: {
		get(jobId: string, tenantId: string): Promise<JobRecord | null>;
		list(filters?: JobListFilters): Promise<JobRecord[]>;
		cancel(jobId: string, tenantId: string): Promise<JobRecord>;
	};
	healthcheck(): Promise<{ status: 'ok' | 'degraded' | 'error'; details: Record<string, unknown> }>;
	validateConfig(): { valid: boolean; errors?: string[] };
	version(): string;
	/**
	 * Gracefully shuts down the RAG client.
	 *
	 * Cancels any running or queued ingest jobs via the JobManager and releases
	 * resources held by backing services. After calling `close()`, the client
	 * should not be used for further operations.
	 */
	close(): Promise<void>;
}

/**
 * Factory function that initializes and returns a configured RAG client.
 *
 * Resolves environment variables, validates the configuration, and wires up
 * all internal services (embedding, vector store, OCR, job manager, etc.).
 *
 * @param config - SDK configuration including API keys, Qdrant connection, embedding/answering provider settings, and optional tuning knobs.
 * @returns A fully initialized {@link RagClient} ready for ingestion, retrieval, and answering.
 *
 * @example
 * ```ts
 * import { createRag } from '@ai-alchemy-labs/rag-sdk';
 *
 * const rag = await createRag({
 *   mistral: { apiKey: process.env.MISTRAL_API_KEY! },
 *   qdrant: { url: 'http://localhost:6333', collection: 'my-docs' },
 *   embeddings: { provider: 'openai', model: 'text-embedding-3-small', apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * const result = await rag.ingest.file('./report.pdf');
 * const hits = await rag.retrieve('quarterly revenue');
 * ```
 */
export async function createRag(config: RagConfig): Promise<RagClient> {
	// Step 1: Resolve env vars
	const resolvedConfig = resolveConfigFromEnv(config);

	// Step 2: Validate
	const validatedConfig = validateConfig(resolvedConfig);

	// Step 3: Initialize services
	const telemetry = new TelemetryEmitter({
		enabled: validatedConfig.telemetry.enabled,
		onEvent: validatedConfig.telemetry.onEvent as ((event: unknown) => void) | undefined,
		onMetric: validatedConfig.telemetry.onMetric as ((metric: unknown) => void) | undefined,
	});
	const ocr = createMistralOcrAdapter(validatedConfig.mistral.apiKey);

	const embeddingProvider = await createEmbeddingProvider({
		provider: validatedConfig.embeddings.provider,
		model: validatedConfig.embeddings.model,
		apiKey: validatedConfig.embeddings.apiKey,
		baseUrl: validatedConfig.embeddings.baseUrl,
	});

	const embeddingService = new EmbeddingService(embeddingProvider, {
		model: validatedConfig.embeddings.model,
		versionLabel:
			validatedConfig.embeddings.versionLabel ??
			`${validatedConfig.embeddings.provider}:${validatedConfig.embeddings.model}`,
	});

	const vector = new QdrantAdapter({
		url: validatedConfig.qdrant.url,
		apiKey: validatedConfig.qdrant.apiKey,
		collectionPrefix: validatedConfig.qdrant.collection,
	});

	const jobStore = config.jobStore ?? new InMemoryJobStore();
	const jobManager = new JobManager({
		store: jobStore,
		concurrency: validatedConfig.jobs.concurrency,
		timeoutMs: validatedConfig.jobs.timeoutMs,
	});

	if (!config.jobStore) {
		logger.warn(
			'Using InMemoryJobStore — job state will be lost on process restart. ' +
				'Pass a persistent jobStore for production use.',
		);
	}

	const documentStore = config.documentStore ?? new InMemoryDocumentStore();

	if (!config.documentStore) {
		logger.warn(
			'Using InMemoryDocumentStore — document metadata will be lost on process restart. ' +
				'Pass a persistent documentStore for production use.',
		);
	}

	const ingestService = new IngestService(
		validatedConfig,
		ocr,
		embeddingService,
		vector,
		telemetry,
		jobManager,
		documentStore,
	);

	const retrieveService = new RetrieveService(validatedConfig, embeddingService, vector, telemetry);

	const documentsService = new DocumentsService(validatedConfig, vector, embeddingService, documentStore, telemetry);

	// Answer provider (may be different from embedding provider)
	let answerService: AnswerService | undefined;
	if (validatedConfig.answering) {
		const answerProvider = await createChatProvider({
			provider: validatedConfig.answering.provider,
			model: validatedConfig.answering.model,
			apiKey: validatedConfig.answering.apiKey,
			baseUrl: validatedConfig.answering.baseUrl,
		});

		answerService = new AnswerService(validatedConfig, answerProvider, retrieveService, telemetry);
	}

	logger.info('RAG SDK initialized', {
		embeddingProvider: validatedConfig.embeddings.provider,
		embeddingModel: validatedConfig.embeddings.model,
		qdrantUrl: redactUrl(validatedConfig.qdrant.url),
		collection: validatedConfig.qdrant.collection,
		answeringConfigured: !!validatedConfig.answering,
	});

	// Build the retrieve function with hybrid attached
	const retrieve = Object.assign((query: string, options?: RetrieveOptions) => retrieveService.query(query, options), {
		hybrid: (query: string, options?: HybridRetrieveOptions) => retrieveService.hybrid(query, options),
	});

	return {
		ingest: {
			file: (filePath, options) => ingestService.file(filePath, options),
			buffer: (buffer, fileName, options) => ingestService.buffer(buffer, fileName, options),
			url: (url, options) => ingestService.url(url, options),
			text: (text, options) => ingestService.text(text, options),
		},
		documents: {
			get: (documentId, tenantId) => documentsService.get(documentId, tenantId),
			list: (filters) => documentsService.list(filters),
			delete: (documentId, tenantId) => documentsService.delete(documentId, tenantId),
			reindex: (documentId, chunks, tenantId) => documentsService.reindex(documentId, chunks, tenantId),
			updateMetadata: (documentId, patch, tenantId) => documentsService.updateMetadata(documentId, patch, tenantId),
		},
		retrieve,
		answer: (query, options) => {
			if (!answerService) {
				throw new RagSdkError(
					RagErrorCode.NOT_CONFIGURED,
					'Answer generation is not configured. Provide an answering config in createRag().',
				);
			}
			return answerService.answer(query, options);
		},
		jobs: {
			get: (jobId, tenantId) => jobManager.getJob(jobId, tenantId),
			list: (filters) => jobManager.listJobs(filters ?? {}),
			cancel: (jobId, tenantId) => jobManager.cancelJob(jobId, tenantId),
		},
		healthcheck: async () => {
			const details: Record<string, unknown> = {};
			let status: 'ok' | 'degraded' | 'error' = 'ok';

			try {
				const qdrantOk = await vector.healthcheck();
				details.qdrant = qdrantOk ? 'connected' : 'unreachable';
				if (!qdrantOk) status = 'degraded';
			} catch {
				details.qdrant = 'error';
				status = 'error';
			}

			details.embeddingProvider = validatedConfig.embeddings.provider;
			details.embeddingModel = validatedConfig.embeddings.model;
			details.answeringConfigured = !!validatedConfig.answering;
			details.version = SDK_VERSION;

			return { status, details };
		},
		validateConfig: () => {
			try {
				validateConfig(resolvedConfig);
				return { valid: true };
			} catch (err) {
				if (err instanceof RagSdkError) {
					return { valid: false, errors: [err.message] };
				}
				return { valid: false, errors: [String(err)] };
			}
		},
		version: () => SDK_VERSION,
		close: async () => {
			logger.info('Shutting down RAG client');
			await jobManager.shutdown();
			logger.info('RAG client shut down');
		},
	};
}
