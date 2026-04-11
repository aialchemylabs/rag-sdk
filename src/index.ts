// Factory
export { createRag } from './createRag.js';
export type { RagClient } from './createRag.js';

// Types - Config
export type {
	RagConfig,
	MistralConfig,
	QdrantConfig,
	EmbeddingConfig,
	ChunkingConfig,
	RetrievalConfig,
	AnsweringConfig,
	TelemetryConfig,
	SecurityConfig,
	DefaultsConfig,
	JobsConfig,
} from './config/config.types.js';

// Types - Documents
export type {
	NormalizedDocument,
	NormalizedPage,
	NormalizedTable,
	NormalizedLink,
	OcrWarning,
	OcrProviderMetadata,
} from './normalize/document.types.js';

// Types - Chunks
export type {
	ChunkMetadata,
	Chunk,
	ChunkingResult,
} from './chunking/chunk.types.js';

// Types - Citations
export type {
	CitationAnchor,
	Citation,
} from './retrieve/citation.types.js';

// Types - Ingest
export type {
	IngestInput,
	IngestFileInput,
	IngestBufferInput,
	IngestUrlInput,
	IngestTextInput,
	IngestOptions,
	IngestResult,
} from './ingest/ingest.types.js';

// Types - Retrieve
export type {
	RetrieveOptions,
	RetrieveResult,
	RetrieveMatch,
	HybridRetrieveOptions,
} from './retrieve/retrieve.types.js';

// Types - Answer
export type {
	AnswerOptions,
	AnswerResult,
	AnswerCitation,
} from './answer/answer.types.js';

// Types - Jobs
export type {
	JobRecord,
	JobStatus,
	JobListFilters,
} from './jobs/job.types.js';

// Types - Document Records
export type {
	DocumentRecord,
	DocumentListFilters,
	DocumentMetadataPatch,
} from './documents/documentRecord.types.js';

// Types - Security
export type { SecurityContext } from './config/security.types.js';

// Types - Telemetry
export type {
	TelemetryEvent,
	TelemetryEventType,
	MetricEntry,
} from './telemetry/telemetry.types.js';

// Types - Config (provider names)
export type { EmbeddingProviderName, AnsweringProviderName } from './config/config.types.js';

// Types - Document Store
export type { DocumentStore, StoredDocument, DocumentStoreListFilters } from './documents/documentStore.types.js';
export { InMemoryDocumentStore } from './documents/inMemoryDocumentStore.js';

// Types - Job Store
export type { JobStore } from './jobs/jobStore.types.js';
export { InMemoryJobStore } from './jobs/inMemoryStore.js';

// Types - LLM Providers
export type { EmbeddingProvider, ChatProvider } from './llmProviders/llmProvider.types.js';
export type { ProviderCapability } from './llmProviders/capabilities.js';
export { createEmbeddingProvider, createChatProvider } from './llmProviders/factory.js';
export { PROVIDER_CAPABILITIES, SUPPORTED_PROVIDERS, supportsCapability } from './llmProviders/capabilities.js';

// Enums
export { ProcessingMode } from './config/enums.js';

// Errors
export { RagSdkError } from './errors/ragError.js';
export type { RagErrorDetails } from './errors/ragError.js';
export { RagErrorCode } from './errors/errorCodes.js';
export type { RagErrorCategory } from './errors/errorCodes.js';
