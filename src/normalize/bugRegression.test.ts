import { describe, expect, it } from 'vitest';
import { normalizeOcrResult } from './normalizer.js';
import type { MistralOcrRawResult } from '../ocr/index.js';
import { chunkDocument, type ChunkerConfig } from '../chunking/chunker.js';
import { buildCitationExcerpt } from '../answer/excerpt.js';

const CHUNKER_CONFIG: ChunkerConfig = {
	targetTokens: 100,
	maxTokens: 300,
	overlapTokens: 20,
	headingAware: true,
	preservePageBoundaries: false,
	preserveTables: true,
};

const CHUNKING_CONTEXT = {
	embeddingVersion: 'v1',
	processingMode: 'text_first',
};

function cxcContractRaw(): MistralOcrRawResult {
	const page15 = [
		'CXC',
		'',
		'## Schedule 1 – WORK ORDER',
		'',
		'| The Company | CXC Corporate Services Pty Ltd  |',
		'| --- | --- |',
		'| The Contractor | AI ALCHEMY PTY LTD  |',
		"| The Contractor's Representative | Srinivasan Jayaraman  |",
		'| The Client | Medibank Private Limited  |',
		'| Client Representative | Abhaya Rajakarunanayake  |',
		'| L',
		'',
		'Page | 15',
	].join('\n');

	const page16 = [
		'CXC',
		'',
		'$1100.00 Daily  |',
		'|  Payment Cycle (in arrears) | Weekly  |',
		'|  Typical Hours per week | 37.50 , or as otherwise required by the Client  |',
		'|  Services to be performed | Solution Lead  |',
		'|  Notice Period for termination of Work Order | 5 Day/s  |',
		'',
		'Page | 16',
	].join('\n');

	const page17 = [
		'CXC',
		'',
		'| Special conditions | Half of the daily rate excluding GST applies when working 3.75 hours or less  |',
		'| --- | --- |',
		'',
		'These assignment terms and conditions of this Work Order are accepted on behalf of the Contractor by its authorised representative.',
		'',
		'$\\sigma .J_{2c}$',
		'',
		'Page | 17',
	].join('\n');

	return {
		pages: [
			{ index: 0, markdown: page15, images: [], dimensions: { width: 612, height: 792 } },
			{ index: 1, markdown: page16, images: [], dimensions: { width: 612, height: 792 } },
			{ index: 2, markdown: page17, images: [], dimensions: { width: 612, height: 792 } },
		],
		model: 'mistral-ocr-latest',
		processingTimeMs: 500,
		usage: undefined,
	};
}

describe('bug.md regression — citation text is free of parser artifacts', () => {
	const raw = cxcContractRaw();
	const doc = normalizeOcrResult(raw, {
		sourceName: 'CXC Services Agreement.pdf',
		mimeType: 'application/pdf',
		model: 'mistral-ocr-latest',
		processingTimeMs: 500,
	});

	it('strips running header "CXC" from every page', () => {
		for (const page of doc.pages) {
			const firstLine = page.markdown.split('\n').find((l) => l.trim().length > 0) ?? '';
			expect(firstLine.trim()).not.toBe('CXC');
		}
	});

	it('strips "Page | N" footers from every page', () => {
		for (const page of doc.pages) {
			expect(page.markdown).not.toMatch(/^\s*Page\s*\|\s*\d+\s*$/m);
		}
	});

	it('strips table-separator rows from page markdown', () => {
		for (const page of doc.pages) {
			expect(page.markdown).not.toMatch(/^\s*\|?\s*---(\s*\|\s*---)+\s*\|?\s*$/m);
		}
	});

	it('strips standalone LaTeX math lines', () => {
		for (const page of doc.pages) {
			expect(page.markdown).not.toContain('\\sigma');
			expect(page.markdown).not.toMatch(/^\s*\$[^$]+\$\s*$/m);
		}
	});

	it('strips orphan cell fragments like "| L"', () => {
		for (const page of doc.pages) {
			for (const line of page.markdown.split('\n')) {
				expect(line).not.toMatch(/^\s*\|\s*.{0,2}\s*$/);
			}
		}
	});

	it('preserves legitimate table data rows', () => {
		const allMarkdown = doc.pages.map((p) => p.markdown).join('\n');
		expect(allMarkdown).toContain('AI ALCHEMY PTY LTD');
		expect(allMarkdown).toContain('Srinivasan Jayaraman');
		expect(allMarkdown).toContain('Medibank Private Limited');
		expect(allMarkdown).toContain('Solution Lead');
		expect(allMarkdown).toContain('Half of the daily rate excluding GST');
	});

	it('preserves unpaired "$" in dollar amounts', () => {
		const allMarkdown = doc.pages.map((p) => p.markdown).join('\n');
		expect(allMarkdown).toContain('$1100.00');
	});

	it('produces chunks whose content contains none of the reported artifacts', () => {
		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		for (const chunk of result.chunks) {
			expect(chunk.content).not.toMatch(/^\s*\|?\s*---(\s*\|\s*---)+\s*\|?\s*$/m);
			expect(chunk.content).not.toMatch(/^\s*Page\s*\|\s*\d+\s*$/m);
			expect(chunk.content).not.toMatch(/^\s*\|\s*.{0,2}\s*$/m);
			expect(chunk.content).not.toMatch(/^\s*\$[^$]+\$\s*$/m);
			expect(chunk.content).not.toContain('\\sigma');

			const firstNonEmpty = chunk.content.split('\n').find((l) => l.trim().length > 0) ?? '';
			expect(firstNonEmpty.trim()).not.toBe('CXC');
		}
	});

	it('produces citation excerpts free of the reported artifacts', () => {
		const result = chunkDocument(doc, CHUNKER_CONFIG, CHUNKING_CONTEXT);

		for (const chunk of result.chunks) {
			const excerpt = buildCitationExcerpt(chunk.content, 300);
			expect(excerpt).not.toMatch(/^\s*\|?\s*---(\s*\|\s*---)+\s*\|?\s*$/m);
			expect(excerpt).not.toMatch(/^\s*Page\s*\|\s*\d+\s*$/m);
			expect(excerpt).not.toMatch(/^\s*\|\s*.{0,2}\s*$/m);
		}
	});

	it('applies answer-side sanitizer as defense-in-depth for legacy chunk content', () => {
		const legacyPoisonedContent = [
			'CXC',
			'',
			'| Header | Value |',
			'| --- | --- |',
			'| A | B |',
			'| L',
			'',
			'Page | 99',
		].join('\n');

		const excerpt = buildCitationExcerpt(legacyPoisonedContent, 300);
		expect(excerpt).not.toMatch(/^\s*\|?\s*---(\s*\|\s*---)+\s*\|?\s*$/m);
		expect(excerpt).not.toMatch(/^\s*Page\s*\|\s*\d+\s*$/m);
		expect(excerpt).not.toMatch(/^\s*\|\s*.{0,2}\s*$/m);
		expect(excerpt).toContain('| Header | Value |');
		expect(excerpt).toContain('| A | B |');
	});
});
