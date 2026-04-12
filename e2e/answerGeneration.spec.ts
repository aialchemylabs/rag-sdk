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
import { RagSdkError } from '../src/errors/ragError.js';
import { RagErrorCode } from '../src/errors/errorCodes.js';

beforeEach(() => {
	resetState();
});

describe('Answer Generation & Citation Policies', () => {
	it('generates an answer with citations when evidence exists', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.answer('How does the RAG SDK work?');

		expect(result.answer).toBeDefined();
		expect(result.answer.length).toBeGreaterThan(0);
		expect(result.citations.length).toBeGreaterThan(0);
		expect(result.sources.length).toBeGreaterThan(0);
		expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
		expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
		expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);

		const citation = result.citations[0];
		expect(citation?.anchor).toBeDefined();
		expect(citation?.anchor.documentId).toBeDefined();
		expect(citation?.anchor.sourceName).toBeDefined();
		expect(citation?.relevanceScore).toBeGreaterThan(0);
		expect(citation?.citationIndex).toBe(1);
		expect(citation?.text.length).toBeGreaterThan(0);
	});

	it('returns source document references', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-sources' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.answer('RAG SDK');

		for (const source of result.sources) {
			expect(source.documentId).toBeDefined();
			expect(source.sourceName).toBeDefined();
			expect(source.pageRange).toBeDefined();
		}
	});

	it('refuse policy: refuses answer when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-refuse' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'refuse',
				},
			}),
		);

		const result = await rag.answer('What is the capital of Mars?');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.citations.length).toBe(0);
		expect(result.answer).toContain('cannot provide an answer');
		expect(result.disclaimer).toBeDefined();
	});

	it('warn policy: warns when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-warn' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'warn',
				},
			}),
		);

		const result = await rag.answer('Nonexistent topic');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.answer).toContain('No sufficient evidence');
		expect(result.disclaimer).toContain('WARNING');
	});

	it('allow policy: returns empty answer when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-allow' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'allow',
				},
			}),
		);

		const result = await rag.answer('Nothing relevant');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.answer).toBe('');
	});

	it('throws NOT_CONFIGURED when answering is not set up', async () => {
		const rag = await createRag(baseConfig());

		expect(() => rag.answer('test')).toThrow(RagSdkError);

		try {
			rag.answer('test');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.NOT_CONFIGURED);
		}
	});
});
