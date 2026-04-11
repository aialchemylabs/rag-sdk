import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import type { LLMProviderConfig } from './llmProvider.types.js';

const mockEmbeddingsCreate = vi.fn();
const mockChatCompletionsCreate = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
			this.name = 'APIError';
		}
	}
	return {
		default: class MockOpenAI {
			embeddings = { create: mockEmbeddingsCreate };
			chat = { completions: { create: mockChatCompletionsCreate } };
			static APIError = MockAPIError;
		},
		__mockEmbeddingsCreate: mockEmbeddingsCreate,
		__mockChatCompletionsCreate: mockChatCompletionsCreate,
	};
});

const validConfig: LLMProviderConfig = {
	provider: 'openai',
	model: 'text-embedding-3-small',
	apiKey: 'test-api-key',
};

describe('createOpenAIProvider', () => {
	beforeEach(() => {
		mockEmbeddingsCreate.mockReset();
		mockChatCompletionsCreate.mockReset();
	});

	it('creates provider successfully with valid config', async () => {
		const { createOpenAIProvider } = await import('./openaiProvider.js');
		const provider = createOpenAIProvider(validConfig);

		expect(provider).toBeDefined();
		expect(provider.generateEmbeddings).toBeTypeOf('function');
		expect(provider.generateChatCompletion).toBeTypeOf('function');
		expect(provider.getTokenCount).toBeTypeOf('function');
	});

	it('creates provider with custom baseUrl', async () => {
		const { createOpenAIProvider } = await import('./openaiProvider.js');
		const provider = createOpenAIProvider({
			...validConfig,
			baseUrl: 'https://custom-openai.example.com/v1',
		});

		expect(provider).toBeDefined();
	});

	describe('generateEmbeddings', () => {
		it('returns correct vectors sorted by index', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			mockEmbeddingsCreate.mockResolvedValueOnce({
				data: [
					{ index: 1, embedding: [0.4, 0.5, 0.6] },
					{ index: 0, embedding: [0.1, 0.2, 0.3] },
				],
			});

			const result = await provider.generateEmbeddings(['hello', 'world']);

			expect(result).toEqual([
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			]);
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				model: 'text-embedding-3-small',
				input: ['hello', 'world'],
			});
		});

		it('generates embeddings for a single text', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			mockEmbeddingsCreate.mockResolvedValueOnce({
				data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
			});

			const result = await provider.generateEmbeddings(['hello']);

			expect(result).toEqual([[0.1, 0.2, 0.3]]);
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				model: 'text-embedding-3-small',
				input: ['hello'],
			});
		});

		it('returns empty array for empty input', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			const result = await provider.generateEmbeddings([]);

			expect(result).toEqual([]);
			expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
		});

		it('maps 401 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			const OpenAI = (await import('openai')).default;
			const apiError = new OpenAI.APIError(401, 'Unauthorized');
			mockEmbeddingsCreate.mockRejectedValueOnce(apiError);

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED);
				expect(sdkError.retryable).toBe(false);
			}
		});

		it('maps 403 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			const OpenAI = (await import('openai')).default;
			const apiError = new OpenAI.APIError(403, 'Forbidden');
			mockEmbeddingsCreate.mockRejectedValueOnce(apiError);

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED);
				expect(sdkError.retryable).toBe(false);
			}
		});

		it('maps 429 error to EMBEDDING_RATE_LIMIT with retryable true', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			const OpenAI = (await import('openai')).default;
			const apiError = new OpenAI.APIError(429, 'Rate limit exceeded');
			mockEmbeddingsCreate.mockRejectedValueOnce(apiError);

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.EMBEDDING_RATE_LIMIT);
				expect(sdkError.retryable).toBe(true);
			}
		});

		it('maps unknown errors to EMBEDDING_PROVIDER_ERROR', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			mockEmbeddingsCreate.mockRejectedValueOnce(new Error('Something went wrong'));

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.EMBEDDING_PROVIDER_ERROR);
				expect(sdkError.retryable).toBe(false);
			}
		});

		it('maps non-Error unknown errors to EMBEDDING_PROVIDER_ERROR', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			mockEmbeddingsCreate.mockRejectedValueOnce('string error');

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.EMBEDDING_PROVIDER_ERROR);
				expect(sdkError.message).toBe('Unknown OpenAI provider error');
			}
		});
	});

	describe('generateChatCompletion', () => {
		it('passes messages in correct format', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'Hello there!' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			});

			await provider.generateChatCompletion([
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hi' },
				{ role: 'assistant', content: 'Hello' },
				{ role: 'user', content: 'How are you?' },
			]);

			expect(mockChatCompletionsCreate).toHaveBeenCalledWith({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: 'You are helpful.' },
					{ role: 'user', content: 'Hi' },
					{ role: 'assistant', content: 'Hello' },
					{ role: 'user', content: 'How are you?' },
				],
			});
		});

		it('passes options correctly (maxTokens, temperature, topP)', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'response' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			});

			await provider.generateChatCompletion([{ role: 'user', content: 'test' }], {
				maxTokens: 512,
				temperature: 0.7,
				topP: 0.9,
			});

			expect(mockChatCompletionsCreate).toHaveBeenCalledWith({
				model: 'gpt-4o',
				messages: [{ role: 'user', content: 'test' }],
				max_tokens: 512,
				temperature: 0.7,
				top_p: 0.9,
			});
		});

		it('omits optional params when not provided', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'response' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			});

			await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);

			const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
			expect(callArgs).not.toHaveProperty('max_tokens');
			expect(callArgs).not.toHaveProperty('temperature');
			expect(callArgs).not.toHaveProperty('top_p');
		});

		it('maps response correctly (content, finishReason, usage)', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'Hello! How can I help?' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

			expect(result).toEqual({
				content: 'Hello! How can I help?',
				finishReason: 'stop',
				usage: {
					promptTokens: 25,
					completionTokens: 10,
					totalTokens: 35,
				},
			});
		});

		it('maps finish_reason "stop" correctly', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'done' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect(result.finishReason).toBe('stop');
		});

		it('maps finish_reason "length" correctly', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'truncated response' },
						finish_reason: 'length',
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 100, total_tokens: 105 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect(result.finishReason).toBe('length');
		});

		it('defaults finishReason to "unknown" when null', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'response' },
						finish_reason: null,
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect(result.finishReason).toBe('unknown');
		});

		it('defaults content to empty string when null', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: null },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect(result.content).toBe('');
		});

		it('omits usage when response has no usage data', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'Hello!' },
						finish_reason: 'stop',
					},
				],
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'Hi' }]);
			expect(result.usage).toBeUndefined();
		});

		it('throws ANSWER_PROVIDER_ERROR when no choices returned', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [],
			});

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.ANSWER_PROVIDER_ERROR);
				expect(sdkError.message).toContain('no choices');
			}
		});

		it('maps 401 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			const OpenAI = (await import('openai')).default;
			const apiError = new OpenAI.APIError(401, 'Unauthorized');
			mockChatCompletionsCreate.mockRejectedValueOnce(apiError);

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED);
				expect(sdkError.retryable).toBe(false);
			}
		});

		it('maps 429 error to EMBEDDING_RATE_LIMIT with retryable true', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			const OpenAI = (await import('openai')).default;
			const apiError = new OpenAI.APIError(429, 'Rate limit exceeded');
			mockChatCompletionsCreate.mockRejectedValueOnce(apiError);

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.EMBEDDING_RATE_LIMIT);
				expect(sdkError.retryable).toBe(true);
			}
		});

		it('maps unknown chat errors to EMBEDDING_PROVIDER_ERROR', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			mockChatCompletionsCreate.mockRejectedValueOnce(new Error('Something went wrong'));

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.EMBEDDING_PROVIDER_ERROR);
				expect(sdkError.retryable).toBe(false);
			}
		});

		it('re-throws RagSdkError as-is without wrapping', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider({ ...validConfig, model: 'gpt-4o' });

			const originalError = new RagSdkError(RagErrorCode.ANSWER_PROVIDER_ERROR, 'Custom error', {
				provider: 'openai',
			});
			mockChatCompletionsCreate.mockRejectedValueOnce(originalError);

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBe(originalError);
			}
		});
	});

	describe('getTokenCount', () => {
		it('returns estimated token count using estimateTokens', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			// estimateTokens: Math.ceil(text.length / 4)
			expect(provider.getTokenCount('Hello, world!')).toBe(Math.ceil('Hello, world!'.length / 4));
		});

		it('handles single character', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			// 1 char / 4 = ceil(0.25) = 1
			expect(provider.getTokenCount('a')).toBe(1);
		});

		it('handles longer text', async () => {
			const { createOpenAIProvider } = await import('./openaiProvider.js');
			const provider = createOpenAIProvider(validConfig);

			const text = 'hello world!';
			// 12 chars / 4 = 3
			expect(provider.getTokenCount(text)).toBe(3);
		});
	});
});
