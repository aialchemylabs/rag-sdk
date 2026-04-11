/**
 * End-to-end tests for @aialchemy/rag-sdk.
 *
 * These tests mock the three external service boundaries (Qdrant, OpenAI, Mistral)
 * with in-memory implementations while exercising the full internal SDK pipeline:
 * config validation → OCR → normalization → chunking → embedding → indexing → retrieval → answer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock state (vi.hoisted runs before vi.mock factories)
// ---------------------------------------------------------------------------

const { qdrantCollections, ocrCallHistory, embeddingCallHistory, chatCallHistory, VECTOR_DIM } = vi.hoisted(() => ({
	/** In-memory Qdrant store: collectionName → point[] */
	qdrantCollections: new Map<
		string,
		Array<{
			id: string;
			vector: Record<string, unknown>;
			payload: Record<string, unknown>;
		}>
	>(),
	ocrCallHistory: [] as Array<{ model: string; document: unknown }>,
	embeddingCallHistory: [] as string[][],
	chatCallHistory: [] as Array<{ messages: unknown[]; options: unknown }>,
	VECTOR_DIM: 8,
}));

// ---------------------------------------------------------------------------
// Helpers shared between mocks and tests
// ---------------------------------------------------------------------------

function deterministicEmbed(text: string): number[] {
	const vec = new Array(VECTOR_DIM).fill(0);
	const t = text.toLowerCase();
	for (let i = 0; i < t.length; i++) {
		vec[i % VECTOR_DIM] += t.charCodeAt(i);
	}
	const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
	return norm > 0 ? vec.map((v: number) => v / norm) : vec.map(() => 1 / Math.sqrt(VECTOR_DIM));
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		na += (a[i] ?? 0) * (a[i] ?? 0);
		nb += (b[i] ?? 0) * (b[i] ?? 0);
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom > 0 ? dot / denom : 0;
}

// ---------------------------------------------------------------------------
// Mock: @qdrant/js-client-rest
// ---------------------------------------------------------------------------

vi.mock('@qdrant/js-client-rest', () => {
	function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
		const parts = key.split('.');
		let current: unknown = obj;
		for (const part of parts) {
			if (current == null || typeof current !== 'object') return undefined;
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}

	function matchesCondition(payload: Record<string, unknown>, condition: Record<string, unknown>): boolean {
		const key = condition.key as string;
		const match = condition.match as Record<string, unknown>;
		const value = getNestedValue(payload, key);

		if (match.value !== undefined) {
			if (Array.isArray(value)) return value.includes(match.value);
			return value === match.value;
		}
		if (match.any !== undefined) {
			return (match.any as unknown[]).includes(value);
		}
		return true;
	}

	function matchesFilter(payload: Record<string, unknown>, filter: Record<string, unknown> | undefined): boolean {
		if (!filter) return true;
		const must = filter.must as Record<string, unknown>[] | undefined;
		if (must) {
			return must.every((cond) => matchesCondition(payload, cond));
		}
		// Handle simple key-value filters (used by DocumentsService.list)
		for (const [key, value] of Object.entries(filter)) {
			const payloadVal = getNestedValue(payload, key);
			if (Array.isArray(value)) {
				// Filter value is an array → check intersection
				if (!Array.isArray(payloadVal)) return false;
				if (!value.some((v: unknown) => (payloadVal as unknown[]).includes(v))) return false;
			} else {
				if (payloadVal !== value) return false;
			}
		}
		return true;
	}

	class QdrantClient {
		async collectionExists(name: string) {
			return { exists: qdrantCollections.has(name) };
		}

		async createCollection(name: string, _config: unknown) {
			if (!qdrantCollections.has(name)) {
				qdrantCollections.set(name, []);
			}
		}

		async upsert(name: string, params: { points: Array<{ id: string; vector: unknown; payload: unknown }> }) {
			const points = qdrantCollections.get(name) ?? [];
			for (const p of params.points) {
				const existing = points.findIndex((x) => x.id === p.id);
				const entry = {
					id: p.id,
					vector: p.vector as Record<string, unknown>,
					payload: p.payload as Record<string, unknown>,
				};
				if (existing >= 0) {
					points[existing] = entry;
				} else {
					points.push(entry);
				}
			}
			qdrantCollections.set(name, points);
		}

		async query(
			name: string,
			params: {
				query?: unknown;
				prefetch?: unknown[];
				filter?: Record<string, unknown>;
				limit?: number;
				score_threshold?: number;
				with_payload?: boolean;
			},
		) {
			const points = qdrantCollections.get(name) ?? [];
			const limit = params.limit ?? 10;

			// Determine if this is a dense or hybrid query
			const queryVec = Array.isArray(params.query) ? (params.query as number[]) : null;

			if (queryVec) {
				// Dense search
				const scored = points
					.filter((p) => matchesFilter(p.payload, params.filter))
					.map((p) => {
						const denseVec = (p.vector as Record<string, unknown>)[''] as number[] | undefined;
						const score = denseVec ? cosineSimilarity(queryVec, denseVec) : 0;
						return { id: p.id, score, payload: p.payload };
					})
					.filter((p) => p.score >= (params.score_threshold ?? 0))
					.sort((a, b) => b.score - a.score)
					.slice(0, limit);
				return { points: scored };
			}

			// Hybrid search (prefetch + fusion)
			if (params.prefetch && Array.isArray(params.prefetch)) {
				const allResults = new Map<string, { id: string; score: number; payload: Record<string, unknown> }>();

				for (const pf of params.prefetch as Array<{
					query: unknown;
					filter?: Record<string, unknown>;
					limit?: number;
					score_threshold?: number;
					using?: string;
				}>) {
					const pfLimit = pf.limit ?? limit;
					const pfVec = Array.isArray(pf.query) ? (pf.query as number[]) : null;

					const scored = points
						.filter((p) => matchesFilter(p.payload, pf.filter))
						.map((p) => {
							let score = 0;
							if (pfVec) {
								const denseVec = (p.vector as Record<string, unknown>)[''] as number[] | undefined;
								score = denseVec ? cosineSimilarity(pfVec, denseVec) : 0;
							} else if (pf.using === 'text') {
								// Sparse: just assign a base score so results appear
								score = 0.5;
							}
							return { id: p.id, score, payload: p.payload };
						})
						.filter((p) => p.score >= (pf.score_threshold ?? 0))
						.sort((a, b) => b.score - a.score)
						.slice(0, pfLimit);

					for (const r of scored) {
						const existing = allResults.get(r.id);
						if (!existing || r.score > existing.score) {
							allResults.set(r.id, r);
						}
					}
				}

				const fused = Array.from(allResults.values())
					.sort((a, b) => b.score - a.score)
					.slice(0, limit);

				return { points: fused };
			}

			return { points: [] };
		}

		async scroll(
			name: string,
			params: {
				filter?: Record<string, unknown>;
				with_payload?: boolean;
				limit?: number;
				offset?: unknown;
			},
		) {
			const points = qdrantCollections.get(name) ?? [];
			const limit = params.limit ?? 100;
			const filtered = points.filter((p) => matchesFilter(p.payload, params.filter));
			const startIdx = params.offset ? Number(params.offset) : 0;
			const sliced = filtered.slice(startIdx, startIdx + limit);
			const nextOffset = startIdx + limit < filtered.length ? startIdx + limit : null;
			return {
				points: sliced.map((p) => ({ id: p.id, payload: p.payload })),
				next_page_offset: nextOffset,
			};
		}

		async count(name: string, params: { filter?: Record<string, unknown>; exact?: boolean }) {
			const points = qdrantCollections.get(name) ?? [];
			const count = points.filter((p) => matchesFilter(p.payload, params.filter)).length;
			return { count };
		}

		async delete(name: string, params: { filter?: Record<string, unknown>; wait?: boolean }) {
			const points = qdrantCollections.get(name) ?? [];
			const remaining = points.filter((p) => !matchesFilter(p.payload, params.filter));
			qdrantCollections.set(name, remaining);
		}

		async setPayload(
			name: string,
			params: { payload: Record<string, unknown>; filter?: Record<string, unknown>; wait?: boolean },
		) {
			const points = qdrantCollections.get(name) ?? [];
			for (const p of points) {
				if (matchesFilter(p.payload, params.filter)) {
					Object.assign(p.payload, params.payload);
				}
			}
		}

		async getCollections() {
			return { collections: Array.from(qdrantCollections.keys()).map((name) => ({ name })) };
		}
	}

	return { QdrantClient };
});

// ---------------------------------------------------------------------------
// Mock: openai
// ---------------------------------------------------------------------------

vi.mock('openai', () => {
	class OpenAI {
		embeddings = {
			create: async (params: { model: string; input: string[] | string }) => {
				const texts = Array.isArray(params.input) ? params.input : [params.input];
				embeddingCallHistory.push(texts);
				return {
					data: texts.map((text, index) => ({
						embedding: deterministicEmbed(text),
						index,
					})),
				};
			},
		};

		chat = {
			completions: {
				create: async (params: { messages: unknown[]; model: string }) => {
					chatCallHistory.push({ messages: params.messages, options: params });
					return {
						choices: [
							{
								message: {
									content:
										'Based on the provided context, the answer is as follows. ' +
										'The RAG SDK processes documents through OCR, chunking, and embedding [1]. ' +
										'It supports multi-tenant isolation and citation-first answers [1].',
								},
								finish_reason: 'stop',
							},
						],
						usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
					};
				},
			},
		};
	}

	// The adapter checks `error instanceof OpenAI.APIError`
	(OpenAI as unknown as Record<string, unknown>).APIError = class APIError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	};

	return { default: OpenAI };
});

// ---------------------------------------------------------------------------
// Mock: @mistralai/mistralai
// ---------------------------------------------------------------------------

vi.mock('@mistralai/mistralai', () => {
	class Mistral {
		ocr = {
			process: async (params: { model: string; document: unknown; imageLimit?: number }) => {
				ocrCallHistory.push({ model: params.model, document: params.document });

				return {
					pages: [
						{
							index: 0,
							markdown:
								'# Quarterly Report\n\nRevenue grew 25% year-over-year to $10M.\n\n' +
								'## Key Metrics\n\n| Metric | Value |\n|--------|-------|\n| Revenue | $10M |\n| Users | 50K |\n\n' +
								'The RAG SDK processes documents through OCR, chunking, and embedding pipelines.',
							images: [],
							dimensions: { width: 612, height: 792, dpi: 72 },
						},
						{
							index: 1,
							markdown:
								'## Market Analysis\n\nThe market expanded significantly in Q3.\n' +
								'Multi-tenant isolation ensures data safety for enterprise clients.\n\n' +
								'For more details, see [our website](https://example.com).',
							images: [],
							dimensions: { width: 612, height: 792, dpi: 72 },
						},
					],
					model: params.model,
					usageInfo: { pagesProcessed: 2, docSizeBytes: 1024 },
				};
			},
		};
	}

	return { Mistral };
});

// ---------------------------------------------------------------------------
// Imports (resolved after mocks are in place)
// ---------------------------------------------------------------------------

import { createRag } from './createRag.js';
import type { RagClient } from './createRag.js';
import type { RagConfig } from './config/config.types.js';
import type { IngestResult } from './ingest/ingest.types.js';
import { RagSdkError } from './errors/ragError.js';
import { RagErrorCode } from './errors/errorCodes.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides: Partial<RagConfig> = {}): RagConfig {
	return {
		mistral: { apiKey: 'test-mistral-key' },
		qdrant: { url: 'http://localhost:6333', collection: 'test-e2e' },
		embeddings: {
			provider: 'openai',
			model: 'text-embedding-3-small',
			apiKey: 'test-openai-key',
			vectorSize: VECTOR_DIM,
		},
		chunking: {},
		retrieval: {},
		telemetry: { enabled: false },
		security: {},
		defaults: { tenantId: 'test-tenant' },
		jobs: {},
		...overrides,
	};
}

const SAMPLE_TEXT =
	'The RAG SDK processes documents through OCR, chunking, and embedding pipelines. ' +
	'It supports multi-tenant isolation and citation-first answers for enterprise use cases.';

const UNRELATED_TEXT =
	'Quantum computing uses qubits to perform parallel calculations. ' +
	'Superconducting circuits operate at near absolute zero temperatures.';

// ---------------------------------------------------------------------------
// Clear state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	qdrantCollections.clear();
	ocrCallHistory.length = 0;
	embeddingCallHistory.length = 0;
	chatCallHistory.length = 0;
});

// ===========================================================================
// 1. Initialization & Config Validation
// ===========================================================================

describe('Initialization & Config Validation', () => {
	it('creates a working client with valid config', async () => {
		const rag = await createRag(baseConfig());
		expect(rag).toBeDefined();
		expect(rag.ingest).toBeDefined();
		expect(rag.retrieve).toBeDefined();
		expect(rag.documents).toBeDefined();
		expect(rag.jobs).toBeDefined();
	});

	it('version() returns the SDK version', async () => {
		const rag = await createRag(baseConfig());
		expect(rag.version()).toBe('0.1.0');
	});

	it('validateConfig() returns valid for a good config', async () => {
		const rag = await createRag(baseConfig());
		const result = rag.validateConfig();
		expect(result.valid).toBe(true);
		expect(result.errors).toBeUndefined();
	});

	it('throws RagSdkError when qdrant URL is invalid', async () => {
		await expect(createRag(baseConfig({ qdrant: { url: 'not-a-url', collection: 'test' } }))).rejects.toThrow(
			RagSdkError,
		);
	});

	it('throws RagSdkError for unknown embedding provider', async () => {
		await expect(
			createRag(
				baseConfig({
					embeddings: { provider: 'unknown', model: 'x', apiKey: 'k' },
				}),
			),
		).rejects.toThrow(RagSdkError);
	});
});

// ===========================================================================
// 2. Text Ingestion → Retrieval Pipeline
// ===========================================================================

describe('Text Ingestion → Retrieval Pipeline', () => {
	let rag: RagClient;
	let ingestResult: IngestResult;

	beforeEach(async () => {
		rag = await createRag(baseConfig());
		ingestResult = await rag.ingest.text(SAMPLE_TEXT, {
			tags: ['test', 'rag'],
			domainId: 'engineering',
			metadata: { author: 'test-suite' },
		});
	});

	it('returns completed status with document metadata', () => {
		expect(ingestResult.status).toBe('completed');
		expect(ingestResult.documentId).toMatch(/^doc_/);
		expect(ingestResult.sourceName).toBe('text-input.txt');
		expect(ingestResult.chunksIndexed).toBeGreaterThan(0);
		expect(ingestResult.processingTimeMs).toBeGreaterThanOrEqual(0);
		expect(ingestResult.warnings).toEqual([]);
	});

	it('produces a normalizedDocument with one page', () => {
		expect(ingestResult.normalizedDocument).toBeDefined();
		expect(ingestResult.normalizedDocument?.pageCount).toBe(1);
		expect(ingestResult.normalizedDocument?.pages[0]?.text).toBe(SAMPLE_TEXT);
		expect(ingestResult.normalizedDocument?.mimeType).toBe('text/plain');
	});

	it('produces chunks with correct metadata', () => {
		expect(ingestResult.chunkingResult).toBeDefined();
		const chunks = ingestResult.chunkingResult?.chunks ?? [];
		expect(chunks.length).toBeGreaterThan(0);

		const firstChunk = chunks[0];
		expect(firstChunk.metadata.documentId).toBe(ingestResult.documentId);
		expect(firstChunk.metadata.sourceName).toBe('text-input.txt');
		expect(firstChunk.metadata.embeddingVersion).toMatch(/openai:text-embedding/);
		expect(firstChunk.content.length).toBeGreaterThan(0);
	});

	it('retrieves matching chunks for a related query', async () => {
		const result = await rag.retrieve('How does the RAG SDK process documents?');

		expect(result.query).toBe('How does the RAG SDK process documents?');
		expect(result.searchType).toBe('dense');
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);

		const match = result.matches[0];
		expect(match?.documentId).toBe(ingestResult.documentId);
		expect(match?.content.length).toBeGreaterThan(0);
		expect(match?.score).toBeGreaterThan(0);
	});

	it('retrieval matches include citation anchors', async () => {
		const result = await rag.retrieve('RAG SDK');

		const match = result.matches[0];
		expect(match?.citation).toBeDefined();
		expect(match?.citation.documentId).toBe(ingestResult.documentId);
		expect(match?.citation.sourceName).toBe('text-input.txt');
		expect(match.citation.chunkId).toBeDefined();
		expect(typeof match.citation.pageStart).toBe('number');
		expect(typeof match.citation.pageEnd).toBe('number');
		expect(match.citation.excerpt).toBeDefined();
	});

	it('retrieval matches include chunk metadata', async () => {
		const result = await rag.retrieve('RAG SDK');

		const meta = result.matches[0]?.metadata;
		expect(meta.documentId).toBe(ingestResult.documentId);
		expect(meta.processingMode).toBeDefined();
		expect(meta.embeddingVersion).toBeDefined();
		expect(meta.createdAt).toBeDefined();
	});

	it('returns no matches for a completely unrelated query when threshold is high', async () => {
		// Ingest unrelated content in a separate collection to avoid cross-pollution
		const rag2 = await createRag(
			baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-unrelated' } }),
		);
		await rag2.ingest.text(UNRELATED_TEXT);

		const result = await rag2.retrieve('RAG SDK document processing', { scoreThreshold: 0.99 });
		expect(result.matches.length).toBe(0);
	});
});

// ===========================================================================
// 3. Buffer Ingestion (OCR Path)
// ===========================================================================

describe('Buffer Ingestion via OCR', () => {
	let rag: RagClient;
	let ingestResult: IngestResult;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-ocr' } }));
		const pdfBuffer = Buffer.from('mock-pdf-content');
		ingestResult = await rag.ingest.buffer(pdfBuffer, 'quarterly-report.pdf', {
			tags: ['finance', 'q3'],
		});
	});

	it('processes buffer through OCR and returns completed status', () => {
		expect(ingestResult.status).toBe('completed');
		expect(ingestResult.documentId).toMatch(/^doc_/);
		expect(ingestResult.sourceName).toBe('quarterly-report.pdf');
		expect(ingestResult.chunksIndexed).toBeGreaterThan(0);
	});

	it('calls Mistral OCR with correct model', () => {
		expect(ocrCallHistory.length).toBe(1);
		expect(ocrCallHistory[0]?.model).toBe('mistral-ocr-latest');
	});

	it('produces a normalizedDocument with multiple pages', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.pageCount).toBe(2);
		expect(doc.pages.length).toBe(2);
		expect(doc.pages[0]?.markdown).toContain('Quarterly Report');
		expect(doc.pages[1]?.markdown).toContain('Market Analysis');
	});

	it('extracts tables from OCR markdown', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.tables.length).toBeGreaterThan(0);
		expect(doc.tables[0]?.markdown).toContain('Revenue');
	});

	it('extracts links from OCR markdown', () => {
		const doc = ingestResult.normalizedDocument as NonNullable<typeof ingestResult.normalizedDocument>;
		expect(doc.links.length).toBeGreaterThan(0);
		expect(doc.links[0]?.url).toBe('https://example.com');
	});

	it('chunks carry page range metadata', () => {
		const chunks = ingestResult.chunkingResult?.chunks ?? [];
		for (const chunk of chunks) {
			expect(typeof chunk.metadata.pageStart).toBe('number');
			expect(typeof chunk.metadata.pageEnd).toBe('number');
			expect(chunk.metadata.pageEnd).toBeGreaterThanOrEqual(chunk.metadata.pageStart);
		}
	});

	it('retrieves chunks from OCR-ingested document', async () => {
		const result = await rag.retrieve('quarterly revenue growth');
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0]?.documentId).toBe(ingestResult.documentId);
	});
});

// ===========================================================================
// 4. URL Ingestion
// ===========================================================================

describe('URL Ingestion', () => {
	it('ingests from a URL via OCR', async () => {
		const rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-url' } }));
		const result = await rag.ingest.url('https://example.com/report.pdf');

		expect(result.status).toBe('completed');
		expect(result.sourceName).toBe('report.pdf');
		expect(result.chunksIndexed).toBeGreaterThan(0);
		expect(ocrCallHistory.length).toBe(1);
	});
});

// ===========================================================================
// 5. Document CRUD
// ===========================================================================

describe('Document CRUD', () => {
	let rag: RagClient;
	let docId: string;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-crud' } }));
		const result = await rag.ingest.text(SAMPLE_TEXT, {
			tags: ['original'],
			domainId: 'test-domain',
		});
		docId = result.documentId;
	});

	it('documents.get returns the ingested document', async () => {
		const doc = await rag.documents.get(docId);
		expect(doc).not.toBeNull();
		expect(doc?.documentId).toBe(docId);
		expect(doc?.sourceName).toBe('text-input.txt');
		expect(doc?.chunkCount).toBeGreaterThan(0);
		expect(doc?.totalTokens).toBeGreaterThan(0);
		expect(doc?.embeddingVersion).toMatch(/openai:text-embedding/);
	});

	it('documents.get returns null for non-existent document', async () => {
		const doc = await rag.documents.get('doc_nonexistent');
		expect(doc).toBeNull();
	});

	it('documents.list returns all documents', async () => {
		await rag.ingest.text('Another document for listing.');
		const docs = await rag.documents.list();

		expect(docs.length).toBe(2);
		expect(docs.some((d) => d.documentId === docId)).toBe(true);
	});

	it('documents.list filters by domainId', async () => {
		await rag.ingest.text('Different domain doc', { domainId: 'other-domain' });
		const docs = await rag.documents.list({ domainId: 'test-domain' });

		expect(docs.length).toBe(1);
		expect(docs[0]?.documentId).toBe(docId);
	});

	it('documents.updateMetadata patches tags and domain', async () => {
		await rag.documents.updateMetadata(docId, {
			tags: ['updated', 'v2'],
			domainId: 'new-domain',
		});

		const doc = await rag.documents.get(docId);
		expect(doc?.tags).toEqual(['updated', 'v2']);
		expect(doc?.domainId).toBe('new-domain');
	});

	it('documents.updateMetadata throws for non-existent document', async () => {
		await expect(rag.documents.updateMetadata('doc_nonexistent', { tags: ['x'] })).rejects.toThrow(RagSdkError);
	});

	it('documents.delete removes all chunks for a document', async () => {
		const deleteResult = await rag.documents.delete(docId);
		expect(deleteResult.deleted).toBeGreaterThan(0);

		const doc = await rag.documents.get(docId);
		expect(doc).toBeNull();
	});

	it('documents.reindex replaces chunks with new content', async () => {
		const newChunks = [
			{
				chunkId: 'chk-new-1',
				content: 'Reindexed content part one.',
				metadata: {
					sourceName: 'text-input.txt',
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
			{
				chunkId: 'chk-new-2',
				content: 'Reindexed content part two.',
				metadata: {
					sourceName: 'text-input.txt',
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
		];

		const result = await rag.documents.reindex(docId, newChunks);
		expect(result.reindexed).toBe(2);

		const doc = await rag.documents.get(docId);
		expect(doc?.chunkCount).toBe(2);
	});

	it('documents.reindex rejects chunks with missing citation metadata', async () => {
		const invalidChunks = [
			{
				chunkId: 'chk-invalid-1',
				content: 'Chunk without source name.',
				metadata: {
					pageStart: 0,
					pageEnd: 0,
					processingMode: 'hybrid',
					ocrProvider: 'mistral',
				},
			},
		];

		await expect(rag.documents.reindex(docId, invalidChunks)).rejects.toThrow(RagSdkError);

		try {
			await rag.documents.reindex(docId, invalidChunks);
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.VALIDATION_INVALID_INPUT);
			expect((err as RagSdkError).message).toContain('sourceName');
		}
	});
});

// ===========================================================================
// 6. Multi-Tenant Isolation
// ===========================================================================

describe('Multi-Tenant Isolation', () => {
	let rag: RagClient;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-mt' } }));

		await rag.ingest.text('Tenant Alpha confidential document about machine learning.', {
			security: { tenantId: 'tenant-alpha' },
			tags: ['alpha-doc'],
		});

		await rag.ingest.text('Tenant Beta confidential document about data engineering.', {
			security: { tenantId: 'tenant-beta' },
			tags: ['beta-doc'],
		});
	});

	it('creates separate collections per tenant', () => {
		expect(qdrantCollections.has('test-mt_tenant-alpha')).toBe(true);
		expect(qdrantCollections.has('test-mt_tenant-beta')).toBe(true);
	});

	it('retrieval for tenant-alpha returns only its documents', async () => {
		const result = await rag.retrieve('machine learning', {
			security: { tenantId: 'tenant-alpha' },
		});

		expect(result.matches.length).toBeGreaterThan(0);
		for (const match of result.matches) {
			expect(match.metadata.tenantId).toBe('tenant-alpha');
		}
	});

	it('retrieval for tenant-beta does not return tenant-alpha docs', async () => {
		const result = await rag.retrieve('machine learning', {
			security: { tenantId: 'tenant-beta' },
		});

		for (const match of result.matches) {
			expect(match.metadata.tenantId).not.toBe('tenant-alpha');
		}
	});

	it('delete for tenant-alpha does not affect tenant-beta', async () => {
		const alphaDoc = await rag.documents.list({ tenantId: 'tenant-alpha' });
		expect(alphaDoc.length).toBeGreaterThan(0);

		await rag.documents.delete(alphaDoc[0]?.documentId, 'tenant-alpha');

		const betaDocs = await rag.documents.list({ tenantId: 'tenant-beta' });
		expect(betaDocs.length).toBeGreaterThan(0);
	});

	it('documents.list scoped by tenant', async () => {
		const alphaDocs = await rag.documents.list({ tenantId: 'tenant-alpha' });
		const betaDocs = await rag.documents.list({ tenantId: 'tenant-beta' });

		expect(alphaDocs.length).toBeGreaterThan(0);
		expect(betaDocs.length).toBeGreaterThan(0);

		for (const doc of alphaDocs) {
			expect(doc.tenantId).toBe('tenant-alpha');
		}
		for (const doc of betaDocs) {
			expect(doc.tenantId).toBe('tenant-beta');
		}
	});
});

// ===========================================================================
// 7. Async Job Lifecycle
// ===========================================================================

describe('Async Job Lifecycle', () => {
	let rag: RagClient;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-jobs' } }));
	});

	it('async ingest returns pending status with jobId', async () => {
		const result = await rag.ingest.text('Async document content.', { async: true });

		expect(result.status).toBe('pending');
		expect(result.jobId).toMatch(/^job_/);
		expect(result.documentId).toMatch(/^doc_/);
		expect(result.chunksIndexed).toBe(0);
	});

	it('job eventually completes', async () => {
		const result = await rag.ingest.text('Async document content.', { async: true });
		const jobId = result.jobId as string;

		// Poll until complete (should be fast since all providers are mocked)
		let job = await rag.jobs.get(jobId, 'test-tenant');
		const maxAttempts = 20;
		let attempts = 0;
		while (job?.status !== 'completed' && job?.status !== 'failed' && attempts < maxAttempts) {
			await new Promise((r) => setTimeout(r, 50));
			job = await rag.jobs.get(jobId, 'test-tenant');
			attempts++;
		}

		expect(job?.status).toBe('completed');
		expect(job?.progress).toBe(100);
		expect(job?.completedAt).toBeDefined();
	});

	it('lists jobs with status filter', async () => {
		await rag.ingest.text('Job 1', { async: true });
		await rag.ingest.text('Job 2', { async: true });

		// Wait for jobs to complete
		await new Promise((r) => setTimeout(r, 200));

		const allJobs = await rag.jobs.list({});
		expect(allJobs.length).toBe(2);
	});

	it('cancels a pending job', async () => {
		// Create a client with low concurrency to queue jobs
		const ragLow = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-cancel' },
				jobs: { concurrency: 1 },
			}),
		);

		// Start multiple async jobs to get some queued
		await ragLow.ingest.text('First job content.', { async: true });
		const result2 = await ragLow.ingest.text('Second job content.', { async: true });

		// Try to cancel the second job (may be pending or running)
		try {
			const cancelled = await ragLow.jobs.cancel(result2.jobId as string, 'test-tenant');
			expect(cancelled.status).toBe('cancelled');
		} catch (err) {
			// If it already completed, that's also acceptable in fast mock environments
			expect((err as RagSdkError).code).toBe(RagErrorCode.JOB_ALREADY_COMPLETED);
		}
	});

	it('returns null for non-existent job', async () => {
		const job = await rag.jobs.get('job_nonexistent', 'test-tenant');
		expect(job).toBeNull();
	});
});

// ===========================================================================
// 8. Answer Generation & Citation Policies
// ===========================================================================

describe('Answer Generation & Citation Policies', () => {
	it('generates an answer with citations when evidence exists', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.answer('How does the RAG SDK work?');

		expect(result.answer).toBeDefined();
		expect(result.answer.length).toBeGreaterThan(0);
		expect(result.citations.length).toBeGreaterThan(0);
		expect(result.sources.length).toBeGreaterThan(0);
		expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
		expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
		expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);

		// Verify citation structure
		const citation = result.citations[0];
		expect(citation?.anchor).toBeDefined();
		expect(citation?.anchor.documentId).toBeDefined();
		expect(citation?.anchor.sourceName).toBeDefined();
		expect(citation?.relevanceScore).toBeGreaterThan(0);
		expect(citation?.citationIndex).toBe(1);
		expect(citation?.text.length).toBeGreaterThan(0);
	});

	it('returns source document references', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-sources' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.answer('RAG SDK');

		for (const source of result.sources) {
			expect(source.documentId).toBeDefined();
			expect(source.sourceName).toBeDefined();
			expect(source.pageRange).toBeDefined();
		}
	});

	it('refuse policy: refuses answer when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-refuse' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'refuse',
				},
			}),
		);

		// Don't ingest anything → no evidence
		const result = await rag.answer('What is the capital of Mars?');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.citations.length).toBe(0);
		expect(result.answer).toContain('cannot provide an answer');
		expect(result.disclaimer).toBeDefined();
	});

	it('warn policy: warns when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-warn' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'warn',
				},
			}),
		);

		const result = await rag.answer('Nonexistent topic');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.answer).toContain('No sufficient evidence');
		expect(result.disclaimer).toContain('WARNING');
	});

	it('allow policy: returns empty answer when no evidence found', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-answer-allow' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'allow',
				},
			}),
		);

		const result = await rag.answer('Nothing relevant');

		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('no_evidence');
		expect(result.answer).toBe('');
	});

	it('throws NOT_CONFIGURED when answering is not set up', async () => {
		const rag = await createRag(baseConfig());

		expect(() => rag.answer('test')).toThrow(RagSdkError);

		try {
			rag.answer('test');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.NOT_CONFIGURED);
		}
	});
});

// ===========================================================================
// 9. Hybrid Search
// ===========================================================================

describe('Hybrid Search', () => {
	it('returns results with searchType hybrid when configured', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-hybrid' },
				retrieval: { hybrid: { enabled: true, fusionAlpha: 0.5 } },
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		const result = await rag.retrieve.hybrid('RAG SDK document processing');

		expect(result.searchType).toBe('hybrid');
		expect(result.matches.length).toBeGreaterThan(0);
	});

	it('throws NOT_CONFIGURED when hybrid is not enabled', async () => {
		const rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-no-hybrid' } }));

		await rag.ingest.text(SAMPLE_TEXT);
		await expect(rag.retrieve.hybrid('test query')).rejects.toThrow(RagSdkError);

		try {
			await rag.retrieve.hybrid('test query');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.NOT_CONFIGURED);
		}
	});
});

// ===========================================================================
// 10. Retrieval Filtering
// ===========================================================================

describe('Retrieval Filtering', () => {
	let rag: RagClient;
	let docId1: string;
	let _docId2: string;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-filter' } }));

		const r1 = await rag.ingest.text('Document about machine learning and neural networks.', {
			tags: ['ml', 'ai'],
			domainId: 'data-science',
		});
		docId1 = r1.documentId;

		const r2 = await rag.ingest.text('Document about web development and React frameworks.', {
			tags: ['web', 'frontend'],
			domainId: 'engineering',
		});
		_docId2 = r2.documentId;
	});

	it('filters by documentIds', async () => {
		const result = await rag.retrieve('document', {
			filters: { documentIds: [docId1] },
		});

		for (const match of result.matches) {
			expect(match.documentId).toBe(docId1);
		}
	});

	it('filters by tags', async () => {
		const result = await rag.retrieve('document', {
			filters: { tags: ['ml'] },
		});

		for (const match of result.matches) {
			expect(match.metadata.tags).toContain('ml');
		}
	});

	it('filters by domainId', async () => {
		const result = await rag.retrieve('document', {
			filters: { domainId: 'engineering' },
		});

		for (const match of result.matches) {
			expect(match.metadata.domainId).toBe('engineering');
		}
	});

	it('respects topK limit', async () => {
		const result = await rag.retrieve('document', { topK: 1 });
		expect(result.matches.length).toBeLessThanOrEqual(1);
	});
});

// ===========================================================================
// 11. Telemetry Events
// ===========================================================================

describe('Telemetry Events', () => {
	it('emits all pipeline events during text ingestion', async () => {
		const events: Array<{ type: string; data: unknown }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => {
						events.push(event as { type: string; data: unknown });
					},
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('ingestion_started');
		expect(eventTypes).toContain('embeddings_completed');
		expect(eventTypes).toContain('qdrant_upsert_completed');
		expect(eventTypes).toContain('ingestion_completed');
	});

	it('emits OCR events during buffer ingestion', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-ocr' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.buffer(Buffer.from('pdf'), 'test.pdf');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('ocr_completed');
	});

	it('emits retrieval_executed on search', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-retrieve' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		await rag.retrieve('test query');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('retrieval_executed');
	});

	it('emits answer_generation_executed on answer', async () => {
		const events: Array<{ type: string }> = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-telemetry-answer' },
				answering: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
				telemetry: {
					enabled: true,
					onEvent: (event: unknown) => events.push(event as { type: string }),
				},
			}),
		);

		await rag.ingest.text(SAMPLE_TEXT);
		await rag.answer('test query');

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain('answer_generation_executed');
	});
});

// ===========================================================================
// 12. Error Handling
// ===========================================================================

describe('Error Handling', () => {
	it('rejects files exceeding maxFileSizeBytes', async () => {
		const rag = await createRag(baseConfig({ maxFileSizeBytes: 100 }));
		const largeBuffer = Buffer.alloc(200, 'x');

		await expect(rag.ingest.buffer(largeBuffer, 'big.pdf')).rejects.toThrow(RagSdkError);

		try {
			await rag.ingest.buffer(largeBuffer, 'big.pdf');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.VALIDATION_FILE_TOO_LARGE);
		}
	});

	it('rejects unsupported file types', async () => {
		const rag = await createRag(baseConfig());
		const buffer = Buffer.from('content');

		await expect(rag.ingest.buffer(buffer, 'data.xyz')).rejects.toThrow(RagSdkError);

		try {
			await rag.ingest.buffer(buffer, 'data.xyz');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.VALIDATION_UNSUPPORTED_TYPE);
		}
	});

	it('rejects oversized text input', async () => {
		const rag = await createRag(baseConfig({ maxFileSizeBytes: 50 }));
		const longText = 'x'.repeat(100);

		await expect(rag.ingest.text(longText)).rejects.toThrow(RagSdkError);

		try {
			await rag.ingest.text(longText);
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.VALIDATION_FILE_TOO_LARGE);
		}
	});

	it('RagSdkError carries structured error details', async () => {
		try {
			await createRag(baseConfig({ mistral: { apiKey: '' } }));
		} catch (err) {
			const sdkErr = err as RagSdkError;
			expect(sdkErr).toBeInstanceOf(Error);
			expect(sdkErr).toBeInstanceOf(RagSdkError);
			expect(sdkErr.code).toBeDefined();
			expect(sdkErr.category).toBe('configuration');
			expect(sdkErr.retryable).toBe(false);
		}
	});
});

// ===========================================================================
// 13. Security Preprocessor
// ===========================================================================

describe('Security Preprocessor', () => {
	it('transforms content before chunking and embedding', async () => {
		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-security' },
				security: {
					preprocessor: (content: string) => content.replace(/confidential/gi, '[REDACTED]'),
				},
			}),
		);

		const result = await rag.ingest.buffer(Buffer.from('pdf'), 'secret.pdf');
		const doc = result.normalizedDocument as NonNullable<typeof result.normalizedDocument>;

		// The preprocessor is applied to page markdown and text
		for (const page of doc.pages) {
			expect(page.markdown).not.toContain('confidential');
			expect(page.text).not.toContain('confidential');
		}
	});
});

// ===========================================================================
// 14. Healthcheck
// ===========================================================================

describe('Healthcheck', () => {
	it('returns ok status when Qdrant is reachable', async () => {
		const rag = await createRag(baseConfig());
		const health = await rag.healthcheck();

		expect(health.status).toBe('ok');
		expect(health.details.qdrant).toBe('connected');
		expect(health.details.embeddingProvider).toBe('openai');
		expect(health.details.version).toBe('0.1.0');
	});
});

// ===========================================================================
// 15. Full Pipeline Integration (ingest → retrieve → answer)
// ===========================================================================

describe('Full Pipeline Integration', () => {
	it('completes the full ingest → retrieve → answer cycle', async () => {
		const events: string[] = [];

		const rag = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-full' },
				answering: {
					provider: 'openai',
					model: 'gpt-4o',
					apiKey: 'test-key',
					noCitationPolicy: 'refuse',
				},
				telemetry: {
					enabled: true,
					onEvent: (e: unknown) => events.push((e as { type: string }).type),
				},
			}),
		);

		// Step 1: Ingest multiple documents
		const doc1 = await rag.ingest.text(
			'Machine learning is a subset of artificial intelligence that enables systems to learn from data.',
			{ tags: ['ml'], domainId: 'ai' },
		);
		const doc2 = await rag.ingest.buffer(Buffer.from('pdf'), 'report.pdf', {
			tags: ['report'],
			domainId: 'ai',
		});

		expect(doc1.status).toBe('completed');
		expect(doc2.status).toBe('completed');

		// Step 2: Verify documents exist
		const docs = await rag.documents.list();
		expect(docs.length).toBe(2);

		// Step 3: Retrieve
		const retrieval = await rag.retrieve('What is machine learning?');
		expect(retrieval.matches.length).toBeGreaterThan(0);

		// Step 4: Answer with citations
		const answer = await rag.answer('What is machine learning?');
		expect(answer.answer.length).toBeGreaterThan(0);
		expect(answer.citations.length).toBeGreaterThan(0);
		expect(['high', 'medium', 'low']).toContain(answer.confidence);

		// Step 5: Delete one document
		await rag.documents.delete(doc1.documentId);
		const remainingDocs = await rag.documents.list();
		expect(remainingDocs.length).toBe(1);
		expect(remainingDocs[0]?.documentId).toBe(doc2.documentId);

		// Step 6: Verify telemetry captured the full lifecycle
		expect(events).toContain('ingestion_started');
		expect(events).toContain('ingestion_completed');
		expect(events).toContain('retrieval_executed');
		expect(events).toContain('answer_generation_executed');
	});
});
