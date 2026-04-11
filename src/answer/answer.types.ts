import type { Citation } from '../retrieve/citation.types.js';
import type { SecurityContext } from '../config/security.types.js';

/** Options for RAG answer generation. */
export interface AnswerOptions {
	topK?: number;
	scoreThreshold?: number;
	filters?: {
		documentIds?: string[];
		tags?: string[];
		domainId?: string;
	};
	security?: SecurityContext;
	maxTokens?: number;
	temperature?: number;
	noCitationPolicy?: 'warn' | 'refuse' | 'allow';
}

/** A citation anchoring a claim in the generated answer to source text. */
export interface AnswerCitation extends Citation {
	text: string;
}

/** Full response from the answer generation pipeline, including citations and confidence. */
export interface AnswerResult {
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
