import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';
import type { TelemetryEvent, MetricEntry } from '@aialchemy/rag-sdk';

// Collect events and metrics so we can summarise them at the end
const events: TelemetryEvent[] = [];
const metrics: MetricEntry[] = [];

async function main() {
	// Initialize the SDK with telemetry callbacks.
	// onEvent fires for lifecycle transitions (ingestion started/completed, etc.)
	// onMetric fires for numeric data points (durations, counts).
	const rag = await createRag({
		mistral: {
			apiKey: process.env.MISTRAL_API_KEY!,
			model: 'mistral-ocr-latest',
		},
		qdrant: {
			url: process.env.QDRANT_URL!,
			apiKey: process.env.QDRANT_API_KEY,
			collection: process.env.QDRANT_COLLECTION!,
		},
		embeddings: {
			provider: 'openai',
			model: 'text-embedding-3-small',
			apiKey: process.env.OPENAI_API_KEY!,
		},
		telemetry: {
			enabled: true,
			onEvent: (raw: unknown) => {
				const event = raw as TelemetryEvent;
				events.push(event);
				// Log each event as structured JSON for easy parsing by log aggregators
				console.log(
					JSON.stringify({
						level: event.error ? 'error' : 'info',
						type: event.type,
						documentId: event.documentId,
						tenantId: event.tenantId,
						durationMs: event.durationMs,
						ts: event.timestamp,
					}),
				);
			},
			onMetric: (raw: unknown) => {
				const metric = raw as MetricEntry;
				metrics.push(metric);
				// Log metrics in a format compatible with StatsD / Prometheus exporters
				console.log(`METRIC ${metric.name}=${metric.value}${metric.unit} [${metric.tags ? JSON.stringify(metric.tags) : ''}]`);
			},
		},
		defaults: {
			tenantId: 'tenant-a',
		},
	});

	// --- Trigger telemetry by running an ingestion ---
	// Expected events: ingestion_started, ocr_completed, embeddings_completed,
	//                  qdrant_upsert_completed, ingestion_completed
	console.log('\n=== Ingesting document ===');
	const ingestResult = await rag.ingest.file('./documents/handbook.pdf', {
		processingMode: ProcessingMode.OcrFirst,
		tags: ['hr', 'handbook'],
		metadata: { year: '2025' },
	});

	console.log(`\nIngestion finished: ${ingestResult.documentId} (${ingestResult.processingTimeMs}ms)`);

	// --- Trigger telemetry by running a retrieval ---
	// Expected event: retrieval_executed
	console.log('\n=== Running retrieval ===');
	const retrievalResult = await rag.retrieve('What is the vacation policy?', {
		topK: 3,
		scoreThreshold: 0.7,
	});

	console.log(`\nRetrieval finished: ${retrievalResult.totalMatches} matches (${retrievalResult.searchTimeMs}ms)`);

	// --- Summarise captured telemetry ---
	console.log('\n=== Telemetry summary ===');

	console.log(`\nEvents captured: ${events.length}`);
	for (const event of events) {
		const suffix = event.durationMs != null ? ` (${event.durationMs}ms)` : '';
		const errorSuffix = event.error ? ` ERROR: ${event.error}` : '';
		console.log(`  ${event.type}${suffix}${errorSuffix}`);
	}

	console.log(`\nMetrics captured: ${metrics.length}`);
	for (const metric of metrics) {
		console.log(`  ${metric.name}: ${metric.value} ${metric.unit}`);
	}

	// Show which event types fired during each phase
	const ingestionEvents = events.filter((e) => e.type.startsWith('ingestion') || e.type.startsWith('ocr') || e.type.startsWith('embedding') || e.type.startsWith('qdrant'));
	const retrievalEvents = events.filter((e) => e.type === 'retrieval_executed');

	console.log(`\nIngestion phase events: ${ingestionEvents.map((e) => e.type).join(', ')}`);
	console.log(`Retrieval phase events: ${retrievalEvents.map((e) => e.type).join(', ')}`);
}

main().catch(console.error);
