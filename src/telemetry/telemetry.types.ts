/**
 * Discriminated event types emitted by the telemetry subsystem.
 *
 * Contract: within a single ingest/retrieve/answer call, every `<stage>_started`
 * event is followed by exactly one of `<stage>_completed` or `<stage>_failed`.
 * Consumers can attribute a failure to a stage by looking at the matching
 * `*_failed` event without tracking pipeline order.
 */
export type TelemetryEventType =
	// Ingest pipeline — top-level
	| 'ingestion_started'
	| 'ingestion_completed'
	| 'ingestion_failed'
	// Ingest pipeline — OCR / extract stage
	| 'ocr_started'
	| 'ocr_completed'
	| 'ocr_failed'
	// Ingest pipeline — chunking stage
	| 'chunking_started'
	| 'chunking_completed'
	| 'chunking_failed'
	// Ingest pipeline — embeddings stage
	| 'embeddings_started'
	| 'embeddings_completed'
	| 'embeddings_failed'
	// Ingest pipeline — Qdrant upsert stage
	| 'qdrant_upsert_started'
	| 'qdrant_upsert_completed'
	| 'qdrant_upsert_failed'
	// Retrieval pipeline
	| 'retrieval_started'
	| 'retrieval_executed'
	| 'retrieval_failed'
	// Answer generation pipeline
	| 'answer_generation_started'
	| 'answer_generation_executed'
	| 'answer_generation_failed';

/** A single telemetry event emitted during SDK operations. */
export interface TelemetryEvent {
	type: TelemetryEventType;
	timestamp: string;
	durationMs?: number;
	documentId?: string;
	tenantId?: string;
	metadata?: Record<string, unknown>;
	error?: string;
}

/** A named numeric metric data point for monitoring/observability. */
export interface MetricEntry {
	name: string;
	value: number;
	unit: string;
	timestamp: string;
	tags?: Record<string, string>;
}
