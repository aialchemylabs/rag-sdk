import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@qdrant/js-client-rest', async () => ({
	QdrantClient: (await import('./e2eHelpers.js')).MockQdrantClient,
}));
vi.mock('openai', async () => ({
	default: (await import('./e2eHelpers.js')).MockOpenAI,
}));
vi.mock('@mistralai/mistralai', async () => ({
	Mistral: (await import('./e2eHelpers.js')).MockMistral,
}));

import { resetState, baseConfig } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';
import { RagSdkError } from '../src/errors/ragError.js';
import { RagErrorCode } from '../src/errors/errorCodes.js';

beforeEach(() => {
	resetState();
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Security Preprocessor
// ---------------------------------------------------------------------------

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

		for (const page of doc.pages) {
			expect(page.markdown).not.toContain('confidential');
			expect(page.text).not.toContain('confidential');
		}
	});
});

// ---------------------------------------------------------------------------
// Healthcheck
// ---------------------------------------------------------------------------

describe('Healthcheck', () => {
	it('returns ok status when Qdrant is reachable', async () => {
		const rag = await createRag(baseConfig());
		const health = await rag.healthcheck();

		expect(health.status).toBe('ok');
		expect(health.details.qdrant).toBe('connected');
		expect(health.details.embeddingProvider).toBe('openai');
		expect(health.details.version).toBe('0.1.2');
	});
});
