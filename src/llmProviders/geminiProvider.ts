import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { estimateTokens } from '../utils/index.js';
import type { LLMProvider, LLMProviderConfig, ChatMessage, ChatOptions, ChatResponse } from './llmProvider.types.js';

const logger = createLogger('llm:gemini');

function mapGeminiError(error: unknown, context: 'embedding' | 'chat'): RagSdkError {
	const message = error instanceof Error ? error.message : String(error);
	const lowerMessage = message.toLowerCase();

	if (
		lowerMessage.includes('403') ||
		lowerMessage.includes('permission') ||
		lowerMessage.includes('forbidden') ||
		lowerMessage.includes('unauthorized')
	) {
		return new RagSdkError(RagErrorCode.AUTH_PROVIDER_UNAUTHORIZED, `Gemini authentication failed: ${message}`, {
			provider: 'gemini',
			retryable: false,
			cause: error instanceof Error ? error : undefined,
		});
	}

	if (
		lowerMessage.includes('429') ||
		lowerMessage.includes('quota') ||
		lowerMessage.includes('rate') ||
		lowerMessage.includes('resource exhausted')
	) {
		return new RagSdkError(RagErrorCode.EMBEDDING_RATE_LIMIT, `Gemini rate limit exceeded: ${message}`, {
			provider: 'gemini',
			retryable: true,
			cause: error instanceof Error ? error : undefined,
		});
	}

	const code = context === 'chat' ? RagErrorCode.ANSWER_PROVIDER_ERROR : RagErrorCode.EMBEDDING_PROVIDER_ERROR;

	return new RagSdkError(code, error instanceof Error ? error.message : 'Unknown Gemini provider error', {
		provider: 'gemini',
		retryable: false,
		cause: error instanceof Error ? error : undefined,
	});
}

/**
 * Create a Gemini LLM provider that supports both embeddings and chat completions.
 *
 * Requires the `@google/generative-ai` package to be installed as a peer dependency.
 */
export async function createGeminiProvider(config: LLMProviderConfig): Promise<LLMProvider> {
	if (!config.apiKey) {
		throw new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			'Gemini provider requires an API key. Set the "apiKey" field in your provider config.',
			{ provider: 'gemini' },
		);
	}

	let GoogleGenerativeAI: typeof import('@google/generative-ai').GoogleGenerativeAI;

	try {
		const module = await import('@google/generative-ai');
		GoogleGenerativeAI = module.GoogleGenerativeAI;
	} catch {
		throw new RagSdkError(
			RagErrorCode.CONFIG_MISSING_REQUIRED,
			'The "@google/generative-ai" package is required for the Gemini provider. Install it: pnpm add @google/generative-ai',
			{ provider: 'gemini' },
		);
	}

	const client = new GoogleGenerativeAI(config.apiKey);

	logger.info('Gemini provider created', { model: config.model });

	return {
		async generateEmbeddings(texts: string[]): Promise<number[][]> {
			if (texts.length === 0) {
				return [];
			}

			logger.debug('Generating embeddings', { model: config.model, count: texts.length });

			try {
				const embeddingModel = client.getGenerativeModel({ model: config.model });
				const result = await embeddingModel.batchEmbedContents({
					requests: texts.map((text) => ({
						content: { parts: [{ text }], role: 'user' as const },
					})),
				});

				const embeddings = result.embeddings.map((e: { values: number[] }) => e.values);

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
				throw mapGeminiError(error, 'embedding');
			}
		},

		async generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
			logger.debug('Generating chat completion', {
				model: config.model,
				messageCount: messages.length,
			});

			try {
				const systemMessage = messages.find((m) => m.role === 'system');
				const nonSystemMessages = messages.filter((m) => m.role !== 'system');

				const chatModel = client.getGenerativeModel({
					model: config.model,
					...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
				});

				const contents = nonSystemMessages.map((m) => ({
					role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
					parts: [{ text: m.content }],
				}));

				const response = await chatModel.generateContent({
					contents,
					generationConfig: {
						...(options?.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
						...(options?.temperature != null ? { temperature: options.temperature } : {}),
						...(options?.topP != null ? { topP: options.topP } : {}),
					},
				});

				const candidate = response.response.candidates?.[0];
				const rawFinishReason = candidate?.finishReason ?? 'unknown';

				let finishReason: string;
				switch (rawFinishReason) {
					case 'STOP':
						finishReason = 'stop';
						break;
					case 'MAX_TOKENS':
						finishReason = 'length';
						break;
					default:
						finishReason = rawFinishReason.toLowerCase();
						break;
				}

				const usage = response.response.usageMetadata;

				const result: ChatResponse = {
					content: response.response.text(),
					finishReason,
					...(usage
						? {
								usage: {
									promptTokens: usage.promptTokenCount,
									completionTokens: usage.candidatesTokenCount,
									totalTokens: usage.totalTokenCount,
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
				throw mapGeminiError(error, 'chat');
			}
		},

		getTokenCount(text: string): number {
			return estimateTokens(text);
		},
	};
}
