import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { estimateTokens } from '../utils/index.js';
import { redactUrl } from '../utils/redact.js';
import type { ChatProvider, LLMProviderConfig, ChatMessage, ChatOptions, ChatResponse } from './llmProvider.types.js';

const logger = createLogger('llm:anthropic');

function mapAnthropicError(error: unknown, provider: string): RagSdkError {
	if (error instanceof Error && 'status' in error) {
		const status = (error as Error & { status: number }).status;

		if (status === 401 || status === 403) {
			return new RagSdkError(
				RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED,
				`Anthropic authentication failed: ${error.message}`,
				{
					provider,
					retryable: false,
					cause: error,
				},
			);
		}
		if (status === 429) {
			return new RagSdkError(RagErrorCode.EMBEDDING_RATE_LIMIT, `Anthropic rate limit exceeded: ${error.message}`, {
				provider,
				retryable: true,
				cause: error,
			});
		}
		if (status === 529) {
			return new RagSdkError(RagErrorCode.ANSWER_PROVIDER_ERROR, `Anthropic API overloaded: ${error.message}`, {
				provider,
				retryable: true,
				cause: error,
			});
		}
	}
	return new RagSdkError(
		RagErrorCode.ANSWER_PROVIDER_ERROR,
		error instanceof Error ? error.message : 'Unknown Anthropic provider error',
		{
			provider,
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		},
	);
}

/**
 * Creates an Anthropic chat provider.
 *
 * Anthropic does not offer an embeddings API, so this returns a {@link ChatProvider}
 * rather than a full {@link LLMProvider}. Pair it with a separate embedding provider
 * (e.g. OpenAI) when vector operations are needed.
 *
 * Requires the `@anthropic-ai/sdk` package to be installed as a peer dependency.
 */
export async function createAnthropicChatProvider(config: LLMProviderConfig): Promise<ChatProvider> {
	if (!config.apiKey) {
		throw new RagSdkError(RagErrorCode.CONFIG_MISSING_REQUIRED, 'API key is required for the Anthropic provider', {
			provider: 'anthropic',
		});
	}

	let Anthropic: typeof import('@anthropic-ai/sdk').default;
	try {
		const module = await import('@anthropic-ai/sdk');
		Anthropic = module.default;
	} catch {
		throw new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			'The "@anthropic-ai/sdk" package is required for the Anthropic provider. Install it with: npm install @anthropic-ai/sdk',
			{ provider: 'anthropic' },
		);
	}

	const client = new Anthropic({
		apiKey: config.apiKey,
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
	});

	logger.info('Anthropic chat provider created', {
		model: config.model,
		baseUrl: config.baseUrl ? redactUrl(config.baseUrl) : undefined,
	});

	return {
		async generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
			logger.debug('Generating chat completion', {
				model: config.model,
				messageCount: messages.length,
			});

			try {
				const systemMessages = messages.filter((m) => m.role === 'system');
				const nonSystemMessages = messages.filter((m) => m.role !== 'system');
				const systemPrompt = systemMessages.map((m) => m.content).join('\n');

				const response = await client.messages.create({
					model: config.model,
					...(systemPrompt ? { system: systemPrompt } : {}),
					messages: nonSystemMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
					max_tokens: options?.maxTokens ?? 1024,
					...(options?.temperature != null ? { temperature: options.temperature } : {}),
					...(options?.topP != null ? { top_p: options.topP } : {}),
				});

				const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
				const content = textBlock && 'text' in textBlock ? (textBlock as { text: string }).text : '';

				let finishReason: string;
				switch (response.stop_reason) {
					case 'end_turn':
						finishReason = 'stop';
						break;
					case 'max_tokens':
						finishReason = 'length';
						break;
					default:
						finishReason = response.stop_reason ?? 'unknown';
				}

				const result: ChatResponse = {
					content,
					finishReason,
					...(response.usage
						? {
								usage: {
									promptTokens: response.usage.input_tokens,
									completionTokens: response.usage.output_tokens,
									totalTokens: response.usage.input_tokens + response.usage.output_tokens,
								},
							}
						: {}),
				};

				logger.debug('Chat completion generated', {
					finishReason: result.finishReason,
					totalTokens: result.usage?.totalTokens,
				});

				return result;
			} catch (error) {
				if (error instanceof RagSdkError) {
					throw error;
				}
				logger.error('Chat completion failed', {
					model: config.model,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
				throw mapAnthropicError(error, 'anthropic');
			}
		},

		getTokenCount(text: string): number {
			return estimateTokens(text);
		},
	};
}
