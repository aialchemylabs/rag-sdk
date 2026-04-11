import type { ProcessingMode } from '../config/enums.js';
import type { SecurityContext } from '../config/security.types.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { ChunkingResult } from '../chunking/chunk.types.js';

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
