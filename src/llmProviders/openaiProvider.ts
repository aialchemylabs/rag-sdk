import OpenAI from 'openai';
import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { estimateTokens } from '../utils/index.js';
import { redactUrl } from '../utils/redact.js';
import type { LLMProvider, LLMProviderConfig, ChatMessage, ChatOptions, ChatResponse } from './llmProvider.types.js';

const logger = createLogger('llm:openai');

function mapOpenAIError(error: unknown, provider: string): RagSdkError {
	if (error instanceof OpenAI.APIError) {
		if (error.status === 401 || error.status === 403) {
			return new RagSdkError(
				RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED,
				`OpenAI authentication failed: ${error.message}`,
				{
					provider,
					retryable: false,
					cause: error,
				},
			);
		}
		if (error.status === 429) {
			return new RagSdkError(RagErrorCode.EMBEDDING_RATE_LIMIT, `OpenAI rate limit exceeded: ${error.message}`, {
				provider,
				retryable: true,
				cause: error,
			});
		}
	}
	return new RagSdkError(
		RagErrorCode.EMBEDDING_PROVIDER_ERROR,
		error instanceof Error ? error.message : 'Unknown OpenAI provider error',
		{
			provider,
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		},
	);
}

export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
	const client = new OpenAI({
		apiKey: config.apiKey,
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
	});

	logger.info('OpenAI provider created', {
		model: config.model,
		baseUrl: config.baseUrl ? redactUrl(config.baseUrl) : undefined,
	});

	return {
		async generateEmbeddings(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) {
				return [];
			}

			logger.debug('Generating embeddings', { model: config.model, count: texts.length });

			try {
				// encoding_format must be explicitly 'float'. OpenAI npm v6 flipped the default
				// to 'base64', which the client decodes assuming an OpenAI server response.
				// LiteLLM-mediated providers (Ollama, Cohere, Voyage, etc.) return plain JSON
				// float arrays, and the v6 decoder misreads those as base64 → 256 garbage floats.
				const response = await client.embeddings.create({
					model: config.model,
					input: texts,
					encoding_format: 'float',
				});

				const embeddings = response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);

				logger.debug('Embeddings generated', {
					count: embeddings.length,
					dimensions: embeddings[0]?.length,
				});

				return embeddings;
			} catch (error) {
				logger.error('Embedding generation failed', {
					model: config.model,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
				throw mapOpenAIError(error, 'openai');
			}
		},

		async generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
			logger.debug('Generating chat completion', {
				model: config.model,
				messageCount: messages.length,
			});

			try {
				const response = await client.chat.completions.create({
					model: config.model,
					messages: messages.map((m) => ({ role: m.role, content: m.content })),
					...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
					...(options?.temperature != null ? { temperature: options.temperature } : {}),
					...(options?.topP != null ? { top_p: options.topP } : {}),
				});

				const choice = response.choices[0];

				if (!choice) {
					throw new RagSdkError(RagErrorCode.ANSWER_PROVIDER_ERROR, 'OpenAI returned no choices', {
						provider: 'openai',
					});
				}

				const result: ChatResponse = {
					content: choice.message.content ?? '',
					finishReason: choice.finish_reason ?? 'unknown',
					...(response.usage
						? {
								usage: {
									promptTokens: response.usage.prompt_tokens,
									completionTokens: response.usage.completion_tokens,
									totalTokens: response.usage.total_tokens,
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
				throw mapOpenAIError(error, 'openai');
			}
		},

		getTokenCount(text: string): number {
			return estimateTokens(text);
		},
	};
}
