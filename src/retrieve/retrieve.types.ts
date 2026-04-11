import type { CitationAnchor } from './citation.types.js';
import type { ChunkMetadata } from '../chunking/chunk.types.js';
import type { SecurityContext } from '../config/security.types.js';

/** Options for vector similarity retrieval. */
export interface RetrieveOptions {
	topK?: number;
	scoreThreshold?: number;
	filters?: {
		documentIds?: string[];
		tags?: string[];
		domainId?: string;
		metadata?: Record<string, unknown>;
	};
	security?: SecurityContext;
	includeMetadata?: boolean;
}

/** Extended options for hybrid (dense + sparse) retrieval. */
export interface HybridRetrieveOptions extends RetrieveOptions {
	fusionAlpha?: number;
}

/** A single chunk returned by a retrieval query. */
export interface RetrieveMatch {
	chunkId: string;
	documentId: string;
	content: string;
	score: number;
	metadata: ChunkMetadata;
	citation: CitationAnchor;
}

/** Aggregated result from a retrieval query. */
export interface RetrieveResult {
	query: string;
	matches: RetrieveMatch[];
	totalMatches: number;
	searchTimeMs: number;
	searchType: 'dense' | 'hybrid';
}
