import type { Citation } from '../retrieve/citation.types.js';
import type { SecurityContext } from '../config/security.types.js';
import type { TelemetryEvent } from '../telemetry/telemetry.types.js';

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
	/**
	 * Optional per-call telemetry override. See `IngestOptions.telemetry` for
	 * behavior — runs in addition to the client-scoped handler; errors are
	 * swallowed and logged.
	 */
	telemetry?: {
		onEvent?: (event: TelemetryEvent) => void | Promise<void>;
	};
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
