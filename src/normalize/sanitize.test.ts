import { sanitizeMarkdown, sanitizeText } from './sanitize.js';

describe('sanitizeMarkdown', () => {
	describe('table-separator rows (rule 1)', () => {
		it('strips "| --- | --- |"', () => {
			const input = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
			const output = sanitizeMarkdown(input);
			expect(output).toBe(['| A | B |', '| 1 | 2 |'].join('\n'));
		});

		it('strips "|---|---|" without spaces', () => {
			expect(sanitizeMarkdown('|---|---|')).toBe('');
		});

		it('strips "| ---|" spacing variant', () => {
			expect(sanitizeMarkdown('| ---|')).toBe('');
		});

		it('strips "| --- | --- | --- |" three-column variant', () => {
			expect(sanitizeMarkdown('| --- | --- | --- |')).toBe('');
		});

		it('strips dashes longer than 3', () => {
			expect(sanitizeMarkdown('| ----- | ---------- |')).toBe('');
		});

		it('preserves header rows', () => {
			expect(sanitizeMarkdown('| Name | Age |')).toBe('| Name | Age |');
		});

		it('preserves data rows', () => {
			expect(sanitizeMarkdown('| Alice | 30 |')).toBe('| Alice | 30 |');
		});

		it('preserves short valid table rows like "| a | b |"', () => {
			expect(sanitizeMarkdown('| a | b |')).toBe('| a | b |');
		});

		it('does not strip standalone --- horizontal rule', () => {
			expect(sanitizeMarkdown('---')).toBe('---');
		});

		it('does not strip "------" horizontal rule variant', () => {
			expect(sanitizeMarkdown('------')).toBe('------');
		});
	});

	describe('page-footer pattern (rule 2)', () => {
		it('strips "Page | 16"', () => {
			expect(sanitizeMarkdown('Page | 16')).toBe('');
		});

		it('strips case-insensitive "page | 3"', () => {
			expect(sanitizeMarkdown('page | 3')).toBe('');
		});

		it('strips "Page |  999" with extra spaces', () => {
			expect(sanitizeMarkdown('Page |  999')).toBe('');
		});

		it('preserves "Page | 12" embedded in a longer sentence', () => {
			const input = 'On Page | 12 we see something important';
			expect(sanitizeMarkdown(input)).toBe(input);
		});
	});

	describe('orphan cell fragments (rule 3)', () => {
		it('strips "| L"', () => {
			expect(sanitizeMarkdown('| L')).toBe('');
		});

		it('strips "| ab"', () => {
			expect(sanitizeMarkdown('| ab')).toBe('');
		});

		it('strips lone "|"', () => {
			expect(sanitizeMarkdown('|')).toBe('');
		});

		it('preserves "| a | b |" (two-pipe short row)', () => {
			expect(sanitizeMarkdown('| a | b |')).toBe('| a | b |');
		});
	});

	describe('standalone math lines (rule 4)', () => {
		it('strips "$\\sigma .J_{2c}$"', () => {
			expect(sanitizeMarkdown('$\\sigma .J_{2c}$')).toBe('');
		});

		it('strips "$x+y$"', () => {
			expect(sanitizeMarkdown('$x+y$')).toBe('');
		});

		it('strips standalone math with surrounding whitespace', () => {
			expect(sanitizeMarkdown('   $x+y$   ')).toBe('');
		});
	});

	describe('inline math stripping (rule 5)', () => {
		it('strips paired $...$ delimiters inline', () => {
			expect(sanitizeMarkdown('The variable $x$ is defined')).toBe('The variable x is defined');
		});

		it('strips multiple inline pairs on the same line', () => {
			expect(sanitizeMarkdown('For $x$ and $y$ values')).toBe('For x and y values');
		});

		it('preserves unpaired $ in "$10,000"', () => {
			expect(sanitizeMarkdown('The price is $10,000 total')).toBe('The price is $10,000 total');
		});

		it('preserves unpaired $ in "$1100.00 Daily"', () => {
			expect(sanitizeMarkdown('$1100.00 Daily fee applies')).toBe('$1100.00 Daily fee applies');
		});
	});

	describe('blank-line collapsing (rule 6)', () => {
		it('collapses 3+ newlines to 2 after removals', () => {
			const input = ['A', '', '', '', 'B'].join('\n');
			expect(sanitizeMarkdown(input)).toBe('A\n\nB');
		});

		it('collapses blank lines introduced by stripping', () => {
			const input = ['A', '| --- |', '', 'Page | 16', 'B'].join('\n');
			const output = sanitizeMarkdown(input);
			expect(output).toContain('A');
			expect(output).toContain('B');
			expect(output).not.toContain('---');
			expect(output).not.toContain('Page | 16');
			expect(output).not.toMatch(/\n{3,}/);
		});
	});

	describe('fenced code block preservation', () => {
		it('preserves "| --- |" inside a fenced code block', () => {
			const input = ['Before', '```', '| --- |', 'Page | 16', '$x+y$', '```', 'After'].join('\n');
			const output = sanitizeMarkdown(input);
			expect(output).toContain('| --- |');
			expect(output).toContain('Page | 16');
			expect(output).toContain('$x+y$');
		});

		it('still strips outside the fence', () => {
			const input = ['| --- |', '```', '| --- |', '```', '| --- |'].join('\n');
			const output = sanitizeMarkdown(input);
			const insideCount = (output.match(/\| --- \|/g) ?? []).length;
			expect(insideCount).toBe(1);
		});

		it('does not strip inline math inside fenced code', () => {
			const input = ['```', 'let x = $foo$;', '```'].join('\n');
			expect(sanitizeMarkdown(input)).toBe(input);
		});
	});

	describe('real-world citation scenarios', () => {
		it('cleans citation 1 from bug report', () => {
			const input = [
				'CXC',
				'',
				'Schedule 1 – WORK ORDER',
				'',
				'| The Company | CXC Corporate Services Pty Ltd  |',
				'| --- | --- |',
				'| The Contractor | AI ALCHEMY PTY LTD  |',
				'| L',
			].join('\n');
			const output = sanitizeMarkdown(input);
			expect(output).not.toContain('| --- |');
			expect(output).not.toContain('| L');
			expect(output).toContain('| The Company | CXC Corporate Services Pty Ltd  |');
			expect(output).toContain('CXC');
		});

		it('cleans citation 2 from bug report', () => {
			const input = ['$1100.00 Daily  |', '|  Payment Cycle (in arrears) | Weekly  |', '', 'Page | 16', '', 'CXC'].join(
				'\n',
			);
			const output = sanitizeMarkdown(input);
			expect(output).toContain('$1100.00 Daily  |');
			expect(output).not.toContain('Page | 16');
			expect(output).toContain('CXC');
		});

		it('cleans citation 3 LaTeX fragment', () => {
			const input = ['Terms accepted by representative.', '', '$\\sigma .J_{2c}$', '', 'Page | 17'].join('\n');
			const output = sanitizeMarkdown(input);
			expect(output).not.toContain('$\\sigma');
			expect(output).not.toContain('Page | 17');
			expect(output).toContain('Terms accepted by representative.');
		});
	});
});

describe('sanitizeText', () => {
	it('strips table-separator rows', () => {
		expect(sanitizeText('| --- | --- |')).toBe('');
	});

	it('strips page-footer pattern', () => {
		expect(sanitizeText('Page | 16')).toBe('');
	});

	it('strips orphan cell fragments', () => {
		expect(sanitizeText('| L')).toBe('');
	});

	it('strips standalone math lines', () => {
		expect(sanitizeText('$x+y$')).toBe('');
	});

	it('strips paired inline math', () => {
		expect(sanitizeText('The $x$ var')).toBe('The x var');
	});

	it('preserves unpaired $', () => {
		expect(sanitizeText('$10,000 price')).toBe('$10,000 price');
	});

	it('does NOT treat triple backticks as a fence', () => {
		const input = ['```', '| --- |', '```'].join('\n');
		const output = sanitizeText(input);
		expect(output).not.toContain('| --- |');
		expect(output).toContain('```');
	});

	it('collapses blank lines', () => {
		expect(sanitizeText('A\n\n\n\nB')).toBe('A\n\nB');
	});
});
