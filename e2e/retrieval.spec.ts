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
import type { RagClient } from '../src/createRag.js';
import { RagSdkError } from '../src/errors/ragError.js';
import { RagErrorCode } from '../src/errors/errorCodes.js';

beforeEach(() => {
	resetState();
});

// ---------------------------------------------------------------------------
// Hybrid Search
// ---------------------------------------------------------------------------

describe('Hybrid Search', () => {
	it('returns results with searchType hybrid when configured', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-hybrid' },
				retrieval: { hybrid: { enabled: true, fusionAlpha: 0.5 } },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.retrieve.hybrid('RAG SDK document processing');

		expect(result.searchType).toBe('hybrid');
		expect(result.matches.length).toBeGreaterThan(0);
	});

	it('throws NOT_CONFIGURED when hybrid is not enabled', async () => {
		const rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-no-hybrid' } }));

		await rag.ingest.text(SAMPLE_TEXT);
		await expect(rag.retrieve.hybrid('test query')).rejects.toThrow(RagSdkError);

		try {
			await rag.retrieve.hybrid('test query');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.NOT_CONFIGURED);
		}
	});
});

// ---------------------------------------------------------------------------
// Retrieval Filtering
// ---------------------------------------------------------------------------

describe('Retrieval Filtering', () => {
	let rag: RagClient;
	let docId1: string;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-filter' } }));

		const r1 = await rag.ingest.text('Document about machine learning and neural networks.', {
			tags: ['ml', 'ai'],
			domainId: 'data-science',
		});
		docId1 = r1.documentId;

		await rag.ingest.text('Document about web development and React frameworks.', {
			tags: ['web', 'frontend'],
			domainId: 'engineering',
		});
	});

	it('filters by documentIds', async () => {
		const result = await rag.retrieve('document', {
			filters: { documentIds: [docId1] },
		});

		for (const match of result.matches) {
			expect(match.documentId).toBe(docId1);
		}
	});

	it('filters by tags', async () => {
		const result = await rag.retrieve('document', {
			filters: { tags: ['ml'] },
		});

		for (const match of result.matches) {
			expect(match.metadata.tags).toContain('ml');
		}
	});

	it('filters by domainId', async () => {
		const result = await rag.retrieve('document', {
			filters: { domainId: 'engineering' },
		});

		for (const match of result.matches) {
			expect(match.metadata.domainId).toBe('engineering');
		}
	});

	it('respects topK limit', async () => {
		const result = await rag.retrieve('document', { topK: 1 });
		expect(result.matches.length).toBeLessThanOrEqual(1);
	});
});
