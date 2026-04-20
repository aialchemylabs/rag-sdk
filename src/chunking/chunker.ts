import { generateId, estimateTokens } from '../utils/index.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { Chunk, ChunkMetadata, ChunkingResult, ChunkingWarning } from './chunk.types.js';
import { type Block, parseBlocks } from './blockParser.js';
import { extractOverlap } from './overlap.js';

export interface ChunkerConfig {
	targetTokens: number;
	maxTokens: number;
	overlapTokens: number;
	headingAware: boolean;
	preservePageBoundaries: boolean;
	preserveTables: boolean;
}

interface ChunkingContext {
	embeddingVersion: string;
	processingMode: string;
	tenantId?: string;
	domainId?: string;
	tags?: string[];
	mimeType?: string;
	customMetadata?: Record<string, unknown>;
}

interface PendingChunk {
	blocks: Block[];
	tokenCount: number;
	pageStart: number;
	pageEnd: number;
	sectionPath: string[];
	skipOverlap?: boolean;
}

function isHardBoundary(block: Block, config: ChunkerConfig): boolean {
	if (config.headingAware && block.type === 'heading' && block.level !== undefined && block.level <= 3) {
		return true;
	}
	if (config.preserveTables && block.type === 'table') {
		return true;
	}
	if (block.type === 'hr') {
		return true;
	}
	return false;
}

function canMerge(current: Block, next: Block): boolean {
	if (current.type !== 'paragraph' && current.type !== 'list') {
		return false;
	}
	if (current.tokenEstimate >= 80) {
		return false;
	}
	return sameSectionPath(current.sectionPath, next.sectionPath);
}

function sameSectionPath(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function createEmptyPending(block: Block): PendingChunk {
	return {
		blocks: [],
		tokenCount: 0,
		pageStart: block.pageIndex,
		pageEnd: block.pageIndex,
		sectionPath: [...block.sectionPath],
	};
}

function buildContent(blocks: Block[]): string {
	return blocks.map((b) => b.markdown).join('\n\n');
}

function flushPending(
	pending: PendingChunk,
	chunks: Chunk[],
	previousContent: string,
	document: NormalizedDocument,
	config: ChunkerConfig,
	context: ChunkingContext,
): string {
	if (pending.blocks.length === 0) return previousContent;

	const rawContent = buildContent(pending.blocks);
	const overlap = pending.skipOverlap ? '' : extractOverlap(previousContent, config.overlapTokens);
	const content = overlap ? `${overlap}\n\n${rawContent}` : rawContent;
	const tokenCount = estimateTokens(content);

	const chunkIndex = chunks.length;
	const chunkId = generateId('chk');

	const sectionTitle = pending.sectionPath.length > 0 ? pending.sectionPath[pending.sectionPath.length - 1] : undefined;

	const metadata: ChunkMetadata = {
		documentId: document.documentId,
		chunkId,
		chunkIndex,
		sourceName: document.sourceName,
		pageStart: pending.pageStart,
		pageEnd: pending.pageEnd,
		sectionTitle,
		tenantId: context.tenantId,
		domainId: context.domainId,
		tags: context.tags,
		mimeType: context.mimeType,
		customMetadata: context.customMetadata,
		processingMode: context.processingMode,
		embeddingVersion: context.embeddingVersion,
		ocrProvider: document.providerMetadata.provider,
		createdAt: new Date().toISOString(),
	};

	chunks.push({
		chunkId,
		documentId: document.documentId,
		content,
		tokenCount,
		metadata,
	});

	return rawContent;
}

function splitOversizedTable(block: Block, config: ChunkerConfig, warnings: ChunkingWarning[]): Block[] {
	if (block.tokenEstimate <= config.maxTokens) {
		return [block];
	}

	const lines = block.markdown.split('\n').map((l) => l.trimEnd());
	if (lines.length < 3) {
		return [block];
	}

	const header = lines[0] as string;
	const separator = lines[1] as string;
	const headerPrefix = `${header}\n${separator}`;
	const headerTokens = estimateTokens(headerPrefix);
	const dataRows = lines.slice(2).filter((l) => l.length > 0);

	const pieces: Block[] = [];
	let currentRows: string[] = [];
	let currentTokens = headerTokens;
	let pieceIndex = 0;

	const emitPiece = () => {
		if (currentRows.length === 0) return;
		const markdown = `${headerPrefix}\n${currentRows.join('\n')}`;
		pieces.push({
			blockIndex: block.blockIndex + pieceIndex,
			type: 'table',
			content: markdown,
			markdown,
			tokenEstimate: estimateTokens(markdown),
			pageIndex: block.pageIndex,
			sectionPath: [...block.sectionPath],
			isBoundary: true,
		});
		pieceIndex++;
		currentRows = [];
		currentTokens = headerTokens;
	};

	for (const row of dataRows) {
		const rowTokens = estimateTokens(row);
		const rowAlonePlusHeaderTokens = headerTokens + rowTokens;

		// Single-row oversize: cannot split further without breaking row atomicity.
		if (rowAlonePlusHeaderTokens > config.maxTokens) {
			emitPiece();
			const markdown = `${headerPrefix}\n${row}`;
			warnings.push({
				code: 'TABLE_ROW_OVERSIZE',
				message: `Table row exceeds maxTokens (${estimateTokens(markdown)} > ${config.maxTokens}); emitted as single oversize chunk to preserve row atomicity.`,
				pageIndex: block.pageIndex,
				sectionPath: [...block.sectionPath],
				details: {
					rowTokens: estimateTokens(markdown),
					maxTokens: config.maxTokens,
				},
			});
			pieces.push({
				blockIndex: block.blockIndex + pieceIndex,
				type: 'table',
				content: markdown,
				markdown,
				tokenEstimate: estimateTokens(markdown),
				pageIndex: block.pageIndex,
				sectionPath: [...block.sectionPath],
				isBoundary: true,
			});
			pieceIndex++;
			continue;
		}

		if (currentTokens + rowTokens > config.maxTokens && currentRows.length > 0) {
			emitPiece();
		}

		currentRows.push(row);
		currentTokens += rowTokens;
	}

	emitPiece();

	if (pieces.length === 0) {
		return [block];
	}

	return pieces;
}

export function chunkDocument(
	document: NormalizedDocument,
	config: ChunkerConfig,
	context: ChunkingContext,
): ChunkingResult {
	const warnings: ChunkingWarning[] = [];
	const rawBlocks: Block[] = [];
	for (const page of document.pages) {
		rawBlocks.push(...parseBlocks(page));
	}

	const allBlocks: Block[] = [];
	const tableContinuationBlocks = new Set<Block>();
	for (const block of rawBlocks) {
		if (block.type === 'table') {
			const pieces = splitOversizedTable(block, config, warnings);
			for (let i = 0; i < pieces.length; i++) {
				const piece = pieces[i] as Block;
				if (i > 0) {
					tableContinuationBlocks.add(piece);
				}
				allBlocks.push(piece);
			}
		} else {
			allBlocks.push(block);
		}
	}

	const chunks: Chunk[] = [];
	let previousContent = '';
	let pending: PendingChunk | null = null;

	for (let i = 0; i < allBlocks.length; i++) {
		const block = allBlocks[i] as Block;

		if (pending === null) {
			pending = createEmptyPending(block);
			if (tableContinuationBlocks.has(block)) {
				pending.skipOverlap = true;
			}
		}

		const isPageChange = pending.blocks.length > 0 && block.pageIndex !== pending.pageEnd;
		const forcePageBreak = config.preservePageBoundaries && isPageChange;
		const forceBoundary = isHardBoundary(block, config) && pending.blocks.length > 0;
		const wouldExceedMax = pending.tokenCount + block.tokenEstimate > config.maxTokens;

		if (forceBoundary || forcePageBreak || wouldExceedMax) {
			previousContent = flushPending(pending, chunks, previousContent, document, config, context);
			pending = createEmptyPending(block);
			if (tableContinuationBlocks.has(block)) {
				pending.skipOverlap = true;
			}
		}

		pending.blocks.push(block);
		pending.tokenCount += block.tokenEstimate;
		pending.pageEnd = block.pageIndex;
		if (block.sectionPath.length > 0) {
			pending.sectionPath = [...block.sectionPath];
		}

		const nextBlock = allBlocks[i + 1];
		const atTarget = pending.tokenCount >= config.targetTokens;

		if (atTarget && nextBlock) {
			const nextIsMergeable =
				canMerge(block, nextBlock) && pending.tokenCount + nextBlock.tokenEstimate <= config.maxTokens;
			if (!nextIsMergeable) {
				previousContent = flushPending(pending, chunks, previousContent, document, config, context);
				pending = null;
			}
		}
	}

	if (pending && pending.blocks.length > 0) {
		flushPending(pending, chunks, previousContent, document, config, context);
	}

	const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

	const result: ChunkingResult = {
		documentId: document.documentId,
		chunks,
		totalChunks: chunks.length,
		totalTokens,
		averageTokensPerChunk: chunks.length > 0 ? Math.round(totalTokens / chunks.length) : 0,
	};
	if (warnings.length > 0) {
		result.warnings = warnings;
	}
	return result;
}
