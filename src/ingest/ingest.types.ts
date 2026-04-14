import type { ProcessingMode } from '../config/enums.js';
import type { SecurityContext } from '../config/security.types.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { ChunkingResult } from '../chunking/chunk.types.js';
import type { TelemetryEvent } from '../telemetry/telemetry.types.js';

/** Ingest a document from a local file path. */
export interface IngestFileInput {
	type: 'file';
	filePath: string;
	fileName?: string;
	mimeType?: string;
}

/** Ingest a document from an in-memory Buffer. */
export interface IngestBufferInput {
	type: 'buffer';
	buffer: Buffer;
	fileName: string;
	mimeType?: string;
}

/** Ingest a document fetched from a remote URL. */
export interface IngestUrlInput {
	type: 'url';
	url: string;
	fileName?: string;
	mimeType?: string;
}

/** Ingest raw text content directly. */
export interface IngestTextInput {
	type: 'text';
	text: string;
	fileName?: string;
}

/** Union of all supported ingestion input variants. */
export type IngestInput = IngestFileInput | IngestBufferInput | IngestUrlInput | IngestTextInput;

/** Optional configuration applied to an ingestion request. */
export interface IngestOptions {
	processingMode?: ProcessingMode;
	security?: SecurityContext;
	tags?: string[];
	domainId?: string;
	metadata?: Record<string, unknown>;
	async?: boolean;
	/**
	 * Optional caller-supplied document ID. When provided, the SDK uses this
	 * as the document identifier instead of generating one. Useful when the
	 * calling platform already has a stable document identifier in its own
	 * system of record (e.g. a Postgres UUID, Mongo ObjectId, etc.).
	 *
	 * The caller is responsible for uniqueness within the tenant. Re-ingesting
	 * with an existing ID overwrites the previous document's vectors.
	 */
	documentId?: string;
	/**
	 * Optional per-call telemetry override. When provided, `onEvent` is invoked
	 * for every event emitted during this call in addition to the client-scoped
	 * `telemetry.onEvent` configured at `createRag(...)` time. Useful for
	 * associating events with per-request context (job id, run id, tenant)
	 * without constructing a fresh `RagClient` per call.
	 *
	 * The per-call handler runs first, then the client-scoped handler. Errors
	 * thrown from either handler are swallowed and logged — telemetry cannot
	 * break the ingest call.
	 */
	telemetry?: {
		onEvent?: (event: TelemetryEvent) => void | Promise<void>;
	};
}

/** Outcome of an ingestion request. When `async: true`, only `documentId`, `jobId`, and `status: 'pending'` are populated. */
export interface IngestResult {
	documentId: string;
	sourceName: string;
	status: 'completed' | 'partial' | 'failed' | 'pending';
	normalizedDocument?: NormalizedDocument;
	chunkingResult?: ChunkingResult;
	chunksIndexed: number;
	processingTimeMs: number;
	warnings: string[];
	jobId?: string;
}
