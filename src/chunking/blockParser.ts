import { estimateTokens } from '../utils/index.js';
import type { NormalizedPage } from '../normalize/document.types.js';

export interface Block {
	blockIndex: number;
	type: 'paragraph' | 'heading' | 'table' | 'code' | 'list' | 'blockquote' | 'hr';
	level?: number;
	content: string;
	markdown: string;
	tokenEstimate: number;
	pageIndex: number;
	sectionPath: string[];
	isBoundary: boolean;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const TABLE_ROW_PATTERN = /^\|.+\|$/;
const CODE_FENCE_PATTERN = /^```/;
const UNORDERED_LIST_PATTERN = /^[\s]*[-*+]\s+/;
const ORDERED_LIST_PATTERN = /^[\s]*\d+[.)]\s+/;
const BLOCKQUOTE_PATTERN = /^>\s*/;
const HR_PATTERN = /^([-*_])\1{2,}\s*$/;

function detectBlockType(raw: string): { type: Block['type']; level?: number; content: string } {
	const trimmed = raw.trim();

	if (HR_PATTERN.test(trimmed)) {
		return { type: 'hr', content: '' };
	}

	const headingMatch = trimmed.match(HEADING_PATTERN);
	if (headingMatch?.[1] && headingMatch[2]) {
		return {
			type: 'heading',
			level: headingMatch[1].length,
			content: headingMatch[2].trim(),
		};
	}

	if (CODE_FENCE_PATTERN.test(trimmed)) {
		const lines = trimmed.split('\n');
		const inner = lines.slice(1, -1).join('\n');
		return { type: 'code', content: inner };
	}

	const lines = trimmed.split('\n');
	if (lines.length >= 2 && lines.every((l) => TABLE_ROW_PATTERN.test(l.trim()))) {
		return { type: 'table', content: trimmed };
	}

	if (lines.every((l) => BLOCKQUOTE_PATTERN.test(l))) {
		const content = lines.map((l) => l.replace(BLOCKQUOTE_PATTERN, '')).join('\n');
		return { type: 'blockquote', content };
	}

	const firstLine = lines[0];
	if (
		firstLine &&
		lines.every((l) => UNORDERED_LIST_PATTERN.test(l) || ORDERED_LIST_PATTERN.test(l) || /^\s+/.test(l))
	) {
		if (UNORDERED_LIST_PATTERN.test(firstLine) || ORDERED_LIST_PATTERN.test(firstLine)) {
			return { type: 'list', content: trimmed };
		}
	}

	return { type: 'paragraph', content: trimmed };
}

function splitRawBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	const lines = markdown.split('\n');
	let current: string[] = [];
	let inCodeFence = false;

	for (const line of lines) {
		if (CODE_FENCE_PATTERN.test(line.trim())) {
			if (inCodeFence) {
				current.push(line);
				blocks.push(current.join('\n'));
				current = [];
				inCodeFence = false;
				continue;
			}
			if (current.length > 0) {
				blocks.push(current.join('\n'));
				current = [];
			}
			inCodeFence = true;
			current.push(line);
			continue;
		}

		if (inCodeFence) {
			current.push(line);
			continue;
		}

		if (line.trim() === '') {
			if (current.length > 0) {
				blocks.push(current.join('\n'));
				current = [];
			}
			continue;
		}

		current.push(line);
	}

	if (current.length > 0) {
		blocks.push(current.join('\n'));
	}

	return blocks;
}

export function parseBlocks(page: NormalizedPage): Block[] {
	const rawBlocks = splitRawBlocks(page.markdown);
	const blocks: Block[] = [];
	const sectionPath: string[] = [];
	let blockIndex = 0;

	for (const raw of rawBlocks) {
		const detected = detectBlockType(raw);
		const markdown = raw.trim();

		if (detected.type === 'heading' && detected.level !== undefined) {
			while (sectionPath.length >= detected.level) {
				sectionPath.pop();
			}
			sectionPath.push(detected.content);
		}

		const isBoundary =
			(detected.type === 'heading' && detected.level !== undefined && detected.level <= 3) ||
			detected.type === 'table' ||
			detected.type === 'hr';

		blocks.push({
			blockIndex,
			type: detected.type,
			level: detected.level,
			content: detected.content,
			markdown,
			tokenEstimate: estimateTokens(markdown),
			pageIndex: page.pageIndex,
			sectionPath: [...sectionPath],
			isBoundary,
		});

		blockIndex++;
	}

	return blocks;
}
