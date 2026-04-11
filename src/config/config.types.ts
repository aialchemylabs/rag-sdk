import type { ProcessingMode } from './enums.js';
import type { DocumentStore } from '../documents/documentStore.types.js';
import type { JobStore } from '../jobs/jobStore.types.js';

/** Configuration for the Mistral OCR provider used for document parsing. */
export interface MistralConfig {
	apiKey: string;
	model?: string;
}

/** Connection settings for the Qdrant vector database. */
export interface QdrantConfig {
	url: string;
	apiKey?: string;
	collection: string;
}

/** Providers that support embedding generation. */
export type EmbeddingProviderName = 'openai' | 'gemini' | 'huggingface' | 'ollama';

/** Providers that support chat completions. */
export type AnsweringProviderName = 'openai' | 'anthropic' | 'gemini' | 'huggingface' | 'ollama';

/**
 * Configuration for the embedding provider used to vectorize chunks.
 * Supports custom base URLs for self-hosted or alternative providers.
 */
export interface EmbeddingConfig {
	provider: EmbeddingProviderName;
	model: string;
	/** Required for all providers except Ollama. */
	apiKey?: string;
	baseUrl?: string;
	vectorSize?: number;
	distanceMetric?: 'cosine' | 'euclid' | 'dot';
	/** Label to track which embedding model version produced stored vectors. */
	versionLabel?: string;
}

/** Controls how documents are split into chunks for embedding and retrieval. */
export interface ChunkingConfig {
	targetTokens?: number;
	maxTokens?: number;
	overlapTokens?: number;
	/** When true, chunk boundaries respect heading hierarchy. */
	headingAware?: boolean;
	/** When true, avoids splitting chunks across page boundaries. */
	preservePageBoundaries?: boolean;
	/** When true, keeps tables intact within a single chunk. */
	preserveTables?: boolean;
}

/** Controls vector similarity search behavior during retrieval. */
export interface RetrievalConfig {
	/** Maximum number of chunks to return. */
	topK?: number;
	/** Minimum similarity score to include a chunk in results. */
	scoreThreshold?: number;
	/** Enable hybrid search combining dense and sparse retrieval. */
	hybrid?: {
		enabled: boolean;
		/** Balance between dense (0) and sparse (1) retrieval. */
		fusionAlpha?: number;
	};
}

/**
 * Configuration for the LLM used to generate answers from retrieved context.
 * The `noCitationPolicy` enforces the no-citation-no-claim guarantee.
 */
export interface AnsweringConfig {
	provider: AnsweringProviderName;
	model: string;
	/** Required for all providers except Ollama. */
	apiKey?: string;
	baseUrl?: string;
	maxTokens?: number;
	temperature?: number;
	/** Policy when no citation supports a claim: warn, refuse to answer, or allow. */
	noCitationPolicy?: 'warn' | 'refuse' | 'allow';
}

/** Hooks for observability events and metrics emitted by the SDK. */
export interface TelemetryConfig {
	enabled?: boolean;
	onEvent?: (event: unknown) => void;
	onMetric?: (metric: unknown) => void;
}

/** Security options applied during document ingestion. */
export interface SecurityConfig {
	/** When true, PII is redacted from content before storage. */
	redactPii?: boolean;
	/** Optional transform applied to content before chunking/embedding. */
	preprocessor?: (content: string) => string | Promise<string>;
}

/** Default values applied to all ingested documents when not explicitly provided. */
export interface DefaultsConfig {
	processingMode?: ProcessingMode;
	tenantId?: string;
	domainId?: string;
	tags?: string[];
}

/** Controls concurrency and timeouts for background ingestion jobs. */
export interface JobsConfig {
	concurrency?: number;
	timeoutMs?: number;
}

/**
 * Top-level configuration for the RAG SDK.
 * Passed to `createRagClient()` to initialize all subsystems.
 */
export interface RagConfig {
	mistral: MistralConfig;
	qdrant: QdrantConfig;
	embeddings: EmbeddingConfig;
	chunking?: ChunkingConfig;
	retrieval?: RetrievalConfig;
	answering?: AnsweringConfig;
	telemetry?: TelemetryConfig;
	security?: SecurityConfig;
	defaults?: DefaultsConfig;
	jobs?: JobsConfig;
	/** Maximum allowed file size for uploads. Defaults to 50 MB. */
	maxFileSizeBytes?: number;
	/** Optional custom document store. Defaults to in-memory. */
	documentStore?: DocumentStore;
	/** Optional custom job store. Defaults to in-memory. */
	jobStore?: JobStore;
}
