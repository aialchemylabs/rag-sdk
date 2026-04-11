import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagErrorCode } from '../errors/errorCodes.js';
import type { LLMProviderConfig } from './llmProvider.types.js';

const mockBatchEmbedContents = vi.fn();
const mockGenerateContent = vi.fn();
let capturedModelOptions: Record<string, unknown> = {};

vi.mock('@google/generative-ai', () => {
	return {
		GoogleGenerativeAI: class MockGoogleAI {
			getGenerativeModel(opts: Record<string, unknown>) {
				capturedModelOptions = opts;
				return {
					batchEmbedContents: mockBatchEmbedContents,
					generateContent: mockGenerateContent,
				};
			}
		},
	};
});

const baseConfig: LLMProviderConfig = {
	provider: 'gemini',
	model: 'text-embedding-004',
	apiKey: 'test-api-key',
};

describe('createGeminiProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedModelOptions = {};
	});

	it('should create a provider successfully', async () => {
		const { createGeminiProvider } = await import('./geminiProvider.js');
		const provider = await createGeminiProvider(baseConfig);

		expect(provider).toBeDefined();
		expect(provider.generateEmbeddings).toBeTypeOf('function');
		expect(provider.generateChatCompletion).toBeTypeOf('function');
		expect(provider.getTokenCount).toBeTypeOf('function');
	});

	it('should throw CONFIG_MISSING_REQUIRED when apiKey is missing', async () => {
		const { createGeminiProvider } = await import('./geminiProvider.js');

		const error = await createGeminiProvider({ ...baseConfig, apiKey: undefined }).catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: RagErrorCode.CONFIG_MISSING_REQUIRED,
			name: 'RagSdkError',
		});
	});

	it('should throw CONFIG_MISSING_REQUIRED when apiKey is empty string', async () => {
		const { createGeminiProvider } = await import('./geminiProvider.js');

		const error = await createGeminiProvider({ ...baseConfig, apiKey: '' }).catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: RagErrorCode.CONFIG_MISSING_REQUIRED,
			name: 'RagSdkError',
		});
	});

	describe('generateEmbeddings', () => {
		it('should return correct vectors from batchEmbedContents', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			mockBatchEmbedContents.mockResolvedValueOnce({
				embeddings: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
			});

			const result = await provider.generateEmbeddings(['hello', 'world']);

			expect(result).toEqual([
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			]);
			expect(mockBatchEmbedContents).toHaveBeenCalledWith({
				requests: [
					{ content: { parts: [{ text: 'hello' }], role: 'user' } },
					{ content: { parts: [{ text: 'world' }], role: 'user' } },
				],
			});
		});

		it('should return empty array for empty input', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			const result = await provider.generateEmbeddings([]);

			expect(result).toEqual([]);
			expect(mockBatchEmbedContents).not.toHaveBeenCalled();
		});
	});

	describe('generateChatCompletion', () => {
		it('should map assistant role to model role', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Hello!',
					candidates: [{ finishReason: 'STOP' }],
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 5,
						totalTokenCount: 15,
					},
				},
			});

			await provider.generateChatCompletion([
				{ role: 'user', content: 'Hi' },
				{ role: 'assistant', content: 'Hello there' },
				{ role: 'user', content: 'How are you?' },
			]);

			expect(mockGenerateContent).toHaveBeenCalledWith({
				contents: [
					{ role: 'user', parts: [{ text: 'Hi' }] },
					{ role: 'model', parts: [{ text: 'Hello there' }] },
					{ role: 'user', parts: [{ text: 'How are you?' }] },
				],
				generationConfig: {},
			});
		});

		it('should extract system message as systemInstruction', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Response',
					candidates: [{ finishReason: 'STOP' }],
					usageMetadata: {
						promptTokenCount: 20,
						candidatesTokenCount: 5,
						totalTokenCount: 25,
					},
				},
			});

			await provider.generateChatCompletion([
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hi' },
			]);

			// The model should have been obtained with systemInstruction
			expect(capturedModelOptions).toMatchObject({
				model: 'gemini-1.5-pro',
				systemInstruction: 'You are helpful.',
			});

			// System message should NOT be included in contents
			expect(mockGenerateContent).toHaveBeenCalledWith({
				contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
				generationConfig: {},
			});
		});

		it('should map finish reason STOP to stop', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Done',
					candidates: [{ finishReason: 'STOP' }],
					usageMetadata: undefined,
				},
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

			expect(result.finishReason).toBe('stop');
		});

		it('should map finish reason MAX_TOKENS to length', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Truncated...',
					candidates: [{ finishReason: 'MAX_TOKENS' }],
					usageMetadata: undefined,
				},
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

			expect(result.finishReason).toBe('length');
		});

		it('should map response usage metadata correctly', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Hello!',
					candidates: [{ finishReason: 'STOP' }],
					usageMetadata: {
						promptTokenCount: 100,
						candidatesTokenCount: 50,
						totalTokenCount: 150,
					},
				},
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

			expect(result.usage).toEqual({
				promptTokens: 100,
				completionTokens: 50,
				totalTokens: 150,
			});
		});

		it('should omit usage when usageMetadata is not present', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockResolvedValueOnce({
				response: {
					text: () => 'Hello!',
					candidates: [{ finishReason: 'STOP' }],
					usageMetadata: undefined,
				},
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

			expect(result.usage).toBeUndefined();
		});
	});

	describe('error mapping', () => {
		it('should map permission denied to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			mockBatchEmbedContents.mockRejectedValueOnce(new Error('403 Forbidden: permission denied'));

			const error = await provider.generateEmbeddings(['test']).catch((e: unknown) => e);

			expect(error).toMatchObject({
				code: RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED,
				retryable: false,
				name: 'RagSdkError',
			});
		});

		it('should map rate limit to EMBEDDING_RATE_LIMIT', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			mockBatchEmbedContents.mockRejectedValueOnce(new Error('429 Resource exhausted: quota exceeded'));

			const error = await provider.generateEmbeddings(['test']).catch((e: unknown) => e);

			expect(error).toMatchObject({
				code: RagErrorCode.EMBEDDING_RATE_LIMIT,
				retryable: true,
				name: 'RagSdkError',
			});
		});

		it('should map unknown embedding errors to EMBEDDING_PROVIDER_ERROR', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			mockBatchEmbedContents.mockRejectedValueOnce(new Error('Something went wrong'));

			const error = await provider.generateEmbeddings(['test']).catch((e: unknown) => e);

			expect(error).toMatchObject({
				code: RagErrorCode.EMBEDDING_PROVIDER_ERROR,
				name: 'RagSdkError',
			});
		});

		it('should map unknown chat errors to ANSWER_PROVIDER_ERROR', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider({ ...baseConfig, model: 'gemini-1.5-pro' });

			mockGenerateContent.mockRejectedValueOnce(new Error('Something went wrong'));

			const error = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]).catch((e: unknown) => e);

			expect(error).toMatchObject({
				code: RagErrorCode.ANSWER_PROVIDER_ERROR,
				name: 'RagSdkError',
			});
		});
	});

	describe('getTokenCount', () => {
		it('should estimate tokens using the utility function', async () => {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			const provider = await createGeminiProvider(baseConfig);

			const count = provider.getTokenCount('Hello, world!');

			// estimateTokens uses Math.ceil(text.length / 4)
			expect(count).toBe(Math.ceil('Hello, world!'.length / 4));
		});
	});
});

describe('createGeminiProvider - missing SDK', () => {
	it('should throw CONFIG_MISSING_REQUIRED when SDK is not installed', async () => {
		vi.resetModules();

		vi.doMock('@google/generative-ai', () => {
			throw new Error('Cannot find module');
		});

		const { createGeminiProvider } = await import('./geminiProvider.js');

		const error = await createGeminiProvider({
			provider: 'gemini',
			model: 'text-embedding-004',
			apiKey: 'test-key',
		}).catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: RagErrorCode.CONFIG_MISSING_REQUIRED,
			name: 'RagSdkError',
			message: expect.stringContaining('@google/generative-ai'),
		});
	});
});
