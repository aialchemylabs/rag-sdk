/** Metadata stored alongside each chunk in the vector database for filtering and traceability. */
export interface ChunkMetadata {
	documentId: string;
	chunkId: string;
	chunkIndex: number;
	sourceName: string;
	/** First page (zero-based) covered by this chunk. */
	pageStart: number;
	/** Last page (zero-based) covered by this chunk. */
	pageEnd: number;
	/** Nearest heading above this chunk, if heading-aware chunking is enabled. */
	sectionTitle?: string;
	tenantId?: string;
	domainId?: string;
	tags?: string[];
	mimeType?: string;
	customMetadata?: Record<string, unknown>;
	processingMode: string;
	embeddingVersion: string;
	ocrProvider: string;
	createdAt: string;
}

/** A single chunk of document content, optionally with its embedding vector. */
export interface Chunk {
	chunkId: string;
	documentId: string;
	content: string;
	tokenCount: number;
	metadata: ChunkMetadata;
	/** Populated after the embedding step; omitted during chunking-only flows. */
	embedding?: number[];
}

/** Summary statistics returned after chunking a document. */
export interface ChunkingResult {
	documentId: string;
	chunks: Chunk[];
	totalChunks: number;
	totalTokens: number;
	averageTokensPerChunk: number;
}
