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

describe('Document CRUD', () => {
	let rag: RagClient;
	let docId: string;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-crud' } }));
		const result = await rag.ingest.text(SAMPLE_TEXT, {
			tags: ['original'],
			domainId: 'test-domain',
		});
		docId = result.documentId;
	});

	it('documents.get returns the ingested document', async () => {
		const doc = await rag.documents.get(docId);
		expect(doc).not.toBeNull();
		expect(doc?.documentId).toBe(docId);
		expect(doc?.sourceName).toBe('text-input.txt');
		expect(doc?.chunkCount).toBeGreaterThan(0);
		expect(doc?.totalTokens).toBeGreaterThan(0);
		expect(doc?.embeddingVersion).toMatch(/openai:text-embedding/);
	});

	it('documents.get returns null for non-existent document', async () => {
		const doc = await rag.documents.get('doc_nonexistent');
		expect(doc).toBeNull();
	});

	it('documents.list returns all documents', async () => {
		await rag.ingest.text('Another document for listing.');
		const docs = await rag.documents.list();

		expect(docs.length).toBe(2);
		expect(docs.some((d) => d.documentId === docId)).toBe(true);
	});

	it('documents.list filters by domainId', async () => {
		await rag.ingest.text('Different domain doc', { domainId: 'other-domain' });
		const docs = await rag.documents.list({ domainId: 'test-domain' });

		expect(docs.length).toBe(1);
		expect(docs[0]?.documentId).toBe(docId);
	});

	it('documents.updateMetadata patches tags and domain', async () => {
		await rag.documents.updateMetadata(docId, {
			tags: ['updated', 'v2'],
			domainId: 'new-domain',
		});

		const doc = await rag.documents.get(docId);
		expect(doc?.tags).toEqual(['updated', 'v2']);
		expect(doc?.domainId).toBe('new-domain');
	});

	it('documents.updateMetadata throws for non-existent document', async () => {
		await expect(rag.documents.updateMetadata('doc_nonexistent', { tags: ['x'] })).rejects.toThrow(RagSdkError);
	});

	it('documents.delete removes all chunks for a document', async () => {
		const deleteResult = await rag.documents.delete(docId);
		expect(deleteResult.deleted).toBeGreaterThan(0);

		const doc = await rag.documents.get(docId);
		expect(doc).toBeNull();
	});

	it('documents.reindex replaces chunks with new content', async () => {
		const newChunks = [
			{
				chunkId: 'chk-new-1',
				content: 'Reindexed content part one.',
				metadata: {
					sourceName: 'text-input.txt',
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
			{
				chunkId: 'chk-new-2',
				content: 'Reindexed content part two.',
				metadata: {
					sourceName: 'text-input.txt',
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
		];

		const result = await rag.documents.reindex(docId, newChunks);
		expect(result.reindexed).toBe(2);

		const doc = await rag.documents.get(docId);
		expect(doc?.chunkCount).toBe(2);
	});

	it('documents.reindex rejects chunks with missing citation metadata', async () => {
		const invalidChunks = [
			{
				chunkId: 'chk-invalid-1',
				content: 'Chunk without source name.',
				metadata: {
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
		];

		await expect(rag.documents.reindex(docId, invalidChunks)).rejects.toThrow(RagSdkError);

		try {
			await rag.documents.reindex(docId, invalidChunks);
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.VALIDATION_INVALID_INPUT);
			expect((err as RagSdkError).message).toContain('sourceName');
		}
	});
});
