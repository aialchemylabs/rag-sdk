# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-04-14

### Fixed

- **Critical: embedding corruption against LiteLLM/Ollama backends.** The OpenAI provider now passes `encoding_format: 'float'` explicitly when calling `client.embeddings.create(...)`. OpenAI npm v6 flipped the default to `'base64'`, which caused LiteLLM-proxied providers (Ollama, Cohere, Voyage, etc.) to return plain float arrays that the client then misdecoded as base64 — silently producing 256 garbage floats regardless of the model's true dimension. The fix is a no-op against the real OpenAI API and restores correctness for every OpenAI-compatible proxy. ([src/llmProviders/openaiProvider.ts](src/llmProviders/openaiProvider.ts))
- **Embedding dimension validation.** When `embeddings.vectorSize` is configured, ingestion now throws a clear `EMBEDDING_PROVIDER_ERROR` before the Qdrant upsert if the provider returns vectors of a different length, instead of seeding the collection with corrupted embeddings. When `vectorSize` is not configured, a warning is logged so callers know dimensions are being inferred from the first embedding. ([src/ingest/service.ts](src/ingest/service.ts))

### Added

- **Per-stage telemetry events with a symmetric `_started` / `_completed` / `_failed` contract.** Every ingest stage (OCR, chunking, embeddings, Qdrant upsert) now emits a `_started` event, and stage failures emit a `_failed` event before the terminal `ingestion_failed` so consumers can attribute failures to a specific stage without tracking pipeline order. Retrieval and answer generation gain `_started` / `_failed` events alongside the existing `_executed`. New event types: `ocr_started`, `chunking_started`, `chunking_completed`, `chunking_failed`, `embeddings_started`, `qdrant_upsert_started`, `qdrant_upsert_failed`, `retrieval_started`, `retrieval_failed`, `answer_generation_started`, `answer_generation_failed`. ([src/telemetry/telemetry.types.ts](src/telemetry/telemetry.types.ts))
- **Caller-supplied document IDs.** `IngestOptions.documentId` lets platforms reuse their own stable identifier (Postgres UUID, Mongo ObjectId, etc.) instead of maintaining a mapping table to the SDK's `doc_<uuid>`. The ID is validated (non-empty, ≤256 chars) and is used verbatim for the document record, Qdrant payload, and document store. Works for both `ingestSync` and `ingestAsync` (jobs). ([src/ingest/ingest.types.ts](src/ingest/ingest.types.ts), [src/ingest/service.ts](src/ingest/service.ts))
- **Per-call telemetry override.** `IngestOptions`, `RetrieveOptions`, `HybridRetrieveOptions`, and `AnswerOptions` accept an optional `telemetry.onEvent` handler. When provided, events emitted during the call are delivered to both the per-call handler (first) and the client-scoped handler (second). This allows concurrent callers to associate events with per-request context (job id, run id, tenant) without constructing a fresh `RagClient` per call — restoring connection pooling in multi-tenant platforms. ([src/telemetry/emitter.ts](src/telemetry/emitter.ts))
- `TelemetryEmitter.withOverride(handler)` helper that returns a scoped emitter for the duration of a single call.

### Changed

- Telemetry `onEvent` handlers are now invoked inside a swallow-and-log guard. Exceptions thrown by a handler (or rejected promises returned from an async handler) are logged via the SDK logger and never propagate to the caller, so observability code cannot break an ingest / retrieve / answer call.
- `AnswerService.answer` now emits `answer_generation_executed` on the no-evidence and citation-violation early-return paths, honoring the "every `_started` is followed by exactly one `_completed` or `_failed`" contract.

## [0.1.0] - 2026-04-11

### Added

- `createRag()` factory function — single entry point that wires OCR, embeddings, vector store, and answer generation
- **Ingestion pipeline**: file, buffer, URL, and raw text ingestion with Mistral OCR, token-aware chunking, and automatic embedding
- **Retrieval**: dense vector search and hybrid search (dense + BM25-like sparse with reciprocal rank fusion)
- **Answer generation**: retrieve-then-generate with citation validation, repair loop, and no-citation-no-claim policy
- **Document management**: get, list, delete, reindex, and updateMetadata operations
- **Async ingestion**: background job queue with concurrency control, timeouts, and cancellation
- **Multi-tenancy**: per-tenant Qdrant collections, tenant-scoped queries and document isolation
- **Multi-provider LLM support**: OpenAI, Anthropic, Gemini, HuggingFace, and Ollama (via peer dependencies)
- **Typed error system**: `RagSdkError` with 40+ error codes, categories, and retryable flags
- **Telemetry hooks**: event and metric emission at key pipeline checkpoints
- **Config validation**: Zod-based runtime validation with environment variable resolution
- **Graceful shutdown**: `close()` method on RagClient for clean teardown of jobs and connections
- **Custom persistence**: injectable `DocumentStore` and `JobStore` interfaces for production storage backends
- ESM and CJS dual-format package output
- Comprehensive TypeScript types with strict mode
- In-memory document and job stores for development
