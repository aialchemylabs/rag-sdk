import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import type { LLMProviderConfig } from './llmProvider.types.js';

vi.mock('@anthropic-ai/sdk', () => {
	const mockCreate = vi.fn();
	return {
		default: class MockAnthropic {
			messages = { create: mockCreate };
		},
		__mockCreate: mockCreate,
	};
});

async function getMockCreate() {
	const mod = await import('@anthropic-ai/sdk');
	return (mod as unknown as { __mockCreate: ReturnType<typeof vi.fn> }).__mockCreate;
}

const validConfig: LLMProviderConfig = {
	provider: 'anthropic',
	model: 'claude-sonnet-4-20250514',
	apiKey: 'test-api-key',
};

describe('createAnthropicChatProvider', () => {
	let mockCreate: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		mockCreate = await getMockCreate();
		mockCreate.mockReset();
	});

	it('creates provider successfully with valid config', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		expect(provider).toBeDefined();
		expect(provider.generateChatCompletion).toBeTypeOf('function');
		expect(provider.getTokenCount).toBeTypeOf('function');
	});

	it('extracts system messages to system param and passes non-system messages', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		mockCreate.mockResolvedValueOnce({
			content: [{ type: 'text', text: 'response' }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 10, output_tokens: 5 },
		});

		await provider.generateChatCompletion([
			{ role: 'system', content: 'You are helpful.' },
			{ role: 'system', content: 'Be concise.' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' },
			{ role: 'user', content: 'How are you?' },
		]);

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'claude-sonnet-4-20250514',
				system: 'You are helpful.\nBe concise.',
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi there' },
					{ role: 'user', content: 'How are you?' },
				],
			}),
		);
	});

	it('maps Anthropic response to ChatResponse correctly', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		mockCreate.mockResolvedValueOnce({
			content: [{ type: 'text', text: 'Hello! How can I help?' }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 25, output_tokens: 10 },
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

	it('maps stop_reason "end_turn" to finishReason "stop"', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		mockCreate.mockResolvedValueOnce({
			content: [{ type: 'text', text: 'done' }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 5, output_tokens: 2 },
		});

		const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
		expect(result.finishReason).toBe('stop');
	});

	it('maps stop_reason "max_tokens" to finishReason "length"', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		mockCreate.mockResolvedValueOnce({
			content: [{ type: 'text', text: 'truncated response' }],
			stop_reason: 'max_tokens',
			usage: { input_tokens: 5, output_tokens: 100 },
		});

		const result = await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
		expect(result.finishReason).toBe('length');
	});

	it('maps 401 error to AUTH_PROVIDER_UNAUTHORIZED', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		const apiError = new Error('Unauthorized');
		Object.assign(apiError, { status: 401 });
		mockCreate.mockRejectedValueOnce(apiError);

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
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		const apiError = new Error('Rate limited');
		Object.assign(apiError, { status: 429 });
		mockCreate.mockRejectedValueOnce(apiError);

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

	it('maps 529 error to ANSWER_PROVIDER_ERROR with retryable true', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
		const provider = await createAnthropicChatProvider(validConfig);

		const apiError = new Error('Overloaded');
		Object.assign(apiError, { status: 529 });
		mockCreate.mockRejectedValueOnce(apiError);

		try {
			await provider.generateChatCompletion([{ role: 'user', content: 'test' }]);
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(RagSdkError);
			const sdkError = error as RagSdkError;
			expect(sdkError.code).toBe(RagErrorCode.ANSWER_PROVIDER_ERROR);
			expect(sdkError.retryable).toBe(true);
		}
	});

	it('throws CONFIG_MISSING_REQUIRED when apiKey is missing', async () => {
		const { createAnthropicChatProvider } = await import('./anthropicProvider.js');

		try {
			await createAnthropicChatProvider({
				provider: 'anthropic',
				model: 'claude-sonnet-4-20250514',
			});
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(RagSdkError);
			const sdkError = error as RagSdkError;
			expect(sdkError.code).toBe(RagErrorCode.CONFIG_MISSING_REQUIRED);
			expect(sdkError.message).toContain('API key is required');
		}
	});
});
