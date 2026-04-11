# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
