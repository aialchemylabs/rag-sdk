/**
 * Rough token estimation. ~4 characters per token for English text.
 * Used for chunking budget estimation. Not a substitute for provider tokenizers.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
