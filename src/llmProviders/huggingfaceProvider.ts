import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { estimateTokens } from '../utils/index.js';
import { redactUrl } from '../utils/redact.js';
import type { LLMProvider, LLMProviderConfig, ChatMessage, ChatOptions, ChatResponse } from './llmProvider.types.js';

const logger = createLogger('llm:huggingface');

function mapHuggingFaceError(error: unknown, provider: string): RagSdkError {
	const message = error instanceof Error ? error.message : String(error);

	if (/401|unauthorized/i.test(message)) {
		return new RagSdkError(RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED, `HuggingFace authentication failed: ${message}`, {
			provider,
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		});
	}

	if (/429|rate/i.test(message)) {
		return new RagSdkError(RagErrorCode.EMBEDDING_RATE_LIMIT, `HuggingFace rate limit exceeded: ${message}`, {
			provider,
			retryable: true,
			cause: error instanceof Error ? error : undefined,
		});
	}

	return new RagSdkError(
		RagErrorCode.EMBEDDING_PROVIDER_ERROR,
		error instanceof Error ? error.message : 'Unknown HuggingFace provider error',
		{
			provider,
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		},
	);
}

/**
 * Creates a HuggingFace LLM provider supporting both embeddings and chat completions.
 *
 * Requires the `@huggingface/inference` package to be installed as a peer dependency.
 * The provider uses the HuggingFace Inference API for feature extraction (embeddings)
 * and chat completion.
 */
export async function createHuggingFaceProvider(config: LLMProviderConfig): Promise<LLMProvider> {
	if (!config.apiKey) {
		throw new RagSdkError(RagErrorCode.CONFIG_MISSING_REQUIRED, 'API key is required for the HuggingFace provider', {
			provider: 'huggingface',
		});
	}

	let InferenceClient: typeof import('@huggingface/inference').InferenceClient;
	try {
		const module = await import('@huggingface/inference');
		InferenceClient = module.InferenceClient;
	} catch {
		throw new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			'The "@huggingface/inference" package is required for the HuggingFace provider. Install it: pnpm add @huggingface/inference',
			{ provider: 'huggingface' },
		);
	}

	const client = new InferenceClient(config.apiKey);

	logger.info('HuggingFace provider created', {
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
				const results: number[][] = [];

				for (const text of texts) {
					const embedding = await client.featureExtraction({
						model: config.model,
						inputs: text,
						...(config.baseUrl ? { endpointUrl: config.baseUrl } : {}),
					});

					results.push(embedding as number[]);
				}

				logger.debug('Embeddings generated', {
					count: results.length,
					dimensions: results[0]?.length,
				});

				return results;
			} catch (error) {
				if (error instanceof RagSdkError) {
					throw error;
				}
				logger.error('Embedding generation failed', {
					model: config.model,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
				throw mapHuggingFaceError(error, 'huggingface');
			}
		},

		async generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
			logger.debug('Generating chat completion', {
				model: config.model,
				messageCount: messages.length,
			});

			try {
				const response = await client.chatCompletion({
					model: config.model,
					messages: messages.map((m) => ({ role: m.role, content: m.content })),
					...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
					...(options?.temperature != null ? { temperature: options.temperature } : {}),
					...(options?.topP != null ? { top_p: options.topP } : {}),
					...(config.baseUrl ? { endpointUrl: config.baseUrl } : {}),
				});

				const choice = response.choices[0];

				if (!choice) {
					throw new RagSdkError(RagErrorCode.ANSWER_PROVIDER_ERROR, 'HuggingFace returned no choices', {
						provider: 'huggingface',
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
									totalTokens: response.usage.prompt_tokens + response.usage.completion_tokens,
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
				throw mapHuggingFaceError(error, 'huggingface');
			}
		},

		getTokenCount(text: string): number {
			return estimateTokens(text);
		},
	};
}
