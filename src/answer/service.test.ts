import { describe, expect, it, vi } from 'vitest';
import type { ValidatedConfig } from '../config/validate.js';
import type { ChatProvider } from '../llmProviders/llmProvider.types.js';
import type { RetrieveMatch, RetrieveResult } from '../retrieve/retrieve.types.js';
import type { RetrieveService } from '../retrieve/service.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import { AnswerService } from './service.js';

function makeValidatedConfig(noCitationPolicy: 'warn' | 'refuse' | 'allow' = 'refuse'): ValidatedConfig {
	return {
		mistral: { apiKey: 'test-mistral-key', model: 'mistral-ocr-latest' },
		qdrant: { url: 'http://localhost:6333', collection: 'test-answer' },
		embeddings: {
			provider: 'openai',
			model: 'text-embedding-3-small',
			apiKey: 'test-openai-key',
			distanceMetric: 'cosine',
			versionLabel: 'openai:text-embedding-3-small',
		},
		chunking: {
			targetTokens: 512,
			maxTokens: 1024,
			overlapTokens: 64,
			headingAware: true,
			preservePageBoundaries: false,
			preserveTables: true,
		},
		retrieval: {
			topK: 10,
			scoreThreshold: 0,
		},
		answering: {
			provider: 'openai',
			model: 'gpt-4o',
			apiKey: 'test-openai-key',
			maxTokens: 2048,
			temperature: 0.1,
			noCitationPolicy,
		},
		telemetry: { enabled: true },
		security: { redactPii: false },
		defaults: { processingMode: 'hybrid', tenantId: 'tenant-a' },
		jobs: { concurrency: 5, timeoutMs: 300_000 },
		maxFileSizeBytes: 50 * 1024 * 1024,
	};
}

function makeMatch(index: number): RetrieveMatch {
	return {
		chunkId: `chk-${index}`,
		documentId: `doc-${index}`,
		content: `Supporting content for chunk ${index}.`,
		score: 0.9 - index * 0.1,
		metadata: {
			documentId: `doc-${index}`,
			chunkId: `chk-${index}`,
			chunkIndex: index - 1,
			sourceName: `source-${index}.pdf`,
			pageStart: index - 1,
			pageEnd: index - 1,
			processingMode: 'hybrid',
			embeddingVersion: 'openai:text-embedding-3-small',
			ocrProvider: 'mistral',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
		citation: {
			documentId: `doc-${index}`,
			sourceName: `source-${index}.pdf`,
			chunkId: `chk-${index}`,
			pageStart: index - 1,
			pageEnd: index - 1,
			excerpt: `Excerpt ${index}`,
		},
	};
}

function makeRetrievalResult(): RetrieveResult {
	return {
		query: 'How does this work?',
		matches: [makeMatch(1), makeMatch(2)],
		totalMatches: 2,
		searchTimeMs: 5,
		searchType: 'dense',
	};
}

function createService(responses: string[], noCitationPolicy: 'warn' | 'refuse' | 'allow' = 'refuse') {
	const provider: ChatProvider = {
		generateChatCompletion: vi.fn(async () => ({
			content: responses.shift() ?? '',
			finishReason: 'stop',
		})),
		getTokenCount: vi.fn(() => 0),
	};

	const retriever = {
		query: vi.fn(async () => makeRetrievalResult()),
	} as unknown as RetrieveService;

	const telemetry = {
		emit: vi.fn(),
		metric: vi.fn(),
		trackDuration: vi.fn(),
		withOverride: vi.fn(function (this: unknown) {
			return this as TelemetryEmitter;
		}),
	} as unknown as TelemetryEmitter;

	return {
		service: new AnswerService(makeValidatedConfig(noCitationPolicy), provider, retriever, telemetry),
		provider,
		retriever,
		telemetry,
	};
}

describe('AnswerService citation validation', () => {
	it('repairs answers that initially cite out-of-range sources', async () => {
		const { service, provider } = createService(
			[
				'The SDK handles ingestion and retrieval with strong guarantees [99].',
				'The SDK handles ingestion and retrieval [1].',
			],
			'refuse',
		);

		const result = await service.answer('How does the SDK work?');

		expect(provider.generateChatCompletion).toHaveBeenCalledTimes(2);
		expect(result.answer).toContain('[1]');
		expect(result.citations.map((citation) => citation.citationIndex)).toEqual([1]);
		expect(result.sources).toEqual([
			{
				documentId: 'doc-1',
				sourceName: 'source-1.pdf',
				pageRange: '0-0',
			},
		]);
	});

	it('withholds the answer when citations remain invalid after max repair attempts', async () => {
		const { service, provider } = createService(
			[
				'The SDK answer is grounded in docs [99].',
				'The SDK answer is grounded in docs [42].',
				'The SDK answer is grounded in docs [42].',
			],
			'refuse',
		);

		const result = await service.answer('How does the SDK work?');

		expect(provider.generateChatCompletion).toHaveBeenCalledTimes(3);
		expect(result.answer).toContain('Unable to produce a sufficiently cited answer');
		expect(result.citations).toEqual([]);
		expect(result.sources).toEqual([]);
		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('low_evidence');
		expect(result.disclaimer).toContain('[42]');
	});

	it('treats mixed valid and invalid citations as a contract violation', async () => {
		const { service } = createService(
			[
				'The SDK processes documents [1] and supports retrieval [99].',
				'The SDK processes documents [1] and supports retrieval [99].',
				'The SDK processes documents [1] and supports retrieval [99].',
			],
			'warn',
		);

		const result = await service.answer('How does the SDK work?');

		expect(result.answer).toContain('Unable to produce a sufficiently cited answer');
		expect(result.citations).toEqual([]);
		expect(result.sources).toEqual([]);
		expect(result.confidence).toBe('none');
		expect(result.riskLevel).toBe('low_evidence');
		expect(result.disclaimer).toContain('[99]');
	});

	it('resolves tenantId from config.defaults in telemetry events when no per-call override', async () => {
		const { service, telemetry } = createService(['The SDK handles retrieval [1].'], 'refuse');

		await service.answer('How does the SDK work?');

		const emit = vi.mocked(telemetry.emit);
		const startEvent = emit.mock.calls.find(([event]) => event === 'answer_generation_started');
		expect(startEvent).toBeDefined();
		expect((startEvent?.[1] as { tenantId?: string } | undefined)?.tenantId).toBe('tenant-a');

		const executedEvent = emit.mock.calls.find(([event]) => event === 'answer_generation_executed');
		expect(executedEvent).toBeDefined();
		expect((executedEvent?.[1] as { tenantId?: string } | undefined)?.tenantId).toBe('tenant-a');
	});
});

interface UsageResponseSpec {
	content: string;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

function createServiceWithUsage(
	responses: UsageResponseSpec[],
	noCitationPolicy: 'warn' | 'refuse' | 'allow' = 'refuse',
	options?: { tokenCount?: (text: string) => number; emptyMatches?: boolean },
) {
	const queue = [...responses];
	const provider: ChatProvider = {
		generateChatCompletion: vi.fn(async () => {
			const next = queue.shift() ?? { content: '' };
			return {
				content: next.content,
				finishReason: 'stop',
				...(next.usage !== undefined && { usage: next.usage }),
			};
		}),
		getTokenCount: vi.fn(options?.tokenCount ?? (() => 0)),
	};

	const retriever = {
		query: vi.fn(async () =>
			options?.emptyMatches
				? { query: 'q', matches: [], totalMatches: 0, searchTimeMs: 1, searchType: 'dense' as const }
				: makeRetrievalResult(),
		),
	} as unknown as RetrieveService;

	const telemetry = {
		emit: vi.fn(),
		metric: vi.fn(),
		trackDuration: vi.fn(),
		withOverride: vi.fn(function (this: unknown) {
			return this as TelemetryEmitter;
		}),
	} as unknown as TelemetryEmitter;

	return {
		service: new AnswerService(makeValidatedConfig(noCitationPolicy), provider, retriever, telemetry),
		provider,
		retriever,
		telemetry,
	};
}

describe('AnswerService usage + modelId', () => {
	it('populates usage from provider response on happy path', async () => {
		const { service } = createServiceWithUsage([
			{
				content: 'The SDK handles retrieval [1].',
				usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
			},
		]);

		const result = await service.answer('How does the SDK work?');

		expect(result.modelId).toBe('gpt-4o');
		expect(result.usage).toEqual({
			promptTokens: 80,
			completionTokens: 20,
			totalTokens: 100,
			estimated: false,
		});
	});

	it('returns zero usage with estimated=false on no-evidence refusal', async () => {
		const { service } = createServiceWithUsage([], 'refuse', { emptyMatches: true });

		const result = await service.answer('Unknown question');

		expect(result.riskLevel).toBe('no_evidence');
		expect(result.modelId).toBe('gpt-4o');
		expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false });
	});

	it('carries usage through on citation-violation refusal', async () => {
		const bad = 'The SDK [99] handles retrieval [42].';
		const { service } = createServiceWithUsage(
			[
				{ content: bad, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
				{ content: bad, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
				{ content: bad, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
			],
			'refuse',
		);

		const result = await service.answer('How?');

		expect(result.riskLevel).toBe('low_evidence');
		expect(result.modelId).toBe('gpt-4o');
		expect(result.usage).toEqual({
			promptTokens: 30,
			completionTokens: 15,
			totalTokens: 45,
			estimated: false,
		});
	});

	it('accumulates usage across citation-repair retries', async () => {
		const { service } = createServiceWithUsage([
			{
				content: 'Cites [99].',
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			},
			{
				content: 'Cites [1].',
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			},
		]);

		const result = await service.answer('How?');

		expect(result.usage).toEqual({
			promptTokens: 20,
			completionTokens: 10,
			totalTokens: 30,
			estimated: false,
		});
	});

	it('falls back to getTokenCount with estimated=true when provider omits usage', async () => {
		const tokenCount = vi.fn((text: string) => (text.length > 50 ? 42 : 7));
		const { service } = createServiceWithUsage([{ content: 'Cites [1].' }], 'refuse', { tokenCount });

		const result = await service.answer('How?');

		expect(result.usage.estimated).toBe(true);
		expect(result.usage.promptTokens).toBe(42);
		expect(result.usage.completionTokens).toBe(7);
		expect(result.usage.totalTokens).toBe(49);
	});

	it('marks usage estimated when any call in the pipeline omits usage (mixed)', async () => {
		const tokenCount = vi.fn(() => 5);
		const { service } = createServiceWithUsage(
			[
				{ content: 'Cites [99].', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
				{ content: 'Cites [1].' },
			],
			'refuse',
			{ tokenCount },
		);

		const result = await service.answer('How?');

		expect(result.usage.estimated).toBe(true);
		expect(result.usage.totalTokens).toBe(25);
	});

	it('emits modelId and totalTokens on answer_generation_executed telemetry', async () => {
		const { service, telemetry } = createServiceWithUsage([
			{
				content: 'The SDK handles retrieval [1].',
				usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
			},
		]);

		await service.answer('How?');

		const emit = vi.mocked(telemetry.emit);
		const executedEvent = emit.mock.calls.find(([event]) => event === 'answer_generation_executed');
		const metadata = (executedEvent?.[1] as { metadata?: Record<string, unknown> })?.metadata ?? {};
		expect(metadata.modelId).toBe('gpt-4o');
		expect(metadata.totalTokens).toBe(100);
	});
});
