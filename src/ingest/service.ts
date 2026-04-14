import type { ValidatedConfig } from '../config/validate.js';
import type { DocumentStore } from '../documents/documentStore.types.js';
import type { EmbeddingService } from '../embeddings/service.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { JobManager } from '../jobs/jobManager.js';
import type { OcrAdapter } from '../ocr/mistralAdapter.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import { createLogger } from '../telemetry/logger.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { IngestInput, IngestOptions, IngestResult } from './ingest.types.js';
import { generateId } from '../utils/id.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';
import type { Chunk, ChunkingResult } from '../chunking/chunk.types.js';
import { chunkDocument } from '../chunking/chunker.js';
import { normalizeOcrResult } from '../normalize/normalizer.js';
import { detectInputType, validateFileSize } from './inputAdapter.js';

const logger = createLogger('ingest:service');

export class IngestService {
	constructor(
		private readonly config: ValidatedConfig,
		private readonly ocr: OcrAdapter,
		private readonly embeddings: EmbeddingService,
		private readonly vector: QdrantAdapter,
		private readonly telemetry: TelemetryEmitter,
		private readonly jobManager?: JobManager,
		private readonly documentStore?: DocumentStore,
	) {}

	async file(filePath: string, options?: IngestOptions): Promise<IngestResult> {
		return this.ingest({ type: 'file', filePath }, options);
	}

	async buffer(buffer: Buffer, fileName: string, options?: IngestOptions): Promise<IngestResult> {
		return this.ingest({ type: 'buffer', buffer, fileName }, options);
	}

	async url(url: string, options?: IngestOptions): Promise<IngestResult> {
		return this.ingest({ type: 'url', url }, options);
	}

	async text(text: string, options?: IngestOptions): Promise<IngestResult> {
		return this.ingest({ type: 'text', text }, options);
	}

	private async ingest(input: IngestInput, options?: IngestOptions): Promise<IngestResult> {
		const { mimeType, fileName } = detectInputType(input);
		validateFileSize(input, this.config.maxFileSizeBytes);

		const tenantId = options?.security?.tenantId ?? this.config.defaults.tenantId;
		if (!tenantId) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_MISSING_TENANT,
				'tenantId is required. Provide it via options.security.tenantId or set defaults.tenantId in config.',
			);
		}
		const domainId = options?.domainId ?? this.config.defaults.domainId;
		const tags = options?.tags ?? this.config.defaults.tags;
		const processingMode = options?.processingMode ?? this.config.defaults.processingMode;

		if (options?.async && this.jobManager) {
			return this.ingestAsync(input, fileName, mimeType, tenantId, domainId, tags, processingMode, options);
		}

		return this.ingestSync(input, fileName, mimeType, tenantId, domainId, tags, processingMode, options);
	}

	private async ingestSync(
		input: IngestInput,
		fileName: string,
		mimeType: string,
		tenantId: string,
		domainId: string | undefined,
		tags: string[] | undefined,
		processingMode: string,
		options?: IngestOptions,
		existingDocumentId?: string,
	): Promise<IngestResult> {
		const startTime = Date.now();
		const providedDocumentId = options?.documentId;
		if (providedDocumentId !== undefined) {
			this.validateExternalDocumentId(providedDocumentId);
		}
		const documentId = providedDocumentId ?? existingDocumentId ?? generateId('doc');
		const telemetry = this.telemetry.withOverride(options?.telemetry?.onEvent);
		const warnings: string[] = [];

		telemetry.emit('ingestion_started', {
			documentId,
			tenantId,
			metadata: { fileName, mimeType, externalDocumentId: providedDocumentId !== undefined },
		});

		try {
			// Step 1: OCR / Extract
			const normalizedDocument = await this.extractDocument(
				input,
				fileName,
				mimeType,
				documentId,
				processingMode,
				telemetry,
			);

			if (normalizedDocument.warnings.length > 0) {
				for (const w of normalizedDocument.warnings) {
					warnings.push(`${w.code}: ${w.message}`);
				}
			}

			// Step 2: Preprocess content (required when redactPii is enabled)
			if (this.config.security.redactPii && !this.config.security.preprocessor) {
				throw new RagSdkError(
					RagErrorCode.CONFIG_MISSING_REQUIRED,
					'security.redactPii is enabled but no preprocessor is configured. Provide a security.preprocessor function.',
				);
			}
			if (this.config.security.preprocessor) {
				for (const page of normalizedDocument.pages) {
					page.markdown = await this.config.security.preprocessor(page.markdown);
					page.text = await this.config.security.preprocessor(page.text);
				}
			}

			// Step 3: Chunk
			const chunkingStart = Date.now();
			telemetry.emit('chunking_started', { documentId, tenantId });
			let chunkingResult: ChunkingResult;
			try {
				chunkingResult = chunkDocument(normalizedDocument, this.config.chunking, {
					embeddingVersion: this.embeddings.getVersionLabel(),
					processingMode,
					tenantId,
					domainId,
					tags,
					mimeType,
					customMetadata: options?.metadata,
				});
				telemetry.emit('chunking_completed', {
					documentId,
					tenantId,
					durationMs: Date.now() - chunkingStart,
					metadata: {
						chunkCount: chunkingResult.chunks.length,
						totalTokens: chunkingResult.totalTokens,
					},
				});
			} catch (err) {
				telemetry.emit('chunking_failed', {
					documentId,
					tenantId,
					durationMs: Date.now() - chunkingStart,
					error: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}

			// Step 4: Embed
			const embeddingsStart = Date.now();
			telemetry.emit('embeddings_started', {
				documentId,
				tenantId,
				metadata: { chunkCount: chunkingResult.chunks.length },
			});
			let embeddedChunks: Chunk[];
			try {
				embeddedChunks = await this.embeddings.embedChunks(chunkingResult.chunks);
				telemetry.emit('embeddings_completed', {
					documentId,
					tenantId,
					durationMs: Date.now() - embeddingsStart,
					metadata: {
						chunkCount: embeddedChunks.length,
						dimensions: embeddedChunks[0]?.embedding?.length,
					},
				});
			} catch (err) {
				telemetry.emit('embeddings_failed', {
					documentId,
					tenantId,
					durationMs: Date.now() - embeddingsStart,
					error: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}

			// Step 4b: Validate embedding dimensions against configured vectorSize.
			// When vectorSize is explicitly configured, a mismatch indicates either a
			// provider misconfiguration or a silently-corrupted response (e.g. the
			// OpenAI v6 base64/float decoding bug against LiteLLM backends). Fail loud
			// BEFORE seeding Qdrant with garbage vectors.
			const configuredVectorSize = this.config.embeddings.vectorSize;
			const actualDimensions = embeddedChunks[0]?.embedding?.length;
			if (configuredVectorSize != null && actualDimensions != null && actualDimensions !== configuredVectorSize) {
				throw new RagSdkError(
					RagErrorCode.EMBEDDING_PROVIDER_ERROR,
					`Embedding dimension mismatch: embeddings.vectorSize is configured as ${configuredVectorSize} but the provider returned vectors of length ${actualDimensions}. ` +
						'This usually indicates a provider misconfiguration or a corrupted response from the embedding backend. ' +
						`Verify the model, base URL, and encoding_format settings for provider '${this.config.embeddings.provider}'.`,
					{
						provider: this.config.embeddings.provider,
						retryable: false,
					},
				);
			}
			if (configuredVectorSize == null && actualDimensions != null) {
				// Fallback path — dimensions inferred from the first embedding. This is
				// how the SDK used to seed collections. It hides provider corruption, so
				// we log a warning advising callers to set embeddings.vectorSize.
				logger.warn(
					'embeddings.vectorSize is not configured — collection dimension will be inferred from the first embedding. Set embeddings.vectorSize to catch provider corruption early.',
					{ inferredDimensions: actualDimensions },
				);
			}

			// Step 5: Ensure collection and upsert
			const upsertStart = Date.now();
			telemetry.emit('qdrant_upsert_started', {
				documentId,
				tenantId,
				metadata: { chunkCount: embeddedChunks.length },
			});
			let upserted: number;
			try {
				await this.vector.ensureCollection(
					tenantId,
					configuredVectorSize ?? actualDimensions ?? 1536,
					this.config.embeddings.distanceMetric,
				);

				const upsertResult = await this.vector.upsertChunks(embeddedChunks, tenantId);
				upserted = upsertResult.upserted;
				telemetry.emit('qdrant_upsert_completed', {
					documentId,
					tenantId,
					durationMs: Date.now() - upsertStart,
					metadata: { upserted },
				});
			} catch (err) {
				telemetry.emit('qdrant_upsert_failed', {
					documentId,
					tenantId,
					durationMs: Date.now() - upsertStart,
					error: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}

			// Persist document record in the document store
			if (this.documentStore) {
				const now = new Date().toISOString();
				await this.documentStore.put({
					documentId,
					sourceName: fileName,
					mimeType,
					pageCount: normalizedDocument.pageCount,
					chunkCount: upserted,
					totalTokens: chunkingResult.chunks.reduce((sum, c) => sum + c.tokenCount, 0),
					tenantId,
					domainId,
					tags,
					embeddingVersion: this.embeddings.getVersionLabel(),
					processingMode,
					createdAt: now,
					updatedAt: now,
					metadata: options?.metadata,
				});
			}

			const processingTimeMs = Date.now() - startTime;

			telemetry.emit('ingestion_completed', {
				documentId,
				tenantId,
				durationMs: processingTimeMs,
				metadata: { chunksIndexed: upserted, fileName },
			});

			return {
				documentId,
				sourceName: fileName,
				status: warnings.length > 0 ? 'partial' : 'completed',
				normalizedDocument,
				chunkingResult,
				chunksIndexed: upserted,
				processingTimeMs,
				warnings,
			};
		} catch (err) {
			telemetry.emit('ingestion_failed', {
				documentId,
				tenantId,
				durationMs: Date.now() - startTime,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	private validateExternalDocumentId(documentId: string): void {
		if (typeof documentId !== 'string' || documentId.length === 0) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_INVALID_INPUT,
				'options.documentId must be a non-empty string when provided.',
			);
		}
		if (documentId.length > 256) {
			throw new RagSdkError(
				RagErrorCode.VALIDATION_INVALID_INPUT,
				`options.documentId must be at most 256 characters (got ${documentId.length}).`,
			);
		}
	}

	private async ingestAsync(
		input: IngestInput,
		fileName: string,
		mimeType: string,
		tenantId: string,
		domainId: string | undefined,
		tags: string[] | undefined,
		processingMode: string,
		options?: IngestOptions,
	): Promise<IngestResult> {
		if (options?.documentId !== undefined) {
			this.validateExternalDocumentId(options.documentId);
		}
		const documentId = options?.documentId ?? generateId('doc');

		const manager = this.jobManager as JobManager;
		const job = await manager.createJob(documentId, fileName, tenantId, async (_job, signal) => {
			if (signal.aborted) throw new Error('Job cancelled');

			const result = await this.ingestSync(
				input,
				fileName,
				mimeType,
				tenantId,
				domainId,
				tags,
				processingMode,
				options,
				documentId,
			);
			return result;
		});

		return {
			documentId,
			sourceName: fileName,
			status: 'pending',
			chunksIndexed: 0,
			processingTimeMs: 0,
			warnings: [],
			jobId: job.jobId,
		};
	}

	private async extractDocument(
		input: IngestInput,
		fileName: string,
		mimeType: string,
		documentId: string,
		processingMode: string,
		telemetry: TelemetryEmitter,
	): Promise<NormalizedDocument> {
		if (input.type === 'text') {
			return this.createTextDocument(input.text, fileName, documentId);
		}

		// text_first: for born-digital docs prefer embedded text extraction.
		// Since Mistral OCR is the only V1 extraction engine it already extracts
		// embedded text when available.  If a scanned-only doc is encountered the
		// mode is logged so callers can decide to re-ingest with ocr_first.
		// ocr_first: always run full OCR (default Mistral behaviour).
		// hybrid: Mistral OCR combines both strategies automatically.

		const ocrStartTime = Date.now();
		telemetry.emit('ocr_started', {
			documentId,
			metadata: { fileName, processingMode },
		});
		try {
			let rawResult: Awaited<ReturnType<typeof this.ocr.processFile>>;

			switch (input.type) {
				case 'file':
					rawResult = await this.ocr.processFile(input.filePath, this.config.mistral.model);
					break;
				case 'buffer':
					rawResult = await this.ocr.processBuffer(input.buffer, fileName, this.config.mistral.model);
					break;
				case 'url':
					rawResult = await this.ocr.processUrl(input.url, this.config.mistral.model);
					break;
			}

			const ocrDurationMs = Date.now() - ocrStartTime;
			telemetry.emit('ocr_completed', {
				documentId,
				durationMs: ocrDurationMs,
				metadata: { fileName, pageCount: rawResult.pages.length, processingMode },
			});

			const normalized = normalizeOcrResult(rawResult, {
				documentId,
				sourceName: fileName,
				mimeType,
				model: this.config.mistral.model,
				processingTimeMs: ocrDurationMs,
			});

			// text_first heuristic: if the majority of pages have very short
			// markdown (<50 chars), the doc was likely scanned-only and embedded
			// text extraction yielded little.  Surface a warning so downstream
			// callers know to try ocr_first instead.
			if (processingMode === 'text_first' && normalized.pages.length > 0) {
				const lowContentPages = normalized.pages.filter((p) => p.markdown.length < 50).length;
				if (lowContentPages > normalized.pages.length / 2) {
					normalized.warnings.push({
						code: 'TEXT_FIRST_LOW_CONTENT',
						message: `${lowContentPages}/${normalized.pages.length} pages had minimal embedded text. Consider re-ingesting with ocr_first.`,
						severity: 'medium',
					});
				}
			}

			return normalized;
		} catch (err) {
			telemetry.emit('ocr_failed', {
				documentId,
				durationMs: Date.now() - ocrStartTime,
				error: err instanceof Error ? err.message : String(err),
			});

			if (err instanceof RagSdkError) throw err;

			throw new RagSdkError(
				RagErrorCode.OCR_TOTAL_FAILURE,
				`OCR failed for ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
				{
					retryable: true,
					provider: 'mistral',
					cause: err instanceof Error ? err : undefined,
				},
			);
		}
	}

	private createTextDocument(text: string, fileName: string, documentId: string): NormalizedDocument {
		return {
			documentId,
			sourceName: fileName,
			mimeType: 'text/plain',
			pageCount: 1,
			pages: [
				{
					pageIndex: 0,
					markdown: text,
					text,
					characterCount: text.length,
					hasImages: false,
					hasTablesOnPage: false,
					warnings: [],
				},
			],
			tables: [],
			links: [],
			warnings: [],
			providerMetadata: {
				provider: 'mistral',
				model: 'text-input',
				processingTimeMs: 0,
				rawPageCount: 1,
			},
			totalCharacters: text.length,
			createdAt: new Date().toISOString(),
		};
	}
}
