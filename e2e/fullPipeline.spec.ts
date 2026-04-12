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

import { resetState, baseConfig } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';

beforeEach(() => {
	resetState();
});

describe('Full Pipeline Integration', () => {
	it('completes the full ingest → retrieve → answer cycle', async () => {
		const events: string[] = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-full' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'refuse',
				},
				telemetry: {
					enabled: true,
					onEvent: (e: unknown) => events.push((e as { type: string }).type),
				},
			}),
		);

		// Step 1: Ingest multiple documents
		const doc1 = await rag.ingest.text(
			'Machine learning is a subset of artificial intelligence that enables systems to learn from data.',
			{ tags: ['ml'], domainId: 'ai' },
		);
		const doc2 = await rag.ingest.buffer(Buffer.from('pdf'), 'report.pdf', {
			tags: ['report'],
			domainId: 'ai',
		});

		expect(doc1.status).toBe('completed');
		expect(doc2.status).toBe('completed');

		// Step 2: Verify documents exist
		const docs = await rag.documents.list();
		expect(docs.length).toBe(2);

		// Step 3: Retrieve
		const retrieval = await rag.retrieve('What is machine learning?');
		expect(retrieval.matches.length).toBeGreaterThan(0);

		// Step 4: Answer with citations
		const answer = await rag.answer('What is machine learning?');
		expect(answer.answer.length).toBeGreaterThan(0);
		expect(answer.citations.length).toBeGreaterThan(0);
		expect(['high', 'medium', 'low']).toContain(answer.confidence);

		// Step 5: Delete one document
		await rag.documents.delete(doc1.documentId);
		const remainingDocs = await rag.documents.list();
		expect(remainingDocs.length).toBe(1);
		expect(remainingDocs[0]?.documentId).toBe(doc2.documentId);

		// Step 6: Verify telemetry captured the full lifecycle
		expect(events).toContain('ingestion_started');
		expect(events).toContain('ingestion_completed');
		expect(events).toContain('retrieval_executed');
		expect(events).toContain('answer_generation_executed');
	});
});
