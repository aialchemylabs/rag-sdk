import { chunkDocument, type ChunkerConfig } from './chunker.js';
import type { NormalizedDocument } from '../normalize/document.types.js';

const CHUNKER_CONFIG: ChunkerConfig = {
	targetTokens: 100,
	maxTokens: 200,
	overlapTokens: 20,
	headingAware: true,
	preservePageBoundaries: false,
	preserveTables: true,
};

const CHUNKING_CONTEXT = {
	embeddingVersion: 'v1',
	processingMode: 'text_first',
};

function createFixtureDocument(): NormalizedDocument {
	const markdown = [
		'# Introduction',
		'',
		'This is a sample document used for testing the chunking pipeline.',
		'It contains enough text to produce at least one chunk when processed.',
		'',
		'## Details',
		'',
		'The RAG SDK splits documents into chunks for embedding and retrieval.',
		'Each chunk carries metadata linking it back to its source document.',
	].join('\n');

	return {
		documentId: 'doc-test-001',
		sourceName: 'test-document.pdf',
		mimeType: 'application/pdf',
		pageCount: 1,
		pages: [
			{
				pageIndex: 0,
				markdown,
				text: markdown,
				characterCount: markdown.length,
				hasImages: false,
				hasTablesOnPage: false,
				warnings: [],
			},
		],
		tables: [],
		links: [],
		warnings: [],
		providerMetadata: {
			provider: 'mistral',
			model: 'mistral-ocr-latest',
			processingTimeMs: 1200,
			rawPageCount: 1,
		},
		totalCharacters: markdown.length,
		createdAt: new Date().toISOString(),
	};
}

describe('chunkDocument', () => {
	it('should produce at least one chunk', () => {
		const doc = createFixtureDocument();

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		expect(result.chunks.length).toBeGreaterThanOrEqual(1);
		expect(result.totalChunks).toBe(result.chunks.length);
	});

	it('should include correct metadata on each chunk', () => {
		const doc = createFixtureDocument();

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);
		const chunk = result.chunks[0];

		expect(chunk?.metadata.documentId).toBe('doc-test-001');
		expect(chunk?.metadata.sourceName).toBe('test-document.pdf');
		expect(typeof chunk?.metadata.pageStart).toBe('number');
		expect(typeof chunk?.metadata.pageEnd).toBe('number');
	});

	it('should produce chunks with non-empty content', () => {
		const doc = createFixtureDocument();

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		for (const chunk of result.chunks) {
			expect(chunk.content.length).toBeGreaterThan(0);
			expect(chunk.tokenCount).toBeGreaterThan(0);
		}
	});
});
