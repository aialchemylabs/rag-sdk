/** Capability that an LLM provider may support. */
export type ProviderCapability = 'embeddings' | 'chat';

/** Static registry of which capabilities each supported provider offers. */
export const PROVIDER_CAPABILITIES: Record<string, readonly ProviderCapability[]> = {
	openai: ['embeddings', 'chat'],
	anthropic: ['chat'],
	gemini: ['embeddings', 'chat'],
	huggingface: ['embeddings', 'chat'],
	ollama: ['embeddings', 'chat'],
} as const;

/** All supported provider names. */
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_CAPABILITIES);

/** Check whether a provider supports a specific capability. */
export function supportsCapability(provider: string, capability: ProviderCapability): boolean {
	const caps = PROVIDER_CAPABILITIES[provider];
	return caps?.includes(capability) ?? false;
}
