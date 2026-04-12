/**
 * Shared test helpers, mock implementations, and state for E2E tests.
 *
 * Provides in-memory mock implementations for Qdrant, OpenAI, and Mistral,
 * along with shared mutable state, deterministic embedding functions,
 * and test configuration helpers.
 */

import type { RagConfig } from '../src/config/config.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VECTOR_DIM = 8;

export const SAMPLE_TEXT =
	'The RAG SDK processes documents through OCR, chunking, and embedding pipelines. ' +
	'It supports multi-tenant isolation and citation-first answers for enterprise use cases.';

export const UNRELATED_TEXT =
	'Quantum computing uses qubits to perform parallel calculations. ' +
	'Superconducting circuits operate at near absolute zero temperatures.';

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

/** In-memory Qdrant store: collectionName → point[] */
export const qdrantCollections = new Map<
	string,
	Array<{
		id: string;
		vector: Record<string, unknown>;
		payload: Record<string, unknown>;
	}>
>();

export const ocrCallHistory: Array<{ model: string; document: unknown }> = [];
export const embeddingCallHistory: string[][] = [];
export const chatCallHistory: Array<{ messages: unknown[]; options: unknown }> = [];

/** Resets all shared mock state between tests. */
export function resetState(): void {
	qdrantCollections.clear();
	ocrCallHistory.length = 0;
	embeddingCallHistory.length = 0;
	chatCallHistory.length = 0;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function deterministicEmbed(text: string): number[] {
	const vec = new Array(VECTOR_DIM).fill(0);
	const t = text.toLowerCase();
	for (let i = 0; i < t.length; i++) {
		vec[i % VECTOR_DIM] += t.charCodeAt(i);
	}
	const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
	return norm > 0 ? vec.map((v: number) => v / norm) : vec.map(() => 1 / Math.sqrt(VECTOR_DIM));
}

export function cosineSimilarity(a: number[], b: number[]): number {
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
// Qdrant filter helpers (used internally by MockQdrantClient)
// ---------------------------------------------------------------------------

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
	for (const [key, value] of Object.entries(filter)) {
		const payloadVal = getNestedValue(payload, key);
		if (Array.isArray(value)) {
			if (!Array.isArray(payloadVal)) return false;
			if (!value.some((v: unknown) => (payloadVal as unknown[]).includes(v))) return false;
		} else {
			if (payloadVal !== value) return false;
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Mock: QdrantClient
// ---------------------------------------------------------------------------

export class MockQdrantClient {
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
		const queryVec = Array.isArray(params.query) ? (params.query as number[]) : null;

		if (queryVec) {
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

// ---------------------------------------------------------------------------
// Mock: OpenAI
// ---------------------------------------------------------------------------

export class MockOpenAI {
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

(MockOpenAI as unknown as Record<string, unknown>).APIError = class APIError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
};

// ---------------------------------------------------------------------------
// Mock: Mistral
// ---------------------------------------------------------------------------

export class MockMistral {
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

// ---------------------------------------------------------------------------
// Test config helper
// ---------------------------------------------------------------------------

export function baseConfig(overrides: Partial<RagConfig> = {}): RagConfig {
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
