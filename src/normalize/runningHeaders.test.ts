import { stripRunningHeadersAndFooters } from './runningHeaders.js';
import type { NormalizedPage } from './document.types.js';

function makePage(pageIndex: number, markdown: string): NormalizedPage {
	return {
		pageIndex,
		markdown,
		text: markdown,
		characterCount: markdown.length,
		hasImages: false,
		hasTablesOnPage: false,
		warnings: [],
	};
}

describe('stripRunningHeadersAndFooters', () => {
	it('strips "CXC" when present as top line on all 4 of 4 pages', () => {
		const pages = [
			makePage(0, ['CXC', '', 'Page 1 body content here.'].join('\n')),
			makePage(1, ['CXC', '', 'Page 2 body content here.'].join('\n')),
			makePage(2, ['CXC', '', 'Page 3 body content here.'].join('\n')),
			makePage(3, ['CXC', '', 'Page 4 body content here.'].join('\n')),
		];

		const result = stripRunningHeadersAndFooters(pages);

		for (const p of result) {
			expect(p.markdown.split('\n')[0]).not.toBe('CXC');
			expect(p.markdown).not.toMatch(/^CXC$/m);
		}
	});

	it('does NOT strip "CXC" when it appears on only 2 of 4 pages (strict >50%)', () => {
		const pages = [
			makePage(0, ['CXC', '', 'Page 1 body.'].join('\n')),
			makePage(1, ['CXC', '', 'Page 2 body.'].join('\n')),
			makePage(2, ['Other', '', 'Page 3 body.'].join('\n')),
			makePage(3, ['Other', '', 'Page 4 body.'].join('\n')),
		];

		const result = stripRunningHeadersAndFooters(pages);

		expect(result[0]?.markdown.startsWith('CXC')).toBe(true);
		expect(result[1]?.markdown.startsWith('CXC')).toBe(true);
		expect(result[2]?.markdown.startsWith('Other')).toBe(true);
		expect(result[3]?.markdown.startsWith('Other')).toBe(true);
	});

	it('safeguard: returns 2-page doc unchanged regardless of repetition', () => {
		const pages = [makePage(0, ['CXC', '', 'Body 1'].join('\n')), makePage(1, ['CXC', '', 'Body 2'].join('\n'))];

		const result = stripRunningHeadersAndFooters(pages);

		expect(result).toBe(pages);
		expect(result[0]?.markdown).toBe(pages[0]?.markdown);
		expect(result[1]?.markdown).toBe(pages[1]?.markdown);
	});

	it('strips "CXC" as top-line on 3 of 4 pages but preserves body occurrence', () => {
		const pages = [
			makePage(0, ['CXC', '', 'Body 1.'].join('\n')),
			makePage(1, ['CXC', '', 'Body 2.'].join('\n')),
			makePage(2, ['CXC', '', 'Body 3.'].join('\n')),
			makePage(3, ['Different', '', 'We are talking about CXC here.', '', 'More content.'].join('\n')),
		];

		const result = stripRunningHeadersAndFooters(pages);

		expect(result[0]?.markdown).not.toMatch(/^CXC/);
		expect(result[1]?.markdown).not.toMatch(/^CXC/);
		expect(result[2]?.markdown).not.toMatch(/^CXC/);
		expect(result[3]?.markdown).toContain('We are talking about CXC here.');
	});

	it('strips "Page | 16" as bottom line on all 4 pages', () => {
		const pages = [
			makePage(0, ['Body 1 content.', '', 'Page | 16'].join('\n')),
			makePage(1, ['Body 2 content.', '', 'Page | 16'].join('\n')),
			makePage(2, ['Body 3 content.', '', 'Page | 16'].join('\n')),
			makePage(3, ['Body 4 content.', '', 'Page | 16'].join('\n')),
		];

		const result = stripRunningHeadersAndFooters(pages);

		for (const p of result) {
			expect(p.markdown).not.toContain('Page | 16');
		}
	});

	it('does NOT strip slightly varying per-page headers', () => {
		const pages = [
			makePage(0, ['Master Services Agreement - Page 1', '', 'Body 1'].join('\n')),
			makePage(1, ['Master Services Agreement - Page 2', '', 'Body 2'].join('\n')),
			makePage(2, ['Master Services Agreement - Page 3', '', 'Body 3'].join('\n')),
			makePage(3, ['Master Services Agreement - Page 4', '', 'Body 4'].join('\n')),
		];

		const result = stripRunningHeadersAndFooters(pages);

		expect(result[0]?.markdown).toContain('Master Services Agreement - Page 1');
		expect(result[1]?.markdown).toContain('Master Services Agreement - Page 2');
		expect(result[2]?.markdown).toContain('Master Services Agreement - Page 3');
		expect(result[3]?.markdown).toContain('Master Services Agreement - Page 4');
	});

	it('does not mutate input pages', () => {
		const pages = [
			makePage(0, ['CXC', '', 'Body 1'].join('\n')),
			makePage(1, ['CXC', '', 'Body 2'].join('\n')),
			makePage(2, ['CXC', '', 'Body 3'].join('\n')),
			makePage(3, ['CXC', '', 'Body 4'].join('\n')),
		];
		const originalMarkdowns = pages.map((p) => p.markdown);

		stripRunningHeadersAndFooters(pages);

		pages.forEach((p, i) => {
			expect(p.markdown).toBe(originalMarkdowns[i]);
		});
	});

	it('does not recompute text or characterCount', () => {
		const pages = [
			makePage(0, ['CXC', '', 'Body one longer text'].join('\n')),
			makePage(1, ['CXC', '', 'Body two longer text'].join('\n')),
			makePage(2, ['CXC', '', 'Body three longer text'].join('\n')),
			makePage(3, ['CXC', '', 'Body four longer text'].join('\n')),
		];
		const originalText = pages.map((p) => p.text);
		const originalCharCount = pages.map((p) => p.characterCount);

		const result = stripRunningHeadersAndFooters(pages);

		result.forEach((p, i) => {
			expect(p.text).toBe(originalText[i]);
			expect(p.characterCount).toBe(originalCharCount[i]);
		});
	});
});
