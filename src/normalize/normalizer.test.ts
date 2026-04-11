import { describe, expect, it, vi } from 'vitest';
import { normalizeOcrResult, type NormalizeOptions } from './normalizer.js';
import type { MistralOcrRawResult } from '../ocr/index.js';

vi.mock('../telemetry/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock('../utils/index.js', () => ({
	generateId: (prefix?: string) => (prefix ? `${prefix}_test-id` : 'test-id'),
}));

function makeOptions(overrides?: Partial<NormalizeOptions>): NormalizeOptions {
	return {
		sourceName: 'test.pdf',
		mimeType: 'application/pdf',
		model: 'mistral-ocr-latest',
		processingTimeMs: 100,
		...overrides,
	};
}

function makeRawResult(pages: { index: number; markdown: string }[]): MistralOcrRawResult {
	return {
		pages: pages.map((p) => ({
			index: p.index,
			markdown: p.markdown,
			images: [],
			dimensions: null,
		})),
		model: 'mistral-ocr-latest',
		usageInfo: { pagesProcessed: pages.length },
	};
}

describe('normalizeOcrResult', () => {
	it('normalizes basic OCR output to NormalizedDocument', () => {
		const raw = makeRawResult([
			{ index: 0, markdown: '# Hello World\n\nThis is a test document with enough content to avoid warnings.' },
		]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.documentId).toBe('doc_test-id');
		expect(doc.sourceName).toBe('test.pdf');
		expect(doc.mimeType).toBe('application/pdf');
		expect(doc.pageCount).toBe(1);
		expect(doc.pages).toHaveLength(1);
		expect(doc.pages[0]?.pageIndex).toBe(0);
		expect(doc.pages[0]?.markdown).toContain('# Hello World');
		expect(doc.totalCharacters).toBeGreaterThan(0);
		expect(doc.providerMetadata.provider).toBe('mistral');
		expect(doc.providerMetadata.model).toBe('mistral-ocr-latest');
		expect(doc.providerMetadata.processingTimeMs).toBe(100);
		expect(doc.createdAt).toBeTruthy();
	});

	it('uses provided documentId when given', () => {
		const raw = makeRawResult([{ index: 0, markdown: 'Some content that is long enough.' }]);

		const doc = normalizeOcrResult(raw, makeOptions({ documentId: 'custom-doc-123' }));

		expect(doc.documentId).toBe('custom-doc-123');
	});

	it('extracts tables from markdown content', () => {
		const tableMarkdown = ['| Name | Age |', '| --- | --- |', '| Alice | 30 |', '| Bob | 25 |'].join('\n');

		const raw = makeRawResult([{ index: 0, markdown: tableMarkdown }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.tables).toHaveLength(1);
		expect(doc.tables[0]?.pageIndex).toBe(0);
		expect(doc.tables[0]?.tableIndex).toBe(0);
		expect(doc.tables[0]?.rowCount).toBe(3); // header + 2 data rows (separator excluded)
		expect(doc.tables[0]?.columnCount).toBe(2);
		expect(doc.pages[0]?.hasTablesOnPage).toBe(true);
	});

	it('extracts multiple tables across pages', () => {
		const table1 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
		const table2 = '| X | Y | Z |\n| --- | --- | --- |\n| a | b | c |\n';

		const raw = makeRawResult([
			{ index: 0, markdown: table1 },
			{ index: 1, markdown: table2 },
		]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.tables).toHaveLength(2);
		expect(doc.tables[0]?.tableIndex).toBe(0);
		expect(doc.tables[1]?.tableIndex).toBe(1);
		expect(doc.tables[1]?.pageIndex).toBe(1);
		expect(doc.tables[1]?.columnCount).toBe(3);
	});

	it('extracts links from markdown content', () => {
		const markdown = 'Visit [Google](https://google.com) and [GitHub](https://github.com) for more.';
		const raw = makeRawResult([{ index: 0, markdown }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.links).toHaveLength(2);
		expect(doc.links[0]).toEqual({ text: 'Google', url: 'https://google.com', pageIndex: 0 });
		expect(doc.links[1]).toEqual({ text: 'GitHub', url: 'https://github.com', pageIndex: 0 });
	});

	it('does not extract image references as links', () => {
		const markdown = '![alt text](https://img.example.com/photo.png) and [a link](https://example.com)';
		const raw = makeRawResult([{ index: 0, markdown }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.links).toHaveLength(1);
		expect(doc.links[0]?.url).toBe('https://example.com');
	});

	it('generates EMPTY_PAGE warning for empty pages', () => {
		const raw = makeRawResult([{ index: 0, markdown: '' }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.warnings).toContainEqual(
			expect.objectContaining({ code: 'EMPTY_PAGE', pageIndex: 0, severity: 'medium' }),
		);
	});

	it('generates LOW_CONTENT warning for short pages', () => {
		const raw = makeRawResult([{ index: 0, markdown: 'Short.' }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.warnings).toContainEqual(
			expect.objectContaining({ code: 'LOW_CONTENT', pageIndex: 0, severity: 'low' }),
		);
	});

	it('generates NO_PAGES warning when OCR returns zero pages', () => {
		const raw = makeRawResult([]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.warnings).toContainEqual(expect.objectContaining({ code: 'NO_PAGES', severity: 'high' }));
	});

	it('generates NO_CONTENT warning when all pages are empty', () => {
		const raw = makeRawResult([
			{ index: 0, markdown: '' },
			{ index: 1, markdown: '' },
		]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.warnings).toContainEqual(expect.objectContaining({ code: 'NO_CONTENT', severity: 'high' }));
	});

	it('strips markdown formatting from text field', () => {
		const markdown = '# Heading\n\n**bold** and *italic* text with [link](http://x.com)\n\n> quote';
		const raw = makeRawResult([{ index: 0, markdown }]);

		const doc = normalizeOcrResult(raw, makeOptions());

		const text = doc.pages[0]?.text;
		expect(text).not.toContain('#');
		expect(text).not.toContain('**');
		expect(text).not.toContain('*');
		expect(text).not.toContain('[link]');
		expect(text).not.toContain('>');
		expect(text).toContain('bold');
		expect(text).toContain('italic');
		expect(text).toContain('link');
	});

	it('detects images in markdown', () => {
		const raw = makeRawResult([
			{ index: 0, markdown: '![chart](https://example.com/chart.png)\n\nSome text content here to pass threshold.' },
			{ index: 1, markdown: 'No images here, just enough text to avoid warnings about content.' },
		]);

		const doc = normalizeOcrResult(raw, makeOptions());

		expect(doc.pages[0]?.hasImages).toBe(true);
		expect(doc.pages[1]?.hasImages).toBe(false);
	});
});
