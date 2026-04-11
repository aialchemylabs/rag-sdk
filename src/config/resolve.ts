import type { RagConfig } from './config.types.js';

/** Map from provider name to the environment variable that holds its API key. */
const PROVIDER_API_KEY_ENV: Record<string, string> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	gemini: 'GEMINI_API_KEY',
	huggingface: 'HUGGINGFACE_API_KEY',
	ollama: '', // no key required
};

function resolveApiKey(provider: string | undefined, explicitKey: string | undefined): string | undefined {
	if (explicitKey) return explicitKey;
	if (!provider) return process.env.OPENAI_API_KEY;
	const envVar = PROVIDER_API_KEY_ENV[provider];
	if (envVar) return process.env[envVar];
	return undefined;
}

/**
 * Resolves config by merging explicit values with environment variable defaults.
 * Explicit config always wins over environment variables.
 */
export function resolveConfigFromEnv(explicitConfig: Partial<RagConfig>): RagConfig {
	const env = process.env;

	return {
		mistral: {
			apiKey: explicitConfig.mistral?.apiKey ?? env.MISTRAL_API_KEY ?? '',
			model: explicitConfig.mistral?.model ?? 'mistral-ocr-latest',
		},

		qdrant: {
			url: explicitConfig.qdrant?.url ?? env.QDRANT_URL ?? '',
			apiKey: explicitConfig.qdrant?.apiKey ?? env.QDRANT_API_KEY,
			collection: explicitConfig.qdrant?.collection ?? env.QDRANT_COLLECTION ?? '',
		},

		embeddings: {
			provider: explicitConfig.embeddings?.provider ?? 'openai',
			model: explicitConfig.embeddings?.model ?? 'text-embedding-3-small',
			apiKey: resolveApiKey(explicitConfig.embeddings?.provider, explicitConfig.embeddings?.apiKey),
			baseUrl: explicitConfig.embeddings?.baseUrl,
			vectorSize: explicitConfig.embeddings?.vectorSize,
			distanceMetric: explicitConfig.embeddings?.distanceMetric,
			versionLabel: explicitConfig.embeddings?.versionLabel,
		},

		chunking: explicitConfig.chunking,
		retrieval: explicitConfig.retrieval,

		answering: explicitConfig.answering
			? {
					...explicitConfig.answering,
					apiKey: resolveApiKey(explicitConfig.answering.provider, explicitConfig.answering.apiKey),
				}
			: undefined,

		telemetry: explicitConfig.telemetry,
		security: explicitConfig.security,
		defaults: explicitConfig.defaults,
		jobs: explicitConfig.jobs,
		maxFileSizeBytes: explicitConfig.maxFileSizeBytes,
		documentStore: explicitConfig.documentStore,
	};
}
