import type {
	NormalizedDocument,
	NormalizedPage,
	NormalizedTable,
	NormalizedLink,
	OcrWarning,
} from './document.types.js';
import type { MistralOcrRawResult } from '../ocr/index.js';
import { generateId } from '../utils/index.js';
import { createLogger } from '../telemetry/logger.js';

const logger = createLogger('normalize');

const LOW_CONTENT_THRESHOLD = 50;

const MARKDOWN_TABLE_REGEX = /(?:^|\n)((?:\|[^\n]+\|\r?\n)(?:\|[\s:|-]+\|\r?\n)((?:\|[^\n]+\|\r?\n?)*))/g;

const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g;

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

function stripMarkdown(markdown: string): string {
	let text = markdown;
	text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
	text = text.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
	text = text.replace(/#{1,6}\s+/g, '');
	text = text.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2');
	text = text.replace(/`{1,3}[^`]*`{1,3}/g, (match) => match.replace(/`/g, ''));
	text = text.replace(/^>\s+/gm, '');
	text = text.replace(/^[-*+]\s+/gm, '');
	text = text.replace(/^\d+\.\s+/gm, '');
	text = text.replace(/^---+$/gm, '');
	text = text.replace(/\n{3,}/g, '\n\n');
	return text.trim();
}

function extractTablesFromMarkdown(markdown: string, pageIndex: number, startIndex: number): NormalizedTable[] {
	const tables: NormalizedTable[] = [];
	let tableIndex = startIndex;
	let match: RegExpExecArray | null;

	const regex = new RegExp(MARKDOWN_TABLE_REGEX.source, MARKDOWN_TABLE_REGEX.flags);

	for (match = regex.exec(markdown); match !== null; match = regex.exec(markdown)) {
		const tableMarkdown = (match[1] as string).trim();
		const rows = tableMarkdown.split('\n').filter((row) => row.trim().length > 0);
		const separatorIndex = rows.findIndex((row) => /^\|[\s:|-]+\|$/.test(row.trim()));

		const dataRows = rows.filter((_, i) => i !== separatorIndex);
		const rowCount = dataRows.length;

		const firstRow = rows[0];
		const columnCount = firstRow ? firstRow.split('|').filter((cell) => cell.trim().length > 0).length : 0;

		tables.push({
			tableIndex,
			pageIndex,
			markdown: tableMarkdown,
			rowCount,
			columnCount,
		});
		tableIndex++;
	}

	return tables;
}

function extractLinksFromMarkdown(markdown: string, pageIndex: number): NormalizedLink[] {
	const links: NormalizedLink[] = [];
	let match: RegExpExecArray | null;

	const imagePositions = new Set<string>();
	const imageRegex = new RegExp(MARKDOWN_IMAGE_REGEX.source, MARKDOWN_IMAGE_REGEX.flags);
	for (match = imageRegex.exec(markdown); match !== null; match = imageRegex.exec(markdown)) {
		imagePositions.add(`${match.index}`);
	}

	const linkRegex = new RegExp(MARKDOWN_LINK_REGEX.source, MARKDOWN_LINK_REGEX.flags);
	for (match = linkRegex.exec(markdown); match !== null; match = linkRegex.exec(markdown)) {
		if (imagePositions.has(`${match.index - 1}`)) {
			continue;
		}
		const text = match[1] ?? '';
		const url = match[2] ?? '';
		if (url) {
			links.push({ text, url, pageIndex });
		}
	}

	return links;
}

function detectPageWarnings(markdown: string, pageIndex: number): OcrWarning[] {
	const warnings: OcrWarning[] = [];
	const text = stripMarkdown(markdown);

	if (text.length === 0) {
		warnings.push({
			code: 'EMPTY_PAGE',
			message: `Page ${pageIndex} produced no text content`,
			pageIndex,
			severity: 'medium',
		});
	} else if (text.length < LOW_CONTENT_THRESHOLD) {
		warnings.push({
			code: 'LOW_CONTENT',
			message: `Page ${pageIndex} has very little content (${text.length} characters)`,
			pageIndex,
			severity: 'low',
		});
	}

	return warnings;
}

function hasImages(markdown: string): boolean {
	return /!\[[^\]]*\]\([^)]+\)/.test(markdown);
}

export interface NormalizeOptions {
	sourceName: string;
	mimeType: string;
	model: string;
	processingTimeMs: number;
	documentId?: string;
}

export function normalizeOcrResult(raw: MistralOcrRawResult, options: NormalizeOptions): NormalizedDocument {
	const { sourceName, mimeType, model, processingTimeMs } = options;

	logger.info('Normalizing OCR result', { sourceName, pageCount: raw.pages.length });

	const documentId = options.documentId ?? generateId('doc');
	const allTables: NormalizedTable[] = [];
	const allLinks: NormalizedLink[] = [];
	const allWarnings: OcrWarning[] = [];
	let totalCharacters = 0;

	const pages: NormalizedPage[] = raw.pages.map((rawPage) => {
		const markdown = rawPage.markdown;
		const text = stripMarkdown(markdown);
		const characterCount = text.length;
		totalCharacters += characterCount;

		const pageTables = extractTablesFromMarkdown(markdown, rawPage.index, allTables.length);
		allTables.push(...pageTables);

		const pageLinks = extractLinksFromMarkdown(markdown, rawPage.index);
		allLinks.push(...pageLinks);

		const pageWarnings = detectPageWarnings(markdown, rawPage.index);
		allWarnings.push(...pageWarnings);

		const pageHasImages = hasImages(markdown);

		return {
			pageIndex: rawPage.index,
			markdown,
			text,
			characterCount,
			hasImages: pageHasImages,
			hasTablesOnPage: pageTables.length > 0,
			warnings: pageWarnings,
		};
	});

	if (raw.pages.length === 0) {
		allWarnings.push({
			code: 'NO_PAGES',
			message: 'OCR returned zero pages',
			severity: 'high',
		});
	}

	if (totalCharacters === 0 && raw.pages.length > 0) {
		allWarnings.push({
			code: 'NO_CONTENT',
			message: 'All pages are empty after OCR processing',
			severity: 'high',
		});
	}

	const document: NormalizedDocument = {
		documentId,
		sourceName,
		mimeType,
		pageCount: pages.length,
		pages,
		tables: allTables,
		links: allLinks,
		warnings: allWarnings,
		providerMetadata: {
			provider: 'mistral',
			model,
			processingTimeMs,
			rawPageCount: raw.pages.length,
		},
		totalCharacters,
		createdAt: new Date().toISOString(),
	};

	logger.info('Normalization complete', {
		documentId,
		pageCount: pages.length,
		tableCount: allTables.length,
		linkCount: allLinks.length,
		warningCount: allWarnings.length,
		totalCharacters,
	});

	return document;
}
