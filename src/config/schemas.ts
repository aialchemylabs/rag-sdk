import { z } from 'zod';

const urlSchema = z.string().url('Must be a valid URL');

/** Providers that support embedding generation. */
const embeddingProviders = z.enum(['openai', 'gemini', 'huggingface', 'ollama']);

/** Providers that support chat completions (answering). */
const answeringProviders = z.enum(['openai', 'anthropic', 'gemini', 'huggingface', 'ollama']);

export const mistralConfigSchema = z.object({
	apiKey: z.string().min(1, 'Mistral API key is required'),
	model: z.string().optional().default('mistral-ocr-latest'),
});

export const qdrantConfigSchema = z.object({
	url: urlSchema,
	apiKey: z.string().optional(),
	collection: z.string().min(1, 'Qdrant collection name is required'),
});

export const embeddingConfigSchema = z
	.object({
		provider: embeddingProviders,
		model: z.string().min(1, 'Embedding model is required'),
		apiKey: z.string().optional(),
		baseUrl: z.string().url().optional(),
		vectorSize: z.number().int().positive().optional(),
		distanceMetric: z.enum(['cosine', 'euclid', 'dot']).optional().default('cosine'),
		versionLabel: z.string().optional(),
	})
	.refine((data) => data.provider === 'ollama' || (data.apiKey !== undefined && data.apiKey.length > 0), {
		message: 'apiKey is required for all embedding providers except ollama',
		path: ['apiKey'],
	});

export const chunkingConfigSchema = z.object({
	targetTokens: z.number().int().min(50).max(8192).optional().default(512),
	maxTokens: z.number().int().min(100).max(16384).optional().default(1024),
	overlapTokens: z.number().int().min(0).max(512).optional().default(64),
	headingAware: z.boolean().optional().default(true),
	preservePageBoundaries: z.boolean().optional().default(false),
	preserveTables: z.boolean().optional().default(true),
});

export const retrievalConfigSchema = z.object({
	topK: z.number().int().min(1).max(100).optional().default(10),
	scoreThreshold: z.number().min(0).max(1).optional().default(0.0),
	hybrid: z
		.object({
			enabled: z.boolean(),
			fusionAlpha: z.number().min(0).max(1).optional().default(0.5),
		})
		.optional(),
});

export const answeringConfigSchema = z
	.object({
		provider: answeringProviders,
		model: z.string().min(1, 'Answer model is required'),
		apiKey: z.string().optional(),
		baseUrl: z.string().url().optional(),
		maxTokens: z.number().int().positive().optional().default(2048),
		temperature: z.number().min(0).max(2).optional().default(0.1),
		noCitationPolicy: z.enum(['warn', 'refuse', 'allow']).optional().default('refuse'),
	})
	.refine((data) => data.provider === 'ollama' || (data.apiKey !== undefined && data.apiKey.length > 0), {
		message: 'apiKey is required for all answering providers except ollama',
		path: ['apiKey'],
	});

export const telemetryConfigSchema = z.object({
	enabled: z.boolean().optional().default(true),
	onEvent: z.function().optional(),
	onMetric: z.function().optional(),
});

export const securityConfigSchema = z
	.object({
		redactPii: z.boolean().optional().default(false),
		preprocessor: z.function().optional(),
	})
	.refine((data) => !data.redactPii || data.preprocessor !== undefined, {
		message:
			'security.preprocessor is required when security.redactPii is true. Provide a preprocessor function that implements PII redaction.',
		path: ['preprocessor'],
	});

export const defaultsConfigSchema = z.object({
	processingMode: z.enum(['text_first', 'ocr_first', 'hybrid']).optional().default('hybrid'),
	tenantId: z.string().optional(),
	domainId: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export const jobsConfigSchema = z.object({
	concurrency: z.number().int().min(1).max(50).optional().default(5),
	timeoutMs: z.number().int().min(1000).optional().default(300000),
});

const MAX_FILE_SIZE_DEFAULT = 50 * 1024 * 1024; // 50MB

export const ragConfigSchema = z
	.object({
		mistral: mistralConfigSchema,
		qdrant: qdrantConfigSchema,
		embeddings: embeddingConfigSchema,
		chunking: z.preprocess((val) => val ?? {}, chunkingConfigSchema),
		retrieval: z.preprocess((val) => val ?? {}, retrievalConfigSchema),
		answering: answeringConfigSchema.optional(),
		telemetry: z.preprocess((val) => val ?? {}, telemetryConfigSchema),
		security: z.preprocess((val) => val ?? {}, securityConfigSchema),
		defaults: z.preprocess((val) => val ?? {}, defaultsConfigSchema),
		jobs: z.preprocess((val) => val ?? {}, jobsConfigSchema),
		maxFileSizeBytes: z.number().int().positive().optional().default(MAX_FILE_SIZE_DEFAULT),
	})
	.refine(
		(data) => {
			if (data.chunking?.maxTokens && data.chunking?.targetTokens) {
				return data.chunking.maxTokens >= data.chunking.targetTokens;
			}
			return true;
		},
		{
			message: 'chunking.maxTokens must be >= chunking.targetTokens',
			path: ['chunking', 'maxTokens'],
		},
	);
