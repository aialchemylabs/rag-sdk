/** Provider that can generate vector embeddings from text. */
export interface EmbeddingProvider {
	generateEmbeddings(texts: string[]): Promise<number[][]>;
}

/** Provider that can generate chat completions. */
export interface ChatProvider {
	generateChatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
	getTokenCount(text: string): number;
}

/** Combined provider implementing both embedding and chat capabilities. */
export interface LLMProvider extends EmbeddingProvider, ChatProvider {}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatOptions {
	maxTokens?: number;
	temperature?: number;
	topP?: number;
}

export interface ChatResponse {
	content: string;
	finishReason: string;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface LLMProviderConfig {
	provider: string;
	model: string;
	apiKey?: string;
	baseUrl?: string;
	vectorSize?: number;
}
