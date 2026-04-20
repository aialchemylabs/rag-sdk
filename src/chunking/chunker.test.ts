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

function buildRow(rowIndex: number, cols: number, cellWordCount: number): string {
	const cells: string[] = [];
	for (let c = 0; c < cols; c++) {
		const word = `r${rowIndex}c${c}`;
		const cellText = new Array(cellWordCount).fill(word).join(' ');
		cells.push(cellText);
	}
	return `| ${cells.join(' | ')} |`;
}

function buildTableMarkdown(rowCount: number, cols: number, cellWordCount: number): string {
	const headerCells: string[] = [];
	const sepCells: string[] = [];
	for (let c = 0; c < cols; c++) {
		headerCells.push(`Col${c}`);
		sepCells.push('---');
	}
	const header = `| ${headerCells.join(' | ')} |`;
	const separator = `| ${sepCells.join(' | ')} |`;
	const rows: string[] = [];
	for (let r = 0; r < rowCount; r++) {
		rows.push(buildRow(r, cols, cellWordCount));
	}
	return [header, separator, ...rows].join('\n');
}

function createTableDocument(pages: { pageIndex: number; markdown: string }[]): NormalizedDocument {
	const normalizedPages = pages.map((p) => ({
		pageIndex: p.pageIndex,
		markdown: p.markdown,
		text: p.markdown,
		characterCount: p.markdown.length,
		hasImages: false,
		hasTablesOnPage: true,
		warnings: [],
	}));
	const totalChars = normalizedPages.reduce((s, p) => s + p.characterCount, 0);
	return {
		documentId: 'doc-table-001',
		sourceName: 'tables.pdf',
		mimeType: 'application/pdf',
		pageCount: normalizedPages.length,
		pages: normalizedPages,
		tables: [],
		links: [],
		warnings: [],
		providerMetadata: {
			provider: 'mistral',
			model: 'mistral-ocr-latest',
			processingTimeMs: 100,
			rawPageCount: normalizedPages.length,
		},
		totalCharacters: totalChars,
		createdAt: new Date().toISOString(),
	};
}

describe('chunkDocument — atomic table splitting', () => {
	it('leaves a table that fits within maxTokens unchanged as a single chunk', () => {
		const table = buildTableMarkdown(3, 3, 1);
		const doc = createTableDocument([{ pageIndex: 0, markdown: `Intro paragraph.\n\n${table}` }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		const tableChunks = result.chunks.filter((c) => c.content.includes('| Col0 |'));
		expect(tableChunks.length).toBe(1);
		const tableChunk = tableChunks[0];
		expect(tableChunk?.content).toContain('| r0c0 | r0c1 | r0c2 |');
		expect(tableChunk?.content).toContain('| r1c0 | r1c1 | r1c2 |');
		expect(tableChunk?.content).toContain('| r2c0 | r2c1 | r2c2 |');
		expect(result.warnings).toBeUndefined();
	});

	it('splits an oversized table at row boundaries into multiple chunks', () => {
		const table = buildTableMarkdown(40, 4, 4);
		const doc = createTableDocument([{ pageIndex: 0, markdown: table }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		const tableChunks = result.chunks.filter((c) => c.content.includes('| Col0 |'));
		expect(tableChunks.length).toBeGreaterThan(1);
		expect(result.warnings).toBeUndefined();
		for (const chunk of tableChunks) {
			expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNKER_CONFIG.maxTokens);
		}
	});

	it('replicates the header + separator rows on every split piece', () => {
		const table = buildTableMarkdown(40, 4, 4);
		const doc = createTableDocument([{ pageIndex: 0, markdown: table }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);
		const tableChunks = result.chunks.filter((c) => c.content.includes('| Col0 |'));

		expect(tableChunks.length).toBeGreaterThan(1);
		for (const chunk of tableChunks) {
			expect(chunk.content).toMatch(/\| Col0 \| Col1 \| Col2 \| Col3 \|/);
			expect(chunk.content).toMatch(/\| --- \| --- \| --- \| --- \|/);
		}
	});

	it('skips overlap prepending on table continuation chunks', () => {
		const leadingParagraph =
			'DISTINCTIVE_TOKEN_ALPHA This paragraph precedes the table and contains enough words ' +
			'that the overlap extraction would otherwise bleed into later chunks repeatedly.';
		const table = buildTableMarkdown(40, 4, 4);
		const doc = createTableDocument([{ pageIndex: 0, markdown: `${leadingParagraph}\n\n${table}` }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);
		const tableChunks = result.chunks.filter((c) => c.content.includes('| Col0 |'));

		expect(tableChunks.length).toBeGreaterThan(1);
		for (let i = 1; i < tableChunks.length; i++) {
			const chunk = tableChunks[i];
			expect(chunk?.content.startsWith('| Col0 |')).toBe(true);
			expect(chunk?.content).not.toContain('DISTINCTIVE_TOKEN_ALPHA');
		}
	});

	it('emits a TABLE_ROW_OVERSIZE warning for a single row that exceeds maxTokens', () => {
		const table = buildTableMarkdown(1, 8, 40);
		const doc = createTableDocument([{ pageIndex: 2, markdown: table }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		expect(result.warnings).toBeDefined();
		expect(result.warnings?.length).toBeGreaterThanOrEqual(1);
		const oversize = result.warnings?.find((w) => w.code === 'TABLE_ROW_OVERSIZE');
		expect(oversize).toBeDefined();
		expect(oversize?.pageIndex).toBe(2);
		expect(oversize?.message).toMatch(/exceeds maxTokens/i);
	});

	it('preserves pageIndex and sectionPath across all split pieces', () => {
		const table = buildTableMarkdown(40, 4, 4);
		const pageMarkdown = `# Primary Heading\n\n## Subsection\n\n${table}`;
		const doc = createTableDocument([{ pageIndex: 3, markdown: pageMarkdown }]);

		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);
		const tableChunks = result.chunks.filter((c) => c.content.includes('| Col0 |'));

		expect(tableChunks.length).toBeGreaterThan(1);
		for (const chunk of tableChunks) {
			expect(chunk.metadata.pageStart).toBe(3);
			expect(chunk.metadata.pageEnd).toBe(3);
			expect(chunk.metadata.sectionTitle).toBe('Subsection');
		}
	});
});
