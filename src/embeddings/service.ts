import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { createLogger } from '../telemetry/logger.js';
import type { EmbeddingProvider } from '../llmProviders/index.js';
import type { Chunk } from '../chunking/chunk.types.js';

const logger = createLogger('embeddings');

export interface EmbeddingServiceConfig {
	model: string;
	versionLabel: string;
	batchSize?: number;
}

export class EmbeddingService {
	private readonly provider: EmbeddingProvider;
	private readonly model: string;
	private readonly versionLabel: string;
	private readonly batchSize: number;

	constructor(provider: EmbeddingProvider, config: EmbeddingServiceConfig) {
		this.provider = provider;
		this.model = config.model;
		this.versionLabel = config.versionLabel;
		this.batchSize = config.batchSize ?? 100;

		logger.info('EmbeddingService initialized', {
			model: this.model,
			versionLabel: this.versionLabel,
			batchSize: this.batchSize,
		});
	}

	async embedTexts(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		logger.debug('Embedding texts', { count: texts.length, batchSize: this.batchSize });

		const allEmbeddings: number[][] = [];

		for (let i = 0; i < texts.length; i += this.batchSize) {
			const batch = texts.slice(i, i + this.batchSize);
			const batchIndex = Math.floor(i / this.batchSize);

			try {
				const embeddings = await this.provider.generateEmbeddings(batch);
				allEmbeddings.push(...embeddings);

				logger.debug('Batch embedded', {
					batchIndex,
					batchSize: batch.length,
					totalProcessed: allEmbeddings.length,
				});
			} catch (error) {
				if (error instanceof RagSdkError) {
					throw error;
				}
				throw new RagSdkError(
					RagErrorCode.EMBEDDING_PROVIDER_ERROR,
					`Embedding failed at batch ${batchIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`,
					{
						retryable: false,
						cause: error instanceof Error ? error : undefined,
						details: { batchIndex, batchSize: batch.length },
					},
				);
			}
		}

		logger.info('All texts embedded', { count: allEmbeddings.length });

		return allEmbeddings;
	}

	async embedChunks(chunks: Chunk[]): Promise<Chunk[]> {
		if (chunks.length === 0) {
			return [];
		}

		logger.debug('Embedding chunks', { count: chunks.length });

		const texts = chunks.map((chunk) => chunk.content);
		const embeddings = await this.embedTexts(texts);

		const embeddedChunks = chunks.map((chunk, index) => ({
			...chunk,
			embedding: embeddings[index],
			metadata: {
				...chunk.metadata,
				embeddingVersion: this.versionLabel,
			},
		}));

		logger.info('Chunks embedded', { count: embeddedChunks.length, versionLabel: this.versionLabel });

		return embeddedChunks;
	}

	getVersionLabel(): string {
		return this.versionLabel;
	}
}
