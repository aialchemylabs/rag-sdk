import { ZodError } from 'zod';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { RagConfig } from './config.types.js';
import { ragConfigSchema } from './schemas.js';

export interface ValidatedConfig {
	mistral: { apiKey: string; model: string };
	qdrant: { url: string; apiKey?: string; collection: string };
	embeddings: {
		provider: string;
		model: string;
		apiKey?: string;
		baseUrl?: string;
		vectorSize?: number;
		distanceMetric: 'cosine' | 'euclid' | 'dot';
		versionLabel?: string;
	};
	chunking: {
		targetTokens: number;
		maxTokens: number;
		overlapTokens: number;
		headingAware: boolean;
		preservePageBoundaries: boolean;
		preserveTables: boolean;
	};
	retrieval: {
		topK: number;
		scoreThreshold: number;
		hybrid?: { enabled: boolean; fusionAlpha: number };
	};
	answering?: {
		provider: string;
		model: string;
		apiKey?: string;
		baseUrl?: string;
		maxTokens: number;
		temperature: number;
		noCitationPolicy: 'warn' | 'refuse' | 'allow';
	};
	telemetry: { enabled: boolean; onEvent?: (event: unknown) => void; onMetric?: (metric: unknown) => void };
	security: { redactPii: boolean; preprocessor?: (content: string) => string | Promise<string> };
	defaults: {
		processingMode: 'text_first' | 'ocr_first' | 'hybrid';
		tenantId?: string;
		domainId?: string;
		tags?: string[];
	};
	jobs: { concurrency: number; timeoutMs: number };
	maxFileSizeBytes: number;
}

export function validateConfig(config: RagConfig): ValidatedConfig {
	try {
		const parsed = ragConfigSchema.parse(config);
		return parsed as ValidatedConfig;
	} catch (err) {
		if (err instanceof ZodError) {
			const issues = err.issues.map((issue) => {
				const path = issue.path.join('.');
				return `${path}: ${issue.message}`;
			});

			throw new RagSdkError(
				RagErrorCode.CONFIG_MISSING_REQUIRED,
				`Configuration validation failed:\n${issues.join('\n')}`,
				{
					details: {
						issues: issues,
					},
				},
			);
		}
		throw err;
	}
}
