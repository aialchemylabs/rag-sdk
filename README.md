# @aialchemy/rag-sdk

TypeScript-first, production-oriented RAG SDK for document ingestion, OCR, chunking, embeddings, indexing, retrieval, and answer generation.

---

## Features

- **End-to-end document RAG pipeline** in a single package -- ingest, chunk, embed, index, retrieve, and answer
- **Mistral OCR** for born-digital and scanned documents with page-aware extraction
- **Qdrant vector storage** with metadata filtering, tenant isolation, and hybrid search
- **Multi-provider LLM support** -- OpenAI, Anthropic, Google Gemini, HuggingFace, and Ollama for embeddings and chat, with optional peer dependencies
- **Citation-first answering** -- every answer traces back to source documents and page ranges
- **Multi-tenancy** -- per-tenant Qdrant collections with enforced metadata filters
- **Sync and async ingestion** -- blocking mode for development, job-based mode for production
- **Typed errors** with error codes, categories, retryable flags, and partial-success patterns
- **Telemetry hooks** for events and metrics -- compatible with OpenTelemetry-style tracing
- **Strong TypeScript types** for every config, input, output, and error surface
- **Zod-validated configuration** with fail-fast initialization
- **ESM-first** package with full type declarations

### Supported File Types

PDF, PNG, JPEG, TIFF, WEBP, GIF, BMP, AVIF, DOCX, PPTX, and plain text.

---

## Installation

```bash
pnpm add @aialchemy/rag-sdk
```

**Requirements:** Node.js 22 or later.

---

## Supported LLM Providers

The SDK supports multiple LLM providers for embeddings and answer generation. Only install the packages you need.

| Provider | Embeddings | Chat/Answering | Package | API Key Required |
|----------|-----------|---------------|---------|-----------------|
| OpenAI | Yes | Yes | `openai` (included) | Yes |
| Anthropic | No | Yes | `@anthropic-ai/sdk` | Yes |
| Google Gemini | Yes | Yes | `@google/generative-ai` | Yes |
| HuggingFace | Yes | Yes | `@huggingface/inference` | Yes |
| Ollama | Yes | Yes | `ollama` | No (local) |

Install optional providers as needed:

```bash
# For Anthropic answering
pnpm add @anthropic-ai/sdk

# For Gemini embeddings + answering
pnpm add @google/generative-ai

# For HuggingFace
pnpm add @huggingface/inference

# For Ollama (local models)
pnpm add ollama
```

### Example: Gemini embeddings with Anthropic answering

```ts
const rag = await createRag({
  mistral: { apiKey: process.env.MISTRAL_API_KEY! },
  qdrant: { url: 'http://localhost:6333', collection: 'my-docs' },
  embeddings: {
    provider: 'gemini',
    model: 'text-embedding-004',
    apiKey: process.env.GEMINI_API_KEY!,
  },
  answering: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
});
```

### Example: Fully local with Ollama

```ts
const rag = await createRag({
  mistral: { apiKey: process.env.MISTRAL_API_KEY! },
  qdrant: { url: 'http://localhost:6333', collection: 'my-docs' },
  embeddings: {
    provider: 'ollama',
    model: 'nomic-embed-text',
  },
  answering: {
    provider: 'ollama',
    model: 'llama3',
  },
});
```

---

## Quick Start

```ts
import { createRag } from '@aialchemy/rag-sdk';

const rag = await createRag({
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY!,
  },
  qdrant: {
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY,
    collection: 'my-documents',
  },
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY!,
  },
});

// Ingest a PDF
const result = await rag.ingest.file('./contracts/agreement.pdf', {
  tags: ['legal', 'contracts'],
});

console.log(`Indexed ${result.chunksIndexed} chunks from ${result.sourceName}`);

// Retrieve relevant chunks
const retrieval = await rag.retrieve('What are the termination clauses?', {
  topK: 5,
  scoreThreshold: 0.7,
});

for (const match of retrieval.matches) {
  console.log(`[${match.score.toFixed(3)}] ${match.citation.sourceName} p${match.citation.pageStart}`);
  console.log(match.content);
}
```

---

## Configuration

### `createRag(config: RagConfig): Promise<RagClient>`

The factory is async because LLM providers may use dynamic imports for optional peer dependencies.

The factory function validates all configuration at initialization and fails fast on invalid or missing values.

### Required

| Option | Type | Description |
|--------|------|-------------|
| `mistral.apiKey` | `string` | Mistral API key for OCR |
| `qdrant.url` | `string` | Qdrant instance URL |
| `qdrant.collection` | `string` | Qdrant collection name (used as prefix for multi-tenant collections) |
| `embeddings.provider` | `'openai' \| 'gemini' \| 'huggingface' \| 'ollama'` | Embedding provider name |
| `embeddings.model` | `string` | Embedding model identifier |
| `embeddings.apiKey` | `string` | Embedding provider API key (optional for Ollama) |

### Optional

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mistral.model` | `string` | `'mistral-ocr-latest'` | Mistral OCR model |
| `qdrant.apiKey` | `string` | -- | Qdrant API key (if instance is secured) |
| `embeddings.baseUrl` | `string` | -- | Custom base URL for embedding provider |
| `embeddings.vectorSize` | `number` | -- | Override vector dimensions |
| `embeddings.distanceMetric` | `'cosine' \| 'euclid' \| 'dot'` | `'cosine'` | Distance metric for Qdrant |
| `embeddings.versionLabel` | `string` | `'{provider}:{model}'` | Label stored with every chunk for migration safety |
| `chunking.targetTokens` | `number` | `512` | Target tokens per chunk (50--8192) |
| `chunking.maxTokens` | `number` | `1024` | Maximum tokens per chunk (100--16384) |
| `chunking.overlapTokens` | `number` | `64` | Overlap tokens between chunks (0--512) |
| `chunking.headingAware` | `boolean` | `true` | Split on heading boundaries |
| `chunking.preservePageBoundaries` | `boolean` | `false` | Avoid splitting across pages |
| `chunking.preserveTables` | `boolean` | `true` | Keep tables intact within chunks |
| `retrieval.topK` | `number` | `10` | Default number of results (1--100) |
| `retrieval.scoreThreshold` | `number` | `0.0` | Minimum similarity score (0--1) |
| `retrieval.hybrid.enabled` | `boolean` | -- | Enable hybrid (dense + sparse) search |
| `retrieval.hybrid.fusionAlpha` | `number` | `0.5` | Fusion weight between dense and sparse (0--1) |
| `answering.provider` | `'openai' \| 'anthropic' \| 'gemini' \| 'huggingface' \| 'ollama'` | -- | Answer generation LLM provider |
| `answering.model` | `string` | -- | Answer generation model |
| `answering.apiKey` | `string` | -- | Answer generation API key (optional for Ollama) |
| `documentStore` | `DocumentStore` | `InMemoryDocumentStore` | Custom document metadata store for persistence |
| `answering.baseUrl` | `string` | -- | Custom base URL for answer provider |
| `answering.maxTokens` | `number` | `2048` | Maximum tokens for generated answer |
| `answering.temperature` | `number` | `0.1` | Sampling temperature (0--2) |
| `answering.noCitationPolicy` | `'refuse' \| 'warn' \| 'allow'` | `'refuse'` | Behavior when evidence is insufficient |
| `telemetry.enabled` | `boolean` | `true` | Enable telemetry events and metrics |
| `telemetry.onEvent` | `(event) => void` | -- | Callback for telemetry events |
| `telemetry.onMetric` | `(metric) => void` | -- | Callback for metrics |
| `security.redactPii` | `boolean` | `false` | Enable PII redaction |
| `security.preprocessor` | `(content: string) => string` | -- | Custom content preprocessor |
| `defaults.processingMode` | `'text_first' \| 'ocr_first' \| 'hybrid'` | `'hybrid'` | Default OCR processing mode |
| `defaults.tenantId` | `string` | -- | Default tenant ID applied to all operations |
| `defaults.domainId` | `string` | -- | Default domain ID |
| `defaults.tags` | `string[]` | -- | Default tags applied to ingested documents |
| `jobs.concurrency` | `number` | `5` | Maximum concurrent async jobs (1--50) |
| `jobs.timeoutMs` | `number` | `300000` | Job timeout in milliseconds |
| `maxFileSizeBytes` | `number` | `52428800` | Maximum file size (default 50 MB) |

---

## Environment Variables

All required credentials can be provided via environment variables as a fallback when not passed in config. Explicit config always takes precedence.

| Variable | Required | Description |
|----------|----------|-------------|
| `MISTRAL_API_KEY` | Yes | Mistral OCR API key |
| `QDRANT_URL` | Yes | Qdrant instance URL |
| `QDRANT_API_KEY` | No | Qdrant API key (if instance is secured) |
| `QDRANT_COLLECTION` | Yes | Default Qdrant collection name |
| `OPENAI_API_KEY` | Conditional | Required when using OpenAI as your embedding or answer provider |
| `ANTHROPIC_API_KEY` | Conditional | Required when using Anthropic as your answer provider |
| `GEMINI_API_KEY` | Conditional | Required when using Gemini as your embedding or answer provider |
| `HUGGINGFACE_API_KEY` | Conditional | Required when using HuggingFace as your embedding or answer provider |

---

## Ingestion

The ingestion pipeline handles: input detection, Mistral OCR extraction, document normalization, chunking, embedding generation, and Qdrant indexing.

### File ingestion

```ts
const result = await rag.ingest.file('./reports/quarterly-review.pdf', {
  processingMode: ProcessingMode.Hybrid,
  tags: ['finance', 'quarterly'],
  domainId: 'reports',
});
```

### Buffer ingestion

```ts
import { readFile } from 'node:fs/promises';

const buffer = await readFile('./scanned-invoice.png');

const result = await rag.ingest.buffer(buffer, 'scanned-invoice.png', {
  processingMode: ProcessingMode.OcrFirst,
  tags: ['invoices'],
});
```

### URL ingestion

```ts
const result = await rag.ingest.url('https://example.com/documents/whitepaper.pdf', {
  tags: ['research'],
});
```

### Text ingestion

For pre-extracted or plain text content that does not need OCR:

```ts
const result = await rag.ingest.text('This is the full document content...', {
  tags: ['notes'],
});
```

### Async ingestion

For large files or production pipelines, enable async mode to receive a job ID for tracking:

```ts
const tenantId = 'tenant-acme';

const result = await rag.ingest.file('./large-report.pdf', {
  async: true,
  security: { tenantId },
  tags: ['bulk'],
});

console.log(`Job started: ${result.jobId}`);

// Poll for completion
const job = await rag.jobs.get(result.jobId!, tenantId);
console.log(`Status: ${job?.status}, Progress: ${job?.progress}%`);
```

### Ingestion result

Every ingestion returns an `IngestResult`:

```ts
interface IngestResult {
  documentId: string;
  sourceName: string;
  status: 'completed' | 'partial' | 'failed' | 'pending';
  normalizedDocument?: NormalizedDocument; // absent when async/pending
  chunkingResult?: ChunkingResult;        // absent when async/pending
  chunksIndexed: number;
  processingTimeMs: number;
  warnings: string[];
  jobId?: string; // present when async: true
}
```

---

## Retrieval

### Dense vector search

```ts
const result = await rag.retrieve('What are the payment terms?', {
  topK: 10,
  scoreThreshold: 0.7,
  filters: {
    tags: ['contracts'],
    domainId: 'legal',
  },
});

for (const match of result.matches) {
  console.log(`Score: ${match.score}`);
  console.log(`Source: ${match.citation.sourceName}, pages ${match.citation.pageStart}-${match.citation.pageEnd}`);
  console.log(`Content: ${match.content}\n`);
}
```

### Hybrid search

Combines dense vector search with sparse keyword matching. Requires `retrieval.hybrid.enabled: true` in config.

```ts
const result = await rag.retrieve.hybrid('termination clause penalties', {
  topK: 10,
  fusionAlpha: 0.6, // 0 = dense only, 1 = sparse only
  filters: {
    documentIds: ['doc-abc-123'],
  },
});
```

### Retrieval result

```ts
interface RetrieveResult {
  query: string;
  matches: RetrieveMatch[];
  totalMatches: number;
  searchTimeMs: number;
  searchType: 'dense' | 'hybrid';
}

interface RetrieveMatch {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  metadata: ChunkMetadata;
  citation: CitationAnchor;
}
```

---

## Answer Generation

Generate citation-backed answers from retrieved evidence. Requires the `answering` config block.

```ts
const rag = await createRag({
  // ...required config...
  answering: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY!,
    noCitationPolicy: 'refuse', // default -- will not generate unsupported claims
  },
});

const answer = await rag.answer('What is the liability cap?', {
  topK: 5,
  filters: { tags: ['contracts'] },
});

console.log(`Answer: ${answer.answer}`);
console.log(`Confidence: ${answer.confidence}`);
console.log(`Risk level: ${answer.riskLevel}`);

for (const citation of answer.citations) {
  console.log(`  [${citation.citationIndex}] ${citation.anchor.sourceName} p${citation.anchor.pageStart}: "${citation.text}"`);
}
```

### No-citation policy

The `noCitationPolicy` setting controls SDK behavior when retrieved evidence is insufficient:

| Policy | Behavior |
|--------|----------|
| `'refuse'` | Returns a disclaimer instead of an unsupported answer (default) |
| `'warn'` | Returns a notice that no evidence was found, sets `riskLevel` to `'no_evidence'` and includes a disclaimer |
| `'allow'` | Returns an empty answer with `confidence: 'none'` and `riskLevel: 'no_evidence'`, letting the caller decide how to proceed |

### Answer result

```ts
interface AnswerResult {
  answer: string;
  citations: AnswerCitation[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  riskLevel: 'safe' | 'low_evidence' | 'no_evidence';
  disclaimer?: string;
  sources: Array<{
    documentId: string;
    sourceName: string;
    pageRange: string;
  }>;
  retrievalTimeMs: number;
  generationTimeMs: number;
  totalTimeMs: number;
}
```

---

## Documents Management

### Get a document

```ts
const doc = await rag.documents.get('doc-abc-123');

if (doc) {
  console.log(`${doc.sourceName} -- ${doc.chunkCount} chunks, ${doc.pageCount} pages`);
}
```

### List documents

```ts
const docs = await rag.documents.list({
  tenantId: 'tenant-1',
  tags: ['contracts'],
  limit: 20,
  offset: 0,
});
```

### Delete a document

Removes the document record and all indexed chunks from Qdrant:

```ts
const { deleted } = await rag.documents.delete('doc-abc-123');
console.log(`Deleted ${deleted} chunks`);
```

### Reindex a document

Replace all indexed chunks for a document:

```ts
const updatedChunks = [
  {
    chunkId: 'chk-1',
    content: 'Updated text for this chunk...',
    metadata: {
      sourceName: 'contract.pdf',
      pageStart: 3,
      pageEnd: 3,
      processingMode: 'hybrid',
      ocrProvider: 'mistral',
    },
  },
];

const { reindexed } = await rag.documents.reindex('doc-abc-123', updatedChunks, 'tenant-acme');
console.log(`Reindexed ${reindexed} chunks`);
```

### Update metadata

Patch tags, domain, or custom metadata on an existing document:

```ts
await rag.documents.updateMetadata('doc-abc-123', {
  tags: ['contracts', 'reviewed'],
  domainId: 'legal-reviewed',
  metadata: { reviewedBy: 'jdoe', reviewedAt: new Date().toISOString() },
});
```

### Custom document store

> **Warning:** The default `InMemoryDocumentStore` and `InMemoryJobStore` are for **development and testing only**. All document metadata and job state is lost on process restart. For production deployments, implement the `DocumentStore` interface with a persistent backend (PostgreSQL, Redis, DynamoDB, etc.) and pass it via config. The SDK logs a warning at startup when using the in-memory default.

For persistence, implement the `DocumentStore` interface or pass a custom backend:

```ts
import { createRag, InMemoryDocumentStore } from '@aialchemy/rag-sdk';
import type { DocumentStore } from '@aialchemy/rag-sdk';

// Use the default in-memory store (no config needed)
const rag = await createRag({ /* ... */ });

// Or pass a custom persistent store
const rag = await createRag({
  // ...required config...
  documentStore: myCustomStore, // implements DocumentStore interface
});
```

---

## Async Jobs

Async ingestion returns a job ID for tracking long-running operations.

### Get job status

```ts
const job = await rag.jobs.get('job-xyz-789', 'tenant-acme');

if (job) {
  console.log(`Status: ${job.status}`);  // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  console.log(`Progress: ${job.progress}%`);
}
```

### List jobs

```ts
const jobs = await rag.jobs.list({
  status: 'running',
  limit: 10,
});
```

### Cancel a job

```ts
const cancelled = await rag.jobs.cancel('job-xyz-789', 'tenant-acme');
console.log(`Job ${cancelled.jobId} is now ${cancelled.status}`);
```

---

## Multi-Tenancy

The SDK supports per-tenant collection isolation in Qdrant. Pass a `SecurityContext` with a `tenantId` to scope all operations.

### Tenant-scoped ingestion

```ts
const result = await rag.ingest.file('./tenant-doc.pdf', {
  security: {
    tenantId: 'tenant-acme',
    userId: 'user-42',
  },
  tags: ['onboarding'],
});
```

### Tenant-scoped retrieval

```ts
const result = await rag.retrieve('renewal terms', {
  security: {
    tenantId: 'tenant-acme',
  },
  filters: {
    tags: ['contracts'],
  },
});
```

### Default tenant

Set a default tenant at initialization to avoid passing it on every call:

```ts
const rag = await createRag({
  // ...required config...
  defaults: {
    tenantId: 'tenant-acme',
  },
});
```

When `tenantId` is configured, the SDK enforces tenant metadata filters on all operations. Tenant filters are never silently skipped.

---

## Error Handling

All SDK errors are instances of `RagSdkError` with structured fields for programmatic handling.

### Catching errors

```ts
import { RagSdkError, RagErrorCode } from '@aialchemy/rag-sdk';

try {
  await rag.ingest.file('./document.pdf');
} catch (err) {
  if (err instanceof RagSdkError) {
    console.error(`[${err.code}] ${err.message}`);
    console.error(`Category: ${err.category}`);
    console.error(`Retryable: ${err.retryable}`);
    console.error(`Provider: ${err.provider}`);
    console.error(`Details:`, err.details);
  }
}
```

### Error shape

```ts
class RagSdkError extends Error {
  code: RagErrorCode;        // e.g. 'OCR_TOTAL_FAILURE'
  category: RagErrorCategory; // e.g. 'ocr'
  retryable: boolean;
  provider?: string;
  details?: RagErrorDetails;
}
```

### Error categories

| Category | Example codes |
|----------|--------------|
| `configuration` | `CONFIG_MISSING_REQUIRED`, `CONFIG_INVALID_URL`, `CONFIG_UNSUPPORTED_PROVIDER`, `CONFIG_INVALID_RANGE` |
| `authentication` | `AUTH_INVALID_KEY`, `AUTH_EXPIRED_KEY`, `AUTH_PROVIDER_UNAUTHORIZED` |
| `ocr` | `OCR_TOTAL_FAILURE`, `OCR_PARTIAL_FAILURE`, `OCR_PAGE_FAILURE`, `OCR_EMPTY_RESULT`, `OCR_UNSUPPORTED_FILE` |
| `embedding` | `EMBEDDING_PROVIDER_ERROR`, `EMBEDDING_DIMENSION_MISMATCH`, `EMBEDDING_RATE_LIMIT` |
| `vector_database` | `VECTOR_CONNECTION_ERROR`, `VECTOR_COLLECTION_NOT_FOUND`, `VECTOR_UPSERT_FAILED`, `VECTOR_SEARCH_FAILED` |
| `validation` | `VALIDATION_INVALID_INPUT`, `VALIDATION_FILE_TOO_LARGE`, `VALIDATION_UNSUPPORTED_TYPE` |
| `timeout` | `TIMEOUT_INGESTION`, `TIMEOUT_RETRIEVAL`, `TIMEOUT_ANSWER` |
| `partial_processing` | `PARTIAL_OCR`, `PARTIAL_INDEXING` |
| `answer` | `ANSWER_PROVIDER_ERROR`, `ANSWER_NO_EVIDENCE`, `ANSWER_LOW_CONFIDENCE` |

### Partial success

Ingestion can return a `'partial'` status when non-fatal warnings are raised during extraction (e.g., low embedded-text content detected in `text_first` mode). OCR failures and indexing failures throw a `RagSdkError` instead of returning partial results. Always check `result.status` and `result.warnings`:

```ts
const result = await rag.ingest.file('./mixed-quality-scan.pdf');

if (result.status === 'partial') {
  console.warn('Partial ingestion:', result.warnings);
}
```

### Retry and resilience

The SDK does **not** include built-in retry logic. All errors carry a `retryable` flag that your application should use to decide whether to retry:

```ts
import { RagSdkError } from '@aialchemy/rag-sdk';

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RagSdkError && err.retryable && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

// Usage
const result = await withRetry(() => rag.ingest.file('./report.pdf'));
```

Retryable errors include transient conditions like Qdrant connection failures (`VECTOR_CONNECTION_ERROR`), embedding rate limits (`EMBEDDING_RATE_LIMIT`), and provider overload errors. Non-retryable errors (configuration, validation, authentication) should not be retried.

### Token estimation

Token counts reported in `ChunkMetadata.tokenCount` and `DocumentRecord.totalTokens` use a heuristic of approximately 4 characters per token. This is a fast estimate, not a provider-specific tokenizer. Actual token counts may differ by 20--30% depending on the model and content. The chunking system uses the same heuristic for target/max token boundaries.

---

## Telemetry

Hook into SDK events and metrics for observability. Compatible with OpenTelemetry-style tracing pipelines.

### Event hooks

```ts
const rag = await createRag({
  // ...required config...
  telemetry: {
    enabled: true,
    onEvent: (event) => {
      // event.type: 'ingestion_started' | 'ingestion_completed' | 'ocr_completed' | ...
      // event.timestamp, event.durationMs, event.documentId, event.tenantId
      console.log(`[${event.type}] ${event.documentId} -- ${event.durationMs}ms`);
    },
    onMetric: (metric) => {
      // metric.name, metric.value, metric.unit, metric.tags
      myMetricsExporter.record(metric.name, metric.value, metric.unit);
    },
  },
});
```

### Telemetry event types

| Event | Emitted when |
|-------|-------------|
| `ingestion_started` | Ingestion pipeline begins |
| `ingestion_completed` | Ingestion finishes successfully |
| `ingestion_failed` | Ingestion fails |
| `ocr_completed` | OCR extraction finishes |
| `ocr_failed` | OCR extraction fails |
| `embeddings_completed` | Embedding generation finishes |
| `embeddings_failed` | Embedding generation fails |
| `qdrant_upsert_completed` | Chunks are indexed in Qdrant |
| `retrieval_executed` | A retrieval query completes |
| `answer_generation_executed` | Answer generation completes |

---

## API Reference

### Factory

| Function | Returns | Description |
|----------|---------|-------------|
| `createRag(config)` | `Promise<RagClient>` | Create and validate a RAG client instance (async) |

### Ingestion -- `rag.ingest`

| Method | Signature |
|--------|-----------|
| `file` | `(filePath: string, options?: IngestOptions) => Promise<IngestResult>` |
| `buffer` | `(buffer: Buffer, fileName: string, options?: IngestOptions) => Promise<IngestResult>` |
| `url` | `(url: string, options?: IngestOptions) => Promise<IngestResult>` |
| `text` | `(text: string, options?: IngestOptions) => Promise<IngestResult>` |

### Retrieval -- `rag.retrieve`

| Method | Signature |
|--------|-----------|
| `retrieve` | `(query: string, options?: RetrieveOptions) => Promise<RetrieveResult>` |
| `retrieve.hybrid` | `(query: string, options?: HybridRetrieveOptions) => Promise<RetrieveResult>` |

### Answers -- `rag.answer`

| Method | Signature |
|--------|-----------|
| `answer` | `(query: string, options?: AnswerOptions) => Promise<AnswerResult>` |

### Documents -- `rag.documents`

| Method | Signature |
|--------|-----------|
| `get` | `(documentId: string, tenantId?: string) => Promise<DocumentRecord \| null>` |
| `list` | `(filters?: DocumentListFilters) => Promise<DocumentRecord[]>` |
| `delete` | `(documentId: string, tenantId?: string) => Promise<{ deleted: number }>` |
| `reindex` | `(documentId: string, chunks: Array<...>, tenantId?: string) => Promise<{ reindexed: number }>` |
| `updateMetadata` | `(documentId: string, patch: DocumentMetadataPatch, tenantId?: string) => Promise<void>` |

### Jobs -- `rag.jobs`

| Method | Signature |
|--------|-----------|
| `get` | `(jobId: string, tenantId: string) => Promise<JobRecord \| null>` |
| `list` | `(filters?: JobListFilters) => Promise<JobRecord[]>` |
| `cancel` | `(jobId: string, tenantId: string) => Promise<JobRecord>` |

### Utilities

| Method | Returns | Description |
|--------|---------|-------------|
| `rag.healthcheck()` | `Promise<{ status, details }>` | Check Qdrant connectivity and service health |
| `rag.validateConfig()` | `{ valid, errors? }` | Re-validate the current configuration |
| `rag.version()` | `string` | Return the SDK version |

### Exported Types

```ts
// Config
RagConfig, MistralConfig, QdrantConfig, EmbeddingConfig, ChunkingConfig,
RetrievalConfig, AnsweringConfig, TelemetryConfig, SecurityConfig,
DefaultsConfig, JobsConfig
EmbeddingProviderName, AnsweringProviderName

// Documents
NormalizedDocument, NormalizedPage, NormalizedTable, NormalizedLink,
OcrWarning, OcrProviderMetadata

// Chunks
ChunkMetadata, Chunk, ChunkingResult

// Citations
CitationAnchor, Citation

// Ingestion
IngestInput, IngestFileInput, IngestBufferInput, IngestUrlInput,
IngestTextInput, IngestOptions, IngestResult

// Retrieval
RetrieveOptions, RetrieveResult, RetrieveMatch, HybridRetrieveOptions

// Answers
AnswerOptions, AnswerResult, AnswerCitation

// Jobs
JobRecord, JobStatus, JobListFilters

// Documents Management
DocumentRecord, DocumentListFilters, DocumentMetadataPatch

// Document Store
DocumentStore, StoredDocument, DocumentStoreListFilters, InMemoryDocumentStore

// Security
SecurityContext

// Telemetry
TelemetryEvent, TelemetryEventType, MetricEntry

// Enums
ProcessingMode

// Errors
RagSdkError, RagErrorDetails, RagErrorCode, RagErrorCategory

// LLM Providers
EmbeddingProvider, ChatProvider, ProviderCapability
PROVIDER_CAPABILITIES, SUPPORTED_PROVIDERS
```

---

## License

MIT
