export interface VectorSearchOptions {
	topK: number;
	scoreThreshold?: number;
	tenantId: string;
	filters?: {
		documentIds?: string[];
		domainId?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
	};
}

export interface VectorSearchResult {
	id: string;
	score: number;
	payload: Record<string, unknown>;
}
