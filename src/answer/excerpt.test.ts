import { describe, expect, it } from 'vitest';
import { buildCitationExcerpt } from './excerpt.js';

describe('buildCitationExcerpt', () => {
	it('strips table separators, page footers, and orphan cell fragments from legacy content', () => {
		const legacy = [
			'| The Company | CXC Corporate Services Pty Ltd |',
			'| --- | --- |',
			'| The Contractor | AI ALCHEMY PTY LTD |',
			'| L',
			'',
			'Page | 16',
			'Body text continues here.',
		].join('\n');

		const out = buildCitationExcerpt(legacy, 500);

		expect(out).not.toMatch(/^\s*\|?\s*---/m);
		expect(out).not.toMatch(/^\s*Page\s*\|\s*\d+\s*$/im);
		expect(out).not.toMatch(/^\s*\|\s*L\s*$/m);
		expect(out).toContain('The Company');
		expect(out).toContain('AI ALCHEMY PTY LTD');
		expect(out).toContain('Body text continues here.');
	});

	it('snaps truncation to the preceding newline so it never emits a partial row like `| L`', () => {
		const rows = [
			'| Header A | Header B |',
			'| Row 1 A  | Row 1 B  |',
			'| Row 2 A  | Row 2 B  |',
			'| Longer final row that would be cut mid-way through Longer cell |',
		].join('\n');

		// maxChars chosen to fall inside the last row.
		const maxChars = 80;
		const out = buildCitationExcerpt(rows, maxChars);

		expect(out.length).toBeLessThanOrEqual(maxChars);
		expect(out.endsWith('|')).toBe(true);
		expect(out).not.toMatch(/\|\s+[A-Za-z]{1,2}$/);
		// Must include complete prior rows.
		expect(out).toContain('| Row 1 A  | Row 1 B  |');
	});

	it('falls back to substring(0, maxChars) when no newline exists before the cutoff', () => {
		const content = 'a'.repeat(500);
		const out = buildCitationExcerpt(content, 100);

		expect(out).toBe('a'.repeat(100));
	});

	it('returns content shorter than maxChars as-is after sanitation', () => {
		const content = 'Short body of text.';
		expect(buildCitationExcerpt(content, 300)).toBe('Short body of text.');
	});

	it('preserves unpaired `$` (currency) — this helper does not strip math', () => {
		const content = 'The fee is $10,000 per engagement.';
		const out = buildCitationExcerpt(content, 300);
		expect(out).toBe('The fee is $10,000 per engagement.');
	});

	it('preserves `Page | 12` when it appears inside a sentence (line-anchored rule)', () => {
		const content = 'See Page | 12 for the full schedule of fees.';
		const out = buildCitationExcerpt(content, 300);
		expect(out).toBe('See Page | 12 for the full schedule of fees.');
	});

	it('collapses triple-or-more blank lines to a single blank line', () => {
		const content = ['first', '', '', '', 'second'].join('\n');
		const out = buildCitationExcerpt(content, 300);
		expect(out).toBe('first\n\nsecond');
	});
});
