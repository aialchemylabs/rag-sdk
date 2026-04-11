/** Pinpoints the exact source location within a document that supports a claim. */
export interface CitationAnchor {
	documentId: string;
	sourceName: string;
	chunkId: string;
	pageStart: number;
	pageEnd: number;
	/** A short excerpt from the chunk that supports the cited claim. */
	excerpt?: string;
}

/**
 * A citation linking an answer claim to its source chunk.
 * Part of the no-citation-no-claim guarantee: every claim must have a citation.
 */
export interface Citation {
	anchor: CitationAnchor;
	/** Similarity score between the query and the cited chunk. */
	relevanceScore: number;
	/** Position of this citation in the answer's citation list (1-based). */
	citationIndex: number;
}
