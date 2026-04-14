import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@qdrant/js-client-rest', async () => ({
	QdrantClient: (await import('./e2eHelpers.js')).MockQdrantClient,
}));
vi.mock('openai', async () => ({
	default: (await import('./e2eHelpers.js')).MockOpenAI,
}));
vi.mock('@mistralai/mistralai', async () => ({
	Mistral: (await import('./e2eHelpers.js')).MockMistral,
}));

import { resetState, baseConfig, SAMPLE_TEXT } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';

beforeEach(() => {
	resetState();
});

describe('Telemetry Events', () => {
	it('emits all pipeline events during text ingestion', async () => {
		const events: Array<{ type: string; data: unknown }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => {
						events.push(event as { type: string; data: unknown });
					},
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('ingestion_started');
		expect(eventTypes).toContain('chunking_started');
		expect(eventTypes).toContain('chunking_completed');
		expect(eventTypes).toContain('embeddings_started');
		expect(eventTypes).toContain('embeddings_completed');
		expect(eventTypes).toContain('qdrant_upsert_started');
		expect(eventTypes).toContain('qdrant_upsert_completed');
		expect(eventTypes).toContain('ingestion_completed');
	});

	it('delivers events to a per-call telemetry override in addition to the client-scoped handler', async () => {
		const clientEvents: string[] = [];
		const perCallEvents: string[] = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-override' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => {
						clientEvents.push((event as { type: string }).type);
					},
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT, {
			telemetry: {
				onEvent: (event) => {
					perCallEvents.push(event.type);
				},
			},
		});

		expect(perCallEvents).toContain('ingestion_started');
		expect(perCallEvents).toContain('ingestion_completed');
		expect(clientEvents).toContain('ingestion_started');
		expect(clientEvents).toContain('ingestion_completed');
	});

	it('uses a caller-supplied documentId when provided via options', async () => {
		const rag = await createRag(
			baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-docid' } }),
		);

		const result = await rag.ingest.text(SAMPLE_TEXT, { documentId: 'platform-uuid-42' });

		expect(result.documentId).toBe('platform-uuid-42');
	});

	it('emits OCR events during buffer ingestion', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-ocr' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.buffer(Buffer.from('pdf'), 'test.pdf');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('ocr_completed');
	});

	it('emits retrieval_executed on search', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-retrieve' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		await rag.retrieve('test query');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('retrieval_executed');
	});

	it('emits answer_generation_executed on answer', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-answer' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		await rag.answer('test query');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('answer_generation_executed');
	});
});
