import { estimateTokens } from '../utils/index.js';

const SENTENCE_BOUNDARY = /[.!?]\s+/g;

export function extractOverlap(text: string, overlapTokens: number): string {
	if (overlapTokens <= 0 || text.length === 0) {
		return '';
	}

	const totalTokens = estimateTokens(text);
	if (totalTokens <= overlapTokens) {
		return text;
	}

	const charBudget = Math.floor((overlapTokens / totalTokens) * text.length);
	let sliceStart = text.length - charBudget;
	if (sliceStart < 0) sliceStart = 0;

	let candidate = text.slice(sliceStart);

	const matches = Array.from(candidate.matchAll(SENTENCE_BOUNDARY));
	const first = matches[0];
	if (first && first.index !== undefined) {
		const boundaryEnd = first.index + first[0].length;
		if (boundaryEnd < candidate.length) {
			candidate = candidate.slice(boundaryEnd);
		}
	}

	return candidate.trim();
}
