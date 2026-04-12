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

import { resetState, baseConfig, SAMPLE_TEXT, UNRELATED_TEXT, ocrCallHistory } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';
import type { RagClient } from '../src/createRag.js';
import type { IngestResult } from '../src/ingest/ingest.types.js';

beforeEach(() => {
	resetState();
});

// ---------------------------------------------------------------------------
// Text Ingestion → Retrieval Pipeline
// ---------------------------------------------------------------------------

describe('Text Ingestion → Retrieval Pipeline', () => {
	let rag: RagClient;
	let ingestResult: IngestResult;

	beforeEach(async () => {
		rag = await createRag(baseConfig());
		ingestResult = await rag.ingest.text(SAMPLE_TEXT, {
			tags: ['test', 'rag'],
			domainId: 'engineering',
			metadata: { author: 'test-suite' },
		});
	});

	it('returns completed status with document metadata', () => {
		expect(ingestResult.status).toBe('completed');
		expect(ingestResult.documentId).toMatch(/^doc_/);
		expect(ingestResult.sourceName).toBe('text-input.txt');
		expect(ingestResult.chunksIndexed).toBeGreaterThan(0);
		expect(ingestResult.processingTimeMs).toBeGreaterThanOrEqual(0);
		expect(ingestResult.warnings).toEqual([]);
	});

	it('produces a normalizedDocument with one page', () => {
		expect(ingestResult.normalizedDocument).toBeDefined();
		expect(ingestResult.normalizedDocument?.pageCount).toBe(1);
		expect(ingestResult.normalizedDocument?.pages[0]?.text).toBe(SAMPLE_TEXT);
		expect(ingestResult.normalizedDocument?.mimeType).toBe('text/plain');
	});

	it('produces chunks with correct metadata', () => {
		expect(ingestResult.chunkingResult).toBeDefined();
		const chunks = ingestResult.chunkingResult?.chunks ?? [];
		expect(chunks.length).toBeGreaterThan(0);

		const firstChunk = chunks[0]!;
		expect(firstChunk.metadata.documentId).toBe(ingestResult.documentId);
		expect(firstChunk.metadata.sourceName).toBe('text-input.txt');
		expect(firstChunk.metadata.embeddingVersion).toMatch(/openai:text-embedding/);
		expect(firstChunk.content.length).toBeGreaterThan(0);
	});

	it('retrieves matching chunks for a related query', async () => {
		const result = await rag.retrieve('How does the RAG SDK process documents?');

		expect(result.query).toBe('How does the RAG SDK process documents?');
		expect(result.searchType).toBe('dense');
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);

		const match = result.matches[0];
		expect(match?.documentId).toBe(ingestResult.documentId);
		expect(match?.content.length).toBeGreaterThan(0);
		expect(match?.score).toBeGreaterThan(0);
	});

	it('retrieval matches include citation anchors', async () => {
		const result = await rag.retrieve('RAG SDK');

		const match = result.matches[0]!;
		expect(match.citation).toBeDefined();
		expect(match.citation.documentId).toBe(ingestResult.documentId);
		expect(match.citation.sourceName).toBe('text-input.txt');
		expect(match.citation.chunkId).toBeDefined();
		expect(typeof match.citation.pageStart).toBe('number');
		expect(typeof match.citation.pageEnd).toBe('number');
		expect(match.citation.excerpt).toBeDefined();
	});

	it('retrieval matches include chunk metadata', async () => {
		const result = await rag.retrieve('RAG SDK');

		const meta = result.matches[0]!.metadata;
		expect(meta.documentId).toBe(ingestResult.documentId);
		expect(meta.processingMode).toBeDefined();
		expect(meta.embeddingVersion).toBeDefined();
		expect(meta.createdAt).toBeDefined();
	});

	it('returns no matches for a completely unrelated query when threshold is high', async () => {
		const rag2 = await createRag(
			baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-unrelated' } }),
		);
		await rag2.ingest.text(UNRELATED_TEXT);

		const result = await rag2.retrieve('RAG SDK document processing', { scoreThreshold: 0.99 });
		expect(result.matches.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Buffer Ingestion via OCR
// ---------------------------------------------------------------------------

describe('Buffer Ingestion via OCR', () => {
	let rag: RagClient;
	let ingestResult: IngestResult;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-ocr' } }));
		const pdfBuffer = Buffer.from('mock-pdf-content');
		ingestResult = await rag.ingest.buffer(pdfBuffer, 'quarterly-report.pdf', {
			tags: ['finance', 'q3'],
		});
	});

	it('processes buffer through OCR and returns completed status', () => {
		expect(ingestResult.status).toBe('completed');
		expect(ingestResult.documentId).toMatch(/^doc_/);
		expect(ingestResult.sourceName).toBe('quarterly-report.pdf');
		expect(ingestResult.chunksIndexed).toBeGreaterThan(0);
	});

	it('calls Mistral OCR with correct model', () => {
		expect(ocrCallHistory.length).toBe(1);
		expect(ocrCallHistory[0]?.model).toBe('mistral-ocr-latest');
	});

	it('produces a normalizedDocument with multiple pages', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.pageCount).toBe(2);
		expect(doc.pages.length).toBe(2);
		expect(doc.pages[0]?.markdown).toContain('Quarterly Report');
		expect(doc.pages[1]?.markdown).toContain('Market Analysis');
	});

	it('extracts tables from OCR markdown', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.tables.length).toBeGreaterThan(0);
		expect(doc.tables[0]?.markdown).toContain('Revenue');
	});

	it('extracts links from OCR markdown', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.links.length).toBeGreaterThan(0);
		expect(doc.links[0]?.url).toBe('https://example.com');
	});

	it('chunks carry page range metadata', () => {
		const chunks = ingestResult.chunkingResult?.chunks ?? [];
		for (const chunk of chunks) {
			expect(typeof chunk.metadata.pageStart).toBe('number');
			expect(typeof chunk.metadata.pageEnd).toBe('number');
			expect(chunk.metadata.pageEnd).toBeGreaterThanOrEqual(chunk.metadata.pageStart);
		}
	});

	it('retrieves chunks from OCR-ingested document', async () => {
		const result = await rag.retrieve('quarterly revenue growth');
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0]?.documentId).toBe(ingestResult.documentId);
	});
});

// ---------------------------------------------------------------------------
// URL Ingestion
// ---------------------------------------------------------------------------

describe('URL Ingestion', () => {
	it('ingests from a URL via OCR', async () => {
		const rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-url' } }));
		const result = await rag.ingest.url('https://example.com/report.pdf');

		expect(result.status).toBe('completed');
		expect(result.sourceName).toBe('report.pdf');
		expect(result.chunksIndexed).toBeGreaterThan(0);
		expect(ocrCallHistory.length).toBe(1);
	});
});
