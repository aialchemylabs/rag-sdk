/** Persisted document metadata record, stored independently from chunks. */
export interface StoredDocument {
	documentId: string;
	sourceName: string;
	mimeType: string;
	pageCount: number;
	chunkCount: number;
	totalTokens: number;
	tenantId: string;
	domainId?: string;
	tags?: string[];
	embeddingVersion: string;
	processingMode: string;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

/** Filter criteria for listing documents from the store. */
export interface DocumentStoreListFilters {
	tenantId: string;
	domainId?: string;
	tags?: string[];
	limit?: number;
	offset?: number;
}

/**
 * Abstract storage interface for document metadata.
 * Implementations may use in-memory maps, databases, or other backends.
 */
export interface DocumentStore {
	/** Insert or replace a document record. */
	put(doc: StoredDocument): Promise<void>;
	/** Retrieve a document by ID and tenant. Returns null if not found. */
	get(documentId: string, tenantId: string): Promise<StoredDocument | null>;
	/** List documents matching the given filters. */
	list(filters: DocumentStoreListFilters): Promise<StoredDocument[]>;
	/** Delete a document record. Returns true if it existed. */
	delete(documentId: string, tenantId: string): Promise<boolean>;
	/** Partially update a document record. */
	update(documentId: string, tenantId: string, patch: Partial<StoredDocument>): Promise<void>;
}
