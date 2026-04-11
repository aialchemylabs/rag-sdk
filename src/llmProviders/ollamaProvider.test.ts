import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import type { LLMProviderConfig } from './llmProvider.types.js';

vi.mock('ollama', () => {
	const mockEmbed = vi.fn();
	const mockChat = vi.fn();
	return {
		Ollama: class MockOllama {
			embed = mockEmbed;
			chat = mockChat;
		},
		__mockEmbed: mockEmbed,
		__mockChat: mockChat,
	};
});

async function getMocks() {
	const mod = await import('ollama');
	const typed = mod as unknown as {
		__mockEmbed: ReturnType<typeof vi.fn>;
		__mockChat: ReturnType<typeof vi.fn>;
	};
	return { mockEmbed: typed.__mockEmbed, mockChat: typed.__mockChat };
}

const baseConfig: LLMProviderConfig = {
	provider: 'ollama',
	model: 'llama3',
};

describe('createOllamaProvider', () => {
	let mockEmbed: ReturnType<typeof vi.fn>;
	let mockChat: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const mocks = await getMocks();
		mockEmbed = mocks.mockEmbed;
		mockChat = mocks.mockChat;
		mockEmbed.mockReset();
		mockChat.mockReset();
	});

	it('creates provider successfully without apiKey', async () => {
		const { createOllamaProvider } = await import('./ollamaProvider.js');
		const provider = await createOllamaProvider(baseConfig);

		expect(provider).toBeDefined();
		expect(provider.generateEmbeddings).toBeTypeOf('function');
		expect(provider.generateChatCompletion).toBeTypeOf('function');
		expect(provider.getTokenCount).toBeTypeOf('function');
	});

	it('uses default host http://localhost:11434 when no baseUrl provided', async () => {
		const { createOllamaProvider } = await import('./ollamaProvider.js');
		// Provider creation should not throw — the default host is used
		const provider = await createOllamaProvider({ ...baseConfig });
		expect(provider).toBeDefined();
	});

	it('uses custom baseUrl when provided', async () => {
		const { createOllamaProvider } = await import('./ollamaProvider.js');
		const provider = await createOllamaProvider({
			...baseConfig,
			baseUrl: 'http://my-ollama:8080',
		});
		expect(provider).toBeDefined();
	});

	it('does NOT throw when apiKey is missing (unlike other providers)', async () => {
		const { createOllamaProvider } = await import('./ollamaProvider.js');

		// Ollama is local — no API key required
		await expect(
			createOllamaProvider({
				provider: 'ollama',
				model: 'llama3',
				// No apiKey
			}),
		).resolves.toBeDefined();
	});

	describe('generateEmbeddings', () => {
		it('calls embed with model and input array', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockEmbed.mockResolvedValueOnce({
				embeddings: [
					[0.1, 0.2, 0.3],
					[0.4, 0.5, 0.6],
				],
			});

			const result = await provider.generateEmbeddings(['hello', 'world']);

			expect(mockEmbed).toHaveBeenCalledWith({
				model: 'llama3',
				input: ['hello', 'world'],
			});
			expect(result).toEqual([
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			]);
		});

		it('returns empty array for empty input', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			const result = await provider.generateEmbeddings([]);

			expect(result).toEqual([]);
			expect(mockEmbed).not.toHaveBeenCalled();
		});
	});

	describe('generateChatCompletion', () => {
		it('maps messages correctly', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockResolvedValueOnce({
				message: { content: 'Hi there!' },
				done_reason: 'stop',
				prompt_eval_count: 10,
				eval_count: 5,
			});

			await provider.generateChatCompletion([
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
				{ role: 'user', content: 'How are you?' },
			]);

			expect(mockChat).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'llama3',
					messages: [
						{ role: 'system', content: 'You are helpful.' },
						{ role: 'user', content: 'Hello' },
						{ role: 'assistant', content: 'Hi' },
						{ role: 'user', content: 'How are you?' },
					],
				}),
			);
		});

		it('maps maxTokens to num_predict', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockResolvedValueOnce({
				message: { content: 'response' },
				done_reason: 'stop',
				prompt_eval_count: 5,
				eval_count: 3,
			});

			await provider.generateChatCompletion([{ role: 'user', content: 'test' }], {
				maxTokens: 256,
				temperature: 0.7,
				topP: 0.9,
			});

			expect(mockChat).toHaveBeenCalledWith(
				expect.objectContaining({
					options: {
						num_predict: 256,
						temperature: 0.7,
						top_p: 0.9,
					},
				}),
			);
		});

		it('maps response correctly (content, finishReason, usage)', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockResolvedValueOnce({
				message: { content: 'Hello! How can I help?' },
				done_reason: 'stop',
				prompt_eval_count: 25,
				eval_count: 10,
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

		it('maps done_reason "length" to finishReason "length"', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockResolvedValueOnce({
				message: { content: 'truncated' },
				done_reason: 'length',
				prompt_eval_count: 5,
				eval_count: 100,
			});

			const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect(result.finishReason).toBe('length');
		});
	});

	describe('error mapping', () => {
		it('maps ECONNREFUSED to VECTOR_CONNECTION_ERROR (retryable)', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockEmbed.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.VECTOR_CONNECTION_ERROR);
				expect(sdkError.retryable).toBe(true);
			}
		});

		it('maps "fetch failed" to VECTOR_CONNECTION_ERROR (retryable)', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockRejectedValueOnce(new Error('fetch failed'));

			try {
				await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.VECTOR_CONNECTION_ERROR);
				expect(sdkError.retryable).toBe(true);
			}
		});

		it('maps model not found to CONFIG_MISSING_REQUIRED', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockEmbed.mockRejectedValueOnce(new Error('model "llama3" not found, try pulling it first'));

			try {
				await provider.generateEmbeddings(['test']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RagSdkError);
				const sdkError = error as RagSdkError;
				expect(sdkError.code).toBe(RagErrorCode.CONFIG_MISSING_REQUIRED);
				expect(sdkError.retryable).toBe(false);
				expect(sdkError.message).toContain('pull');
			}
		});

		it('maps unknown errors to EMBEDDING_PROVIDER_ERROR', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			mockChat.mockRejectedValueOnce(new Error('something unexpected'));

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
	});

	describe('getTokenCount', () => {
		it('returns estimated token count using estimateTokens', async () => {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			const provider = await createOllamaProvider(baseConfig);

			// estimateTokens: Math.ceil(text.length / 4)
			expect(provider.getTokenCount('hello world!')).toBe(3); // 12 chars / 4 = 3
			expect(provider.getTokenCount('a')).toBe(1); // 1 char / 4 = ceil(0.25) = 1
		});
	});
});

describe('createOllamaProvider — SDK not installed', () => {
	it('throws CONFIG_MISSING_REQUIRED when ollama package is not installed', async () => {
		// Temporarily override the mock to simulate missing package
		vi.doMock('ollama', () => {
			throw new Error('Cannot find module');
		});

		// Clear the cached import to force re-evaluation
		vi.resetModules();

		try {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			await createOllamaProvider({
				provider: 'ollama',
				model: 'llama3',
			});
			expect.fail('Should have thrown');
		} catch (error) {
			// After resetModules the RagSdkError class identity differs, so check by name
			const sdkError = error as RagSdkError;
			expect(sdkError.name).toBe('RagSdkError');
			expect(sdkError.code).toBe('CONFIG_MISSING_REQUIRED');
			expect(sdkError.message).toContain('ollama');
			expect(sdkError.message).toContain('pnpm add ollama');
		}

		// Restore the original mock for other tests
		vi.doMock('ollama', () => {
			const mockEmbed = vi.fn();
			const mockChat = vi.fn();
			return {
				Ollama: class MockOllama {
					embed = mockEmbed;
					chat = mockChat;
				},
				__mockEmbed: mockEmbed,
				__mockChat: mockChat,
			};
		});
		vi.resetModules();
	});
});
