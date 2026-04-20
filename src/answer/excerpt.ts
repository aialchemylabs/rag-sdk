// Defense-in-depth for citation excerpts surfaced to end users. Legacy chunks
// ingested before the upstream normalize fix may still carry parser artifacts
// (table separators, page footers, orphan cell fragments). We duplicate a
// small, line-anchored sanitizer here intentionally: this module is called on
// retrieval output and must stay dependency-free from the heavier
// `src/normalize/sanitize.ts` (which is tuned for ingest-time, pulls in
// SDK-internal helpers, and strips inline math we explicitly want to keep at
// read time — `$10,000` etc.).

const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*---(\s*\|\s*---)*\s*\|?\s*$/;
const PAGE_FOOTER_REGEX = /^\s*Page\s*\|\s*\d+\s*$/i;
const ORPHAN_CELL_REGEX = /^\s*\|\s*.{0,2}\s*$/;

function shouldDropLine(line: string): boolean {
	return TABLE_SEPARATOR_REGEX.test(line) || PAGE_FOOTER_REGEX.test(line) || ORPHAN_CELL_REGEX.test(line);
}

export function buildCitationExcerpt(content: string, maxChars: number): string {
	const sanitized = content
		.split('\n')
		.filter((line) => !shouldDropLine(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');

	if (sanitized.length <= maxChars) {
		return sanitized.trimEnd();
	}

	// Snap to the last newline at or before maxChars so we never emit a
	// mid-row fragment like `| L` that would itself look like a parser artifact.
	const window = sanitized.substring(0, maxChars);
	const lastNewline = window.lastIndexOf('\n');
	const truncated = lastNewline >= 0 ? sanitized.substring(0, lastNewline) : window;

	return truncated.trimEnd();
}
