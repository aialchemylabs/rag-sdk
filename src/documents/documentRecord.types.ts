/** Stored metadata for an ingested document. */
export interface DocumentRecord {
	documentId: string;
	sourceName: string;
	mimeType: string;
	pageCount: number;
	chunkCount: number;
	totalTokens: number;
	tenantId?: string;
	domainId?: string;
	tags?: string[];
	embeddingVersion: string;
	processingMode: string;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

/** Filters for listing / querying documents. */
export interface DocumentListFilters {
	tenantId?: string;
	domainId?: string;
	tags?: string[];
	limit?: number;
	offset?: number;
}

/** Partial update payload for document metadata. */
export interface DocumentMetadataPatch {
	tags?: string[];
	domainId?: string;
	metadata?: Record<string, unknown>;
}
