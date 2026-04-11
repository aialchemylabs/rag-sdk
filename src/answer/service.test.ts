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
});
