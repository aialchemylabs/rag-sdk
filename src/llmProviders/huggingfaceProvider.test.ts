import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import type { LLMProviderConfig } from './llmProvider.types.js';

const mockFeatureExtraction = vi.fn();
const mockChatCompletion = vi.fn();

vi.mock('@huggingface/inference', () => {
	return {
		InferenceClient: class MockInferenceClient {
			featureExtraction = mockFeatureExtraction;
			chatCompletion = mockChatCompletion;
		},
	};
});

const baseConfig: LLMProviderConfig = {
	provider: 'huggingface',
	model: 'sentence-transformers/all-MiniLM-L6-v2',
	apiKey: 'hf_test_api_key',
};

describe('huggingfaceProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('createHuggingFaceProvider', () => {
		it('creates provider successfully', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			expect(provider).toBeDefined();
			expect(provider.generateEmbeddings).toBeTypeOf('function');
			expect(provider.generateChatCompletion).toBeTypeOf('function');
			expect(provider.getTokenCount).toBeTypeOf('function');
		});

		it('throws CONFIG_MISSING_REQUIRED when apiKey is missing', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const configWithoutKey: LLMProviderConfig = {
				provider: 'huggingface',
				model: 'some-model',
			};

			await expect(createHuggingFaceProvider(configWithoutKey)).rejects.toThrow(RagSdkError);
			await expect(createHuggingFaceProvider(configWithoutKey)).rejects.toMatchObject({
				code: RagErrorCode.CONFIG_MISSING_REQUIRED,
			});
		});
	});

	describe('generateEmbeddings', () => {
		it('calls featureExtraction for each text', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockFeatureExtraction.mockResolvedValueOnce([0.1, 0.2, 0.3]).mockResolvedValueOnce([0.4, 0.5, 0.6]);

			const result = await provider.generateEmbeddings(['hello', 'world']);

			expect(mockFeatureExtraction).toHaveBeenCalledTimes(2);
			expect(mockFeatureExtraction).toHaveBeenCalledWith({
				model: baseConfig.model,
				inputs: 'hello',
			});
			expect(mockFeatureExtraction).toHaveBeenCalledWith({
				model: baseConfig.model,
				inputs: 'world',
			});
			expect(result).toEqual([
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			]);
		});

		it('returns empty array for empty input', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			const result = await provider.generateEmbeddings([]);

			expect(result).toEqual([]);
			expect(mockFeatureExtraction).not.toHaveBeenCalled();
		});

		it('maps 401 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockFeatureExtraction.mockRejectedValueOnce(new Error('401 Unauthorized'));

			await expect(provider.generateEmbeddings(['test'])).rejects.toMatchObject({
				code: RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED,
			});
		});

		it('maps 429 error to EMBEDDING_RATE_LIMIT', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockFeatureExtraction.mockRejectedValueOnce(new Error('429 Too Many Requests'));

			await expect(provider.generateEmbeddings(['test'])).rejects.toMatchObject({
				code: RagErrorCode.EMBEDDING_RATE_LIMIT,
				retryable: true,
			});
		});
	});

	describe('generateChatCompletion', () => {
		it('passes messages in correct format', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockChatCompletion.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'Hello there!' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			});

			const messages = [
				{ role: 'system' as const, content: 'You are helpful.' },
				{ role: 'user' as const, content: 'Hi' },
			];

			await provider.generateChatCompletion(messages);

			expect(mockChatCompletion).toHaveBeenCalledWith(
				expect.objectContaining({
					model: baseConfig.model,
					messages: [
						{ role: 'system', content: 'You are helpful.' },
						{ role: 'user', content: 'Hi' },
					],
				}),
			);
		});

		it('maps options correctly (maxTokens to max_tokens, temperature, topP to top_p)', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockChatCompletion.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'response' },
						finish_reason: 'stop',
					},
				],
			});

			await provider.generateChatCompletion([{ role: 'user', content: 'test' }], {
				maxTokens: 512,
				temperature: 0.7,
				topP: 0.9,
			});

			expect(mockChatCompletion).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 512,
					temperature: 0.7,
					top_p: 0.9,
				}),
			);
		});

		it('maps response correctly (content, finishReason, usage)', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockChatCompletion.mockResolvedValueOnce({
				choices: [
					{
						message: { content: 'The answer is 42.' },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 15, completion_tokens: 8 },
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'What is the answer?' }]);

			expect(result.content).toBe('The answer is 42.');
			expect(result.finishReason).toBe('stop');
			expect(result.usage).toEqual({
				promptTokens: 15,
				completionTokens: 8,
				totalTokens: 23,
			});
		});

		it('maps 401 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockChatCompletion.mockRejectedValueOnce(new Error('401 unauthorized access'));

			await expect(provider.generateChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
				code: RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED,
			});
		});

		it('maps 429 error to EMBEDDING_RATE_LIMIT', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			mockChatCompletion.mockRejectedValueOnce(new Error('rate limit exceeded (429)'));

			await expect(provider.generateChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
				code: RagErrorCode.EMBEDDING_RATE_LIMIT,
				retryable: true,
			});
		});
	});

	describe('getTokenCount', () => {
		it('returns estimated token count', async () => {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			const provider = await createHuggingFaceProvider(baseConfig);

			const count = provider.getTokenCount('hello world');
			expect(count).toBeGreaterThan(0);
			expect(typeof count).toBe('number');
		});
	});
});

describe('huggingfaceProvider - missing SDK', () => {
	it('throws CONFIG_MISSING_REQUIRED when @huggingface/inference is not installed', async () => {
		vi.doMock('@huggingface/inference', () => {
			throw new Error('Cannot find module');
		});

		const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
		const config: LLMProviderConfig = {
			provider: 'huggingface',
			model: 'some-model',
			apiKey: 'hf_key',
		};

		await expect(createHuggingFaceProvider(config)).rejects.toThrow(RagSdkError);
		await expect(createHuggingFaceProvider(config)).rejects.toMatchObject({
			code: RagErrorCode.CONFIG_MISSING_REQUIRED,
		});
	});
});
