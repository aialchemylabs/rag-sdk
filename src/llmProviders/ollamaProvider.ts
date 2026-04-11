import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { estimateTokens } from '../utils/index.js';
import type { LLMProvider, LLMProviderConfig, ChatMessage, ChatOptions, ChatResponse } from './llmProvider.types.js';

const logger = createLogger('llm:ollama');

function mapOllamaError(error: unknown, provider: string): RagSdkError {
	const message = error instanceof Error ? error.message : String(error);

	// Connection errors — Ollama server is not running or unreachable
	if (/ECONNREFUSED|fetch failed|timeout|ENOTFOUND|ECONNRESET/i.test(message)) {
		return new RagSdkError(
			RagErrorCode.VECTOR_CONNECTION_ERROR,
			`Ollama server is not reachable: ${message}. Ensure the Ollama server is running.`,
			{
				provider,
				retryable: true,
				cause: error instanceof Error ? error : undefined,
			},
		);
	}

	// Model not found — user needs to pull the model first
	if (/not found|pull/i.test(message)) {
		return new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			`Ollama model not available: ${message}. Pull it with: ollama pull <model>`,
			{
				provider,
				retryable: false,
				cause: error instanceof Error ? error : undefined,
			},
		);
	}

	return new RagSdkError(
		RagErrorCode.EMBEDDING_PROVIDER_ERROR,
		error instanceof Error ? error.message : 'Unknown Ollama provider error',
		{
			provider,
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		},
	);
}

/**
 * Creates an Ollama LLM provider that supports both embeddings and chat completions.
 *
 * Ollama runs locally and does not require an API key. The provider connects to the
 * Ollama server at the configured `baseUrl` (defaults to `http://localhost:11434`).
 *
 * Requires the `ollama` package to be installed as a peer dependency.
 */
export async function createOllamaProvider(config: LLMProviderConfig): Promise<LLMProvider> {
	let OllamaClient: typeof import('ollama').Ollama;
	try {
		const module = await import('ollama');
		OllamaClient = module.Ollama;
	} catch {
		throw new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			'The "ollama" package is required for the Ollama provider. Install it: pnpm add ollama',
			{ provider: 'ollama' },
		);
	}

	const host = config.baseUrl ?? 'http://localhost:11434';
	const client = new OllamaClient({ host });

	logger.info('Ollama provider created', {
		model: config.model,
		host,
	});

	return {
		async generateEmbeddings(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) {
				return [];
			}

			logger.debug('Generating embeddings', { model: config.model, count: texts.length });

			try {
				const response = await client.embed({ model: config.model, input: texts });

				logger.debug('Embeddings generated', {
					count: response.embeddings.length,
					dimensions: response.embeddings[0]?.length,
				});

				return response.embeddings;
			} catch (error) {
				if (error instanceof RagSdkError) {
					throw error;
				}
				logger.error('Embedding generation failed', {
					model: config.model,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
				throw mapOllamaError(error, 'ollama');
			}
		},

		async generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
			logger.debug('Generating chat completion', {
				model: config.model,
				messageCount: messages.length,
			});

			try {
				const response = await client.chat({
					model: config.model,
					messages: messages.map((m) => ({ role: m.role, content: m.content })),
					options: {
						...(options?.maxTokens != null ? { num_predict: options.maxTokens } : {}),
						...(options?.temperature != null ? { temperature: options.temperature } : {}),
						...(options?.topP != null ? { top_p: options.topP } : {}),
					},
				});

				let finishReason: string;
				switch (response.done_reason) {
					case 'stop':
						finishReason = 'stop';
						break;
					case 'length':
						finishReason = 'length';
						break;
					default:
						finishReason = response.done_reason ?? 'unknown';
				}

				const result: ChatResponse = {
					content: response.message.content,
					finishReason,
					...(response.prompt_eval_count != null || response.eval_count != null
						? {
								usage: {
									promptTokens: response.prompt_eval_count ?? 0,
									completionTokens: response.eval_count ?? 0,
									totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
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
				throw mapOllamaError(error, 'ollama');
			}
		},

		getTokenCount(text: string): number {
			return estimateTokens(text);
		},
	};
}
