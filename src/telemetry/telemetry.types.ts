/** Discriminated event types emitted by the telemetry subsystem. */
export type TelemetryEventType =
	| 'ingestion_started'
	| 'ingestion_completed'
	| 'ingestion_failed'
	| 'ocr_completed'
	| 'ocr_failed'
	| 'embeddings_completed'
	| 'embeddings_failed'
	| 'qdrant_upsert_completed'
	| 'retrieval_executed'
	| 'answer_generation_executed';

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
