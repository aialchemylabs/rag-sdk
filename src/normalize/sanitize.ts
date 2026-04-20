const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*-{3,}(\s*\|\s*-{3,})*\s*\|?\s*$/;
const PAGE_FOOTER_REGEX = /^\s*Page\s*\|\s*\d+\s*$/i;
const ORPHAN_CELL_REGEX = /^\s*\|\s*.{0,2}\s*$/;
const STANDALONE_MATH_REGEX = /^\s*\$[^$]+\$\s*$/;
const INLINE_MATH_REGEX = /\$([^$\n]+)\$/g;
const FENCE_REGEX = /^\s*```/;

function shouldDropLine(line: string): boolean {
	if (line.includes('|') && TABLE_SEPARATOR_REGEX.test(line)) {
		return true;
	}
	if (PAGE_FOOTER_REGEX.test(line)) {
		return true;
	}
	if (ORPHAN_CELL_REGEX.test(line)) {
		return true;
	}
	if (STANDALONE_MATH_REGEX.test(line)) {
		return true;
	}
	return false;
}

function stripInlineMath(line: string): string {
	return line.replace(INLINE_MATH_REGEX, '$1');
}

function collapseAndTrim(text: string): string {
	return text
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]+$/gm, '')
		.trimEnd();
}

export function sanitizeMarkdown(md: string): string {
	const lines = md.split('\n');
	const out: string[] = [];
	let inFence = false;

	for (const line of lines) {
		if (FENCE_REGEX.test(line)) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}
		if (shouldDropLine(line)) {
			continue;
		}
		out.push(stripInlineMath(line));
	}

	return collapseAndTrim(out.join('\n'));
}

export function sanitizeText(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];

	for (const line of lines) {
		if (shouldDropLine(line)) {
			continue;
		}
		out.push(stripInlineMath(line));
	}

	return collapseAndTrim(out.join('\n'));
}
