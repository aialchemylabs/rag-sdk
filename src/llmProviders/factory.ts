import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import { supportsCapability } from './capabilities.js';
import type { ChatProvider, EmbeddingProvider, LLMProvider, LLMProviderConfig } from './llmProvider.types.js';
import { createOpenAIProvider } from './openaiProvider.js';

const logger = createLogger('llm:factory');

async function resolveProvider(config: LLMProviderConfig): Promise<LLMProvider | ChatProvider> {
	switch (config.provider) {
		case 'openai':
			return createOpenAIProvider(config);
		case 'anthropic': {
			const { createAnthropicChatProvider } = await import('./anthropicProvider.js');
			return createAnthropicChatProvider(config);
		}
		case 'gemini': {
			const { createGeminiProvider } = await import('./geminiProvider.js');
			return createGeminiProvider(config);
		}
		case 'huggingface': {
			const { createHuggingFaceProvider } = await import('./huggingfaceProvider.js');
			return createHuggingFaceProvider(config);
		}
		case 'ollama': {
			const { createOllamaProvider } = await import('./ollamaProvider.js');
			return createOllamaProvider(config);
		}
		default:
			throw new RagSdkError(
				RagErrorCode.CONFIG_UNSUPPORTED_PROVIDER,
				`Unsupported LLM provider: "${config.provider}". Supported providers: openai, anthropic, gemini, huggingface, ollama`,
				{
					provider: config.provider,
					details: {
						expected: 'openai | anthropic | gemini | huggingface | ollama',
						received: config.provider,
					},
				},
			);
	}
}

/**
 * Create a provider that supports embedding generation.
 * Throws {@link RagSdkError} with code `CONFIG_INCOMPATIBLE` if the provider
 * does not support embeddings (e.g. Anthropic).
 */
export async function createEmbeddingProvider(config: LLMProviderConfig): Promise<EmbeddingProvider> {
	logger.info('Creating embedding provider', { provider: config.provider, model: config.model });

	if (!supportsCapability(config.provider, 'embeddings')) {
		throw new RagSdkError(
			RagErrorCode.CONFIG_INCOMPATIBLE,
			`Provider "${config.provider}" does not support embeddings. Use one of: openai, gemini, huggingface, ollama`,
			{ provider: config.provider },
		);
	}

	return (await resolveProvider(config)) as EmbeddingProvider;
}

/**
 * Create a provider that supports chat completions.
 * Throws {@link RagSdkError} with code `CONFIG_INCOMPATIBLE` if the provider
 * does not support chat.
 */
export async function createChatProvider(config: LLMProviderConfig): Promise<ChatProvider> {
	logger.info('Creating chat provider', { provider: config.provider, model: config.model });

	if (!supportsCapability(config.provider, 'chat')) {
		throw new RagSdkError(
			RagErrorCode.CONFIG_INCOMPATIBLE,
			`Provider "${config.provider}" does not support chat completions.`,
			{ provider: config.provider },
		);
	}

	return (await resolveProvider(config)) as ChatProvider;
}

/**
 * Create a combined provider that supports both embeddings and chat.
 * @deprecated Use {@link createEmbeddingProvider} or {@link createChatProvider} for narrower typing.
 */
export async function createLLMProvider(config: LLMProviderConfig): Promise<LLMProvider> {
	logger.info('Creating LLM provider', { provider: config.provider, model: config.model });

	if (!supportsCapability(config.provider, 'embeddings')) {
		throw new RagSdkError(
			RagErrorCode.CONFIG_INCOMPATIBLE,
			`Provider "${config.provider}" does not support embeddings. Cannot create a combined LLM provider.`,
			{ provider: config.provider },
		);
	}

	if (!supportsCapability(config.provider, 'chat')) {
		throw new RagSdkError(
			RagErrorCode.CONFIG_INCOMPATIBLE,
			`Provider "${config.provider}" does not support chat. Cannot create a combined LLM provider.`,
			{ provider: config.provider },
		);
	}

	return (await resolveProvider(config)) as LLMProvider;
}
