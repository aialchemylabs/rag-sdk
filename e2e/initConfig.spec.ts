import { describe, expect, it, vi } from 'vitest';

vi.mock('@qdrant/js-client-rest', async () => ({
	QdrantClient: (await import('./e2eHelpers.js')).MockQdrantClient,
}));
vi.mock('openai', async () => ({
	default: (await import('./e2eHelpers.js')).MockOpenAI,
}));
vi.mock('@mistralai/mistralai', async () => ({
	Mistral: (await import('./e2eHelpers.js')).MockMistral,
}));

import { baseConfig } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';
import { RagSdkError } from '../src/errors/ragError.js';

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
		expect(rag.version()).toBe('0.1.1');
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
					embeddings: { provider: 'unknown' as 'openai', model: 'x', apiKey: 'k' },
				}),
			),
		).rejects.toThrow(RagSdkError);
	});
});
