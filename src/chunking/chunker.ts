import { generateId, estimateTokens } from '../utils/index.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { Chunk, ChunkMetadata, ChunkingResult } from './chunk.types.js';
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
	const overlap = extractOverlap(previousContent, config.overlapTokens);
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

export function chunkDocument(
	document: NormalizedDocument,
	config: ChunkerConfig,
	context: ChunkingContext,
): ChunkingResult {
	const allBlocks: Block[] = [];
	for (const page of document.pages) {
		allBlocks.push(...parseBlocks(page));
	}

	const chunks: Chunk[] = [];
	let previousContent = '';
	let pending: PendingChunk | null = null;

	for (let i = 0; i < allBlocks.length; i++) {
		const block = allBlocks[i] as Block;

		if (pending === null) {
			pending = createEmptyPending(block);
		}

		const isPageChange = pending.blocks.length > 0 && block.pageIndex !== pending.pageEnd;
		const forcePageBreak = config.preservePageBoundaries && isPageChange;
		const forceBoundary = isHardBoundary(block, config) && pending.blocks.length > 0;
		const wouldExceedMax = pending.tokenCount + block.tokenEstimate > config.maxTokens;

		if (forceBoundary || forcePageBreak || wouldExceedMax) {
			previousContent = flushPending(pending, chunks, previousContent, document, config, context);
			pending = createEmptyPending(block);
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

	return {
		documentId: document.documentId,
		chunks,
		totalChunks: chunks.length,
		totalTokens,
		averageTokensPerChunk: chunks.length > 0 ? Math.round(totalTokens / chunks.length) : 0,
	};
}
