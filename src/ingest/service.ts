import type { ValidatedConfig } from '../config/validate.js';
import type { DocumentStore } from '../documents/documentStore.types.js';
import type { EmbeddingService } from '../embeddings/service.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { JobManager } from '../jobs/jobManager.js';
import type { OcrAdapter } from '../ocr/mistralAdapter.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import type { NormalizedDocument } from '../normalize/document.types.js';
import type { IngestInput, IngestOptions, IngestResult } from './ingest.types.js';
import { generateId } from '../utils/id.js';
import type { QdrantAdapter } from '../vector/qdrantAdapter.js';
import { chunkDocument } from '../chunking/chunker.js';
import { normalizeOcrResult } from '../normalize/normalizer.js';
import { detectInputType, validateFileSize } from './inputAdapter.js';

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
		const documentId = existingDocumentId ?? generateId('doc');
		const warnings: string[] = [];

		this.telemetry.emit('ingestion_started', { documentId, metadata: { fileName, mimeType } });

		try {
			// Step 1: OCR / Extract
			const normalizedDocument = await this.extractDocument(input, fileName, mimeType, documentId, processingMode);

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
			const chunkingResult = chunkDocument(normalizedDocument, this.config.chunking, {
				embeddingVersion: this.embeddings.getVersionLabel(),
				processingMode,
				tenantId,
				domainId,
				tags,
				mimeType,
				customMetadata: options?.metadata,
			});

			// Step 4: Embed
			const embeddedChunks = await this.embeddings.embedChunks(chunkingResult.chunks);
			this.telemetry.emit('embeddings_completed', {
				documentId,
				metadata: { chunkCount: embeddedChunks.length },
			});

			// Step 5: Ensure collection and upsert
			await this.vector.ensureCollection(
				tenantId,
				this.config.embeddings.vectorSize ?? embeddedChunks[0]?.embedding?.length ?? 1536,
				this.config.embeddings.distanceMetric,
			);

			const { upserted } = await this.vector.upsertChunks(embeddedChunks, tenantId);
			this.telemetry.emit('qdrant_upsert_completed', {
				documentId,
				metadata: { upserted },
			});

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

			this.telemetry.emit('ingestion_completed', {
				documentId,
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
			this.telemetry.emit('ingestion_failed', {
				documentId,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
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
		const documentId = generateId('doc');

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
			this.telemetry.emit('ocr_completed', {
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
			this.telemetry.emit('ocr_failed', {
				documentId,
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
