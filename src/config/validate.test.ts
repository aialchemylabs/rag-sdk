import { validateConfig } from './validate.js';
import { RagSdkError } from '../errors/ragError.js';
import type { RagConfig } from './config.types.js';

/**
 * Returns a minimal valid config object. Spread and override individual
 * fields to create targeted invalid variations.
 */
function makeMinimalConfig(overrides: Partial<RagConfig> = {}): RagConfig {
	return {
		mistral: { apiKey: 'test-mistral-key' },
		qdrant: { url: 'http://localhost:6333', collection: 'test' },
		embeddings: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-key' },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Existing tests (original 7 retained, using makeMinimalConfig helper)
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
	it('should accept a minimal valid config', () => {
		const result = validateConfig(makeMinimalConfig());

		expect(result.mistral.apiKey).toBe('test-mistral-key');
		expect(result.qdrant.url).toBe('http://localhost:6333');
		expect(result.embeddings.provider).toBe('openai');
	});

	it('should throw RagSdkError when mistral.apiKey is missing', () => {
		const config = makeMinimalConfig({ mistral: { apiKey: '' } });

		expect(() => validateConfig(config)).toThrow(RagSdkError);
	});

	it('should throw RagSdkError when qdrant.url is invalid', () => {
		const config = makeMinimalConfig({
			qdrant: { url: 'not-a-url', collection: 'test' },
		});

		expect(() => validateConfig(config)).toThrow(RagSdkError);
	});

	it('should throw RagSdkError when embeddings.provider is empty', () => {
		const config = makeMinimalConfig({
			embeddings: { provider: '' as 'openai', model: 'text-embedding-3-small', apiKey: 'test-key' },
		});

		expect(() => validateConfig(config)).toThrow(RagSdkError);
	});

	it('should reject anthropic as an embedding provider (invalid enum value)', () => {
		const config = makeMinimalConfig({
			embeddings: { provider: 'anthropic' as 'openai', model: 'some-model', apiKey: 'test-key' },
		});

		expect(() => validateConfig(config)).toThrow(RagSdkError);
	});

	it('should accept ollama as embedding provider without apiKey', () => {
		const config = makeMinimalConfig({
			embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
		});

		const result = validateConfig(config);
		expect(result.embeddings.provider).toBe('ollama');
		expect(result.embeddings.apiKey).toBeUndefined();
	});

	it('should accept gemini as a valid embedding provider', () => {
		const config = makeMinimalConfig({
			embeddings: { provider: 'gemini', model: 'text-embedding-004', apiKey: 'test-gemini-key' },
		});

		const result = validateConfig(config);
		expect(result.embeddings.provider).toBe('gemini');
	});

	// -----------------------------------------------------------------------
	// Chunking config
	// -----------------------------------------------------------------------

	describe('chunking config', () => {
		it('should apply default chunking values when chunking is omitted', () => {
			const result = validateConfig(makeMinimalConfig());

			expect(result.chunking.targetTokens).toBe(512);
			expect(result.chunking.maxTokens).toBe(1024);
			expect(result.chunking.overlapTokens).toBe(64);
			expect(result.chunking.headingAware).toBe(true);
			expect(result.chunking.preservePageBoundaries).toBe(false);
			expect(result.chunking.preserveTables).toBe(true);
		});

		// targetTokens
		it('should reject targetTokens below minimum (50)', () => {
			const config = makeMinimalConfig({ chunking: { targetTokens: 49 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject targetTokens above maximum (8192)', () => {
			const config = makeMinimalConfig({ chunking: { targetTokens: 8193 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept targetTokens at minimum boundary (50)', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { targetTokens: 50 } }));
			expect(result.chunking.targetTokens).toBe(50);
		});

		it('should accept targetTokens at maximum boundary (8192)', () => {
			// maxTokens must be >= targetTokens, so set both
			const result = validateConfig(makeMinimalConfig({ chunking: { targetTokens: 8192, maxTokens: 8192 } }));
			expect(result.chunking.targetTokens).toBe(8192);
		});

		// maxTokens
		it('should reject maxTokens below minimum (100)', () => {
			const config = makeMinimalConfig({ chunking: { maxTokens: 99 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject maxTokens above maximum (16384)', () => {
			const config = makeMinimalConfig({ chunking: { maxTokens: 16385 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept maxTokens at minimum boundary (100)', () => {
			// targetTokens must be <= maxTokens, so set both
			const result = validateConfig(makeMinimalConfig({ chunking: { targetTokens: 50, maxTokens: 100 } }));
			expect(result.chunking.maxTokens).toBe(100);
		});

		it('should accept maxTokens at maximum boundary (16384)', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { maxTokens: 16384 } }));
			expect(result.chunking.maxTokens).toBe(16384);
		});

		// overlapTokens
		it('should reject overlapTokens below minimum (0)', () => {
			const config = makeMinimalConfig({ chunking: { overlapTokens: -1 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject overlapTokens above maximum (512)', () => {
			const config = makeMinimalConfig({ chunking: { overlapTokens: 513 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept overlapTokens at minimum boundary (0)', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { overlapTokens: 0 } }));
			expect(result.chunking.overlapTokens).toBe(0);
		});

		it('should accept overlapTokens at maximum boundary (512)', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { overlapTokens: 512 } }));
			expect(result.chunking.overlapTokens).toBe(512);
		});

		// Boolean fields
		it('should accept headingAware as a boolean', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { headingAware: false } }));
			expect(result.chunking.headingAware).toBe(false);
		});

		it('should accept preservePageBoundaries as a boolean', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { preservePageBoundaries: true } }));
			expect(result.chunking.preservePageBoundaries).toBe(true);
		});

		it('should accept preserveTables as a boolean', () => {
			const result = validateConfig(makeMinimalConfig({ chunking: { preserveTables: false } }));
			expect(result.chunking.preserveTables).toBe(false);
		});

		// Cross-field: maxTokens >= targetTokens
		it('should reject maxTokens less than targetTokens', () => {
			const config = makeMinimalConfig({
				chunking: { targetTokens: 500, maxTokens: 200 },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept maxTokens equal to targetTokens', () => {
			const result = validateConfig(
				makeMinimalConfig({
					chunking: { targetTokens: 500, maxTokens: 500 },
				}),
			);
			expect(result.chunking.targetTokens).toBe(500);
			expect(result.chunking.maxTokens).toBe(500);
		});
	});

	// -----------------------------------------------------------------------
	// Retrieval config
	// -----------------------------------------------------------------------

	describe('retrieval config', () => {
		it('should apply default retrieval values when retrieval is omitted', () => {
			const result = validateConfig(makeMinimalConfig());

			expect(result.retrieval.topK).toBe(10);
			expect(result.retrieval.scoreThreshold).toBe(0.0);
			expect(result.retrieval.hybrid).toBeUndefined();
		});

		// topK
		it('should reject topK below minimum (1)', () => {
			const config = makeMinimalConfig({ retrieval: { topK: 0 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject topK above maximum (100)', () => {
			const config = makeMinimalConfig({ retrieval: { topK: 101 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept topK at minimum boundary (1)', () => {
			const result = validateConfig(makeMinimalConfig({ retrieval: { topK: 1 } }));
			expect(result.retrieval.topK).toBe(1);
		});

		it('should accept topK at maximum boundary (100)', () => {
			const result = validateConfig(makeMinimalConfig({ retrieval: { topK: 100 } }));
			expect(result.retrieval.topK).toBe(100);
		});

		// scoreThreshold
		it('should reject scoreThreshold below minimum (0)', () => {
			const config = makeMinimalConfig({ retrieval: { scoreThreshold: -0.1 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject scoreThreshold above maximum (1)', () => {
			const config = makeMinimalConfig({ retrieval: { scoreThreshold: 1.1 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept scoreThreshold at minimum boundary (0)', () => {
			const result = validateConfig(makeMinimalConfig({ retrieval: { scoreThreshold: 0 } }));
			expect(result.retrieval.scoreThreshold).toBe(0);
		});

		it('should accept scoreThreshold at maximum boundary (1)', () => {
			const result = validateConfig(makeMinimalConfig({ retrieval: { scoreThreshold: 1 } }));
			expect(result.retrieval.scoreThreshold).toBe(1);
		});

		// Hybrid sub-config
		it('should accept hybrid config with enabled boolean', () => {
			const result = validateConfig(
				makeMinimalConfig({
					retrieval: { hybrid: { enabled: true } },
				}),
			);
			expect(result.retrieval.hybrid?.enabled).toBe(true);
			expect(result.retrieval.hybrid?.fusionAlpha).toBe(0.5);
		});

		it('should accept hybrid fusionAlpha at minimum boundary (0)', () => {
			const result = validateConfig(
				makeMinimalConfig({
					retrieval: { hybrid: { enabled: true, fusionAlpha: 0 } },
				}),
			);
			expect(result.retrieval.hybrid?.fusionAlpha).toBe(0);
		});

		it('should accept hybrid fusionAlpha at maximum boundary (1)', () => {
			const result = validateConfig(
				makeMinimalConfig({
					retrieval: { hybrid: { enabled: true, fusionAlpha: 1 } },
				}),
			);
			expect(result.retrieval.hybrid?.fusionAlpha).toBe(1);
		});

		it('should reject hybrid fusionAlpha above maximum (1)', () => {
			const config = makeMinimalConfig({
				retrieval: { hybrid: { enabled: true, fusionAlpha: 1.1 } },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject hybrid fusionAlpha below minimum (0)', () => {
			const config = makeMinimalConfig({
				retrieval: { hybrid: { enabled: true, fusionAlpha: -0.1 } },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});
	});

	// -----------------------------------------------------------------------
	// Answering config
	// -----------------------------------------------------------------------

	describe('answering config', () => {
		const validAnswering = {
			provider: 'openai' as const,
			model: 'gpt-4o',
			apiKey: 'test-answer-key',
		};

		it('should accept a valid answering config', () => {
			const result = validateConfig(makeMinimalConfig({ answering: validAnswering }));
			expect(result.answering?.provider).toBe('openai');
			expect(result.answering?.model).toBe('gpt-4o');
		});

		// Provider enum
		it('should accept anthropic as an answering provider', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'test-key' },
				}),
			);
			expect(result.answering?.provider).toBe('anthropic');
		});

		it('should accept gemini as an answering provider', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { provider: 'gemini', model: 'gemini-pro', apiKey: 'test-key' },
				}),
			);
			expect(result.answering?.provider).toBe('gemini');
		});

		it('should accept huggingface as an answering provider', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { provider: 'huggingface', model: 'mistral-7b', apiKey: 'test-key' },
				}),
			);
			expect(result.answering?.provider).toBe('huggingface');
		});

		it('should reject an invalid answering provider', () => {
			const config = makeMinimalConfig({
				answering: { provider: 'invalid-provider' as 'openai', model: 'some-model', apiKey: 'key' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		// apiKey required for non-ollama providers
		it('should require apiKey for non-ollama answering providers', () => {
			const config = makeMinimalConfig({
				answering: { provider: 'openai', model: 'gpt-4o' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept ollama as answering provider without apiKey', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { provider: 'ollama', model: 'llama3' },
				}),
			);
			expect(result.answering?.provider).toBe('ollama');
			expect(result.answering?.apiKey).toBeUndefined();
		});

		// Temperature
		it('should reject temperature below minimum (0)', () => {
			const config = makeMinimalConfig({
				answering: { ...validAnswering, temperature: -0.1 },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject temperature above maximum (2)', () => {
			const config = makeMinimalConfig({
				answering: { ...validAnswering, temperature: 2.1 },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept temperature at minimum boundary (0)', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, temperature: 0 },
				}),
			);
			expect(result.answering?.temperature).toBe(0);
		});

		it('should accept temperature at maximum boundary (2)', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, temperature: 2 },
				}),
			);
			expect(result.answering?.temperature).toBe(2);
		});

		it('should apply default temperature (0.1) when omitted', () => {
			const result = validateConfig(makeMinimalConfig({ answering: validAnswering }));
			expect(result.answering?.temperature).toBe(0.1);
		});

		// maxTokens
		it('should accept a positive maxTokens value', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, maxTokens: 4096 },
				}),
			);
			expect(result.answering?.maxTokens).toBe(4096);
		});

		it('should reject maxTokens of zero', () => {
			const config = makeMinimalConfig({
				answering: { ...validAnswering, maxTokens: 0 },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject negative maxTokens', () => {
			const config = makeMinimalConfig({
				answering: { ...validAnswering, maxTokens: -100 },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should apply default maxTokens (2048) when omitted', () => {
			const result = validateConfig(makeMinimalConfig({ answering: validAnswering }));
			expect(result.answering?.maxTokens).toBe(2048);
		});

		// noCitationPolicy
		it('should accept refuse as noCitationPolicy', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, noCitationPolicy: 'refuse' },
				}),
			);
			expect(result.answering?.noCitationPolicy).toBe('refuse');
		});

		it('should accept warn as noCitationPolicy', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, noCitationPolicy: 'warn' },
				}),
			);
			expect(result.answering?.noCitationPolicy).toBe('warn');
		});

		it('should accept allow as noCitationPolicy', () => {
			const result = validateConfig(
				makeMinimalConfig({
					answering: { ...validAnswering, noCitationPolicy: 'allow' },
				}),
			);
			expect(result.answering?.noCitationPolicy).toBe('allow');
		});

		it('should reject an invalid noCitationPolicy value', () => {
			const config = makeMinimalConfig({
				answering: { ...validAnswering, noCitationPolicy: 'ignore' as 'refuse' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should apply default noCitationPolicy (refuse) when omitted', () => {
			const result = validateConfig(makeMinimalConfig({ answering: validAnswering }));
			expect(result.answering?.noCitationPolicy).toBe('refuse');
		});
	});

	// -----------------------------------------------------------------------
	// Jobs config
	// -----------------------------------------------------------------------

	describe('jobs config', () => {
		it('should apply default jobs values when jobs is omitted', () => {
			const result = validateConfig(makeMinimalConfig());

			expect(result.jobs.concurrency).toBe(5);
			expect(result.jobs.timeoutMs).toBe(300000);
		});

		// concurrency
		it('should reject concurrency below minimum (1)', () => {
			const config = makeMinimalConfig({ jobs: { concurrency: 0 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject concurrency above maximum (50)', () => {
			const config = makeMinimalConfig({ jobs: { concurrency: 51 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept concurrency at minimum boundary (1)', () => {
			const result = validateConfig(makeMinimalConfig({ jobs: { concurrency: 1 } }));
			expect(result.jobs.concurrency).toBe(1);
		});

		it('should accept concurrency at maximum boundary (50)', () => {
			const result = validateConfig(makeMinimalConfig({ jobs: { concurrency: 50 } }));
			expect(result.jobs.concurrency).toBe(50);
		});

		// timeoutMs
		it('should reject timeoutMs below minimum (1000)', () => {
			const config = makeMinimalConfig({ jobs: { timeoutMs: 999 } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept timeoutMs at minimum boundary (1000)', () => {
			const result = validateConfig(makeMinimalConfig({ jobs: { timeoutMs: 1000 } }));
			expect(result.jobs.timeoutMs).toBe(1000);
		});

		it('should accept a large timeoutMs value', () => {
			const result = validateConfig(makeMinimalConfig({ jobs: { timeoutMs: 600000 } }));
			expect(result.jobs.timeoutMs).toBe(600000);
		});
	});

	// -----------------------------------------------------------------------
	// Max file size
	// -----------------------------------------------------------------------

	describe('maxFileSizeBytes', () => {
		it('should apply default maxFileSizeBytes (50MB) when omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.maxFileSizeBytes).toBe(50 * 1024 * 1024);
		});

		it('should accept a custom maxFileSizeBytes value', () => {
			const result = validateConfig(makeMinimalConfig({ maxFileSizeBytes: 100 * 1024 * 1024 }));
			expect(result.maxFileSizeBytes).toBe(100 * 1024 * 1024);
		});

		it('should reject negative maxFileSizeBytes', () => {
			const config = makeMinimalConfig({ maxFileSizeBytes: -1 });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should reject zero maxFileSizeBytes', () => {
			const config = makeMinimalConfig({ maxFileSizeBytes: 0 });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});
	});

	// -----------------------------------------------------------------------
	// Security config
	// -----------------------------------------------------------------------

	describe('security config', () => {
		it('should apply default security values when security is omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.security.redactPii).toBe(false);
			expect(result.security.preprocessor).toBeUndefined();
		});

		it('should accept redactPii as false without preprocessor', () => {
			const result = validateConfig(makeMinimalConfig({ security: { redactPii: false } }));
			expect(result.security.redactPii).toBe(false);
		});

		it('should reject redactPii as true without preprocessor', () => {
			const config = makeMinimalConfig({ security: { redactPii: true } });
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept redactPii as true with preprocessor function', () => {
			const preprocessor = (content: string) => content.replace(/SSN/g, '[REDACTED]');
			const result = validateConfig(makeMinimalConfig({ security: { redactPii: true, preprocessor } }));
			expect(result.security.redactPii).toBe(true);
			expect(result.security.preprocessor).toBeDefined();
		});

		it('should accept preprocessor function without redactPii', () => {
			const preprocessor = (content: string) => content;
			const result = validateConfig(makeMinimalConfig({ security: { preprocessor } }));
			expect(result.security.preprocessor).toBeDefined();
		});
	});

	// -----------------------------------------------------------------------
	// Defaults config
	// -----------------------------------------------------------------------

	describe('defaults config', () => {
		it('should apply default processingMode (hybrid) when defaults is omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.defaults.processingMode).toBe('hybrid');
		});

		it('should accept text_first as processingMode', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { processingMode: 'text_first' } }));
			expect(result.defaults.processingMode).toBe('text_first');
		});

		it('should accept ocr_first as processingMode', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { processingMode: 'ocr_first' } }));
			expect(result.defaults.processingMode).toBe('ocr_first');
		});

		it('should accept hybrid as processingMode', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { processingMode: 'hybrid' } }));
			expect(result.defaults.processingMode).toBe('hybrid');
		});

		it('should reject an invalid processingMode', () => {
			const config = makeMinimalConfig({
				defaults: { processingMode: 'invalid_mode' as 'hybrid' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept tenantId as a string', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { tenantId: 'tenant-123' } }));
			expect(result.defaults.tenantId).toBe('tenant-123');
		});

		it('should accept domainId as a string', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { domainId: 'domain-abc' } }));
			expect(result.defaults.domainId).toBe('domain-abc');
		});

		it('should accept tags as an array of strings', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { tags: ['finance', 'internal'] } }));
			expect(result.defaults.tags).toEqual(['finance', 'internal']);
		});

		it('should accept empty tags array', () => {
			const result = validateConfig(makeMinimalConfig({ defaults: { tags: [] } }));
			expect(result.defaults.tags).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// Embedding config (additional coverage)
	// -----------------------------------------------------------------------

	describe('embedding config (extended)', () => {
		it('should require apiKey for non-ollama embedding providers', () => {
			const config = makeMinimalConfig({
				embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept huggingface as an embedding provider', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: { provider: 'huggingface', model: 'hf-embed', apiKey: 'hf-key' },
				}),
			);
			expect(result.embeddings.provider).toBe('huggingface');
		});

		it('should apply default distanceMetric (cosine) when omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.embeddings.distanceMetric).toBe('cosine');
		});

		it('should accept euclid as distanceMetric', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'key',
						distanceMetric: 'euclid',
					},
				}),
			);
			expect(result.embeddings.distanceMetric).toBe('euclid');
		});

		it('should accept dot as distanceMetric', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'key',
						distanceMetric: 'dot',
					},
				}),
			);
			expect(result.embeddings.distanceMetric).toBe('dot');
		});

		it('should reject an invalid distanceMetric', () => {
			const config = makeMinimalConfig({
				embeddings: {
					provider: 'openai',
					model: 'text-embedding-3-small',
					apiKey: 'key',
					distanceMetric: 'manhattan' as 'cosine',
				},
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept a custom baseUrl', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'key',
						baseUrl: 'https://custom.api.example.com',
					},
				}),
			);
			expect(result.embeddings.baseUrl).toBe('https://custom.api.example.com');
		});

		it('should reject an invalid baseUrl', () => {
			const config = makeMinimalConfig({
				embeddings: {
					provider: 'openai',
					model: 'text-embedding-3-small',
					apiKey: 'key',
					baseUrl: 'not-a-url',
				},
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept a positive vectorSize', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'key',
						vectorSize: 1536,
					},
				}),
			);
			expect(result.embeddings.vectorSize).toBe(1536);
		});

		it('should accept a versionLabel string', () => {
			const result = validateConfig(
				makeMinimalConfig({
					embeddings: {
						provider: 'openai',
						model: 'text-embedding-3-small',
						apiKey: 'key',
						versionLabel: 'v2-2024',
					},
				}),
			);
			expect(result.embeddings.versionLabel).toBe('v2-2024');
		});
	});

	// -----------------------------------------------------------------------
	// Qdrant config (additional coverage)
	// -----------------------------------------------------------------------

	describe('qdrant config (extended)', () => {
		it('should reject empty collection name', () => {
			const config = makeMinimalConfig({
				qdrant: { url: 'http://localhost:6333', collection: '' },
			});
			expect(() => validateConfig(config)).toThrow(RagSdkError);
		});

		it('should accept optional qdrant apiKey', () => {
			const result = validateConfig(
				makeMinimalConfig({
					qdrant: { url: 'http://localhost:6333', collection: 'test', apiKey: 'qdrant-key' },
				}),
			);
			expect(result.qdrant.apiKey).toBe('qdrant-key');
		});
	});

	// -----------------------------------------------------------------------
	// Mistral config (additional coverage)
	// -----------------------------------------------------------------------

	describe('mistral config (extended)', () => {
		it('should apply default mistral model when omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.mistral.model).toBe('mistral-ocr-latest');
		});

		it('should accept a custom mistral model', () => {
			const result = validateConfig(makeMinimalConfig({ mistral: { apiKey: 'key', model: 'mistral-custom' } }));
			expect(result.mistral.model).toBe('mistral-custom');
		});
	});

	// -----------------------------------------------------------------------
	// Telemetry config
	// -----------------------------------------------------------------------

	describe('telemetry config', () => {
		it('should apply default telemetry enabled (true) when omitted', () => {
			const result = validateConfig(makeMinimalConfig());
			expect(result.telemetry.enabled).toBe(true);
		});

		it('should accept telemetry enabled as false', () => {
			const result = validateConfig(makeMinimalConfig({ telemetry: { enabled: false } }));
			expect(result.telemetry.enabled).toBe(false);
		});

		it('should accept onEvent and onMetric function hooks', () => {
			const onEvent = (_event: unknown) => {};
			const onMetric = (_metric: unknown) => {};
			const result = validateConfig(makeMinimalConfig({ telemetry: { enabled: true, onEvent, onMetric } }));
			expect(result.telemetry.onEvent).toBeDefined();
			expect(result.telemetry.onMetric).toBeDefined();
		});
	});
});
