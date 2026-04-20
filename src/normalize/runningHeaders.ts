import type { NormalizedPage } from './document.types.js';

interface PageEdges {
	top: string[];
	bottom: string[];
	lines: string[];
}

function getEdges(markdown: string): PageEdges {
	const rawLines = markdown.split('\n');
	const nonEmptyIndices: number[] = [];
	for (let i = 0; i < rawLines.length; i++) {
		if ((rawLines[i] ?? '').trim().length > 0) {
			nonEmptyIndices.push(i);
		}
	}
	const top = nonEmptyIndices.slice(0, 2).map((i) => (rawLines[i] ?? '').trim());
	const bottom = nonEmptyIndices.slice(-2).map((i) => (rawLines[i] ?? '').trim());
	return { top, bottom, lines: rawLines };
}

function countOccurrences(edgesPerPage: PageEdges[], position: 'top' | 'bottom'): Map<string, number> {
	const counts = new Map<string, number>();
	for (const edges of edgesPerPage) {
		const seen = new Set<string>();
		for (const line of edges[position]) {
			if (seen.has(line)) {
				continue;
			}
			seen.add(line);
			counts.set(line, (counts.get(line) ?? 0) + 1);
		}
	}
	return counts;
}

export function stripRunningHeadersAndFooters(pages: NormalizedPage[]): NormalizedPage[] {
	if (pages.length < 3) {
		return pages;
	}

	const edgesPerPage = pages.map((p) => getEdges(p.markdown));
	const topCounts = countOccurrences(edgesPerPage, 'top');
	const bottomCounts = countOccurrences(edgesPerPage, 'bottom');

	const threshold = pages.length / 2;
	const topHeaders = new Set<string>();
	const bottomFooters = new Set<string>();
	for (const [line, count] of topCounts) {
		if (count > threshold) {
			topHeaders.add(line);
		}
	}
	for (const [line, count] of bottomCounts) {
		if (count > threshold) {
			bottomFooters.add(line);
		}
	}

	if (topHeaders.size === 0 && bottomFooters.size === 0) {
		return pages;
	}

	return pages.map((page, pageIdx) => {
		const edges = edgesPerPage[pageIdx];
		if (!edges) {
			return page;
		}
		const lines = [...edges.lines];
		const topRemovals = new Set<number>();
		const bottomRemovals = new Set<number>();

		const nonEmptyIndices: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if ((lines[i] ?? '').trim().length > 0) {
				nonEmptyIndices.push(i);
			}
		}

		const topIdx = nonEmptyIndices.slice(0, 2);
		const bottomIdx = nonEmptyIndices.slice(-2);

		for (const i of topIdx) {
			const trimmed = (lines[i] ?? '').trim();
			if (topHeaders.has(trimmed)) {
				topRemovals.add(i);
			}
		}
		for (const i of bottomIdx) {
			const trimmed = (lines[i] ?? '').trim();
			if (bottomFooters.has(trimmed)) {
				bottomRemovals.add(i);
			}
		}

		if (topRemovals.size === 0 && bottomRemovals.size === 0) {
			return page;
		}

		const kept: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (topRemovals.has(i) || bottomRemovals.has(i)) {
				continue;
			}
			kept.push(lines[i] ?? '');
		}

		return {
			...page,
			markdown: kept.join('\n'),
		};
	});
}
