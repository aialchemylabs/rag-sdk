import * as fs from 'node:fs';
import * as path from 'node:path';
import { Mistral } from '@mistralai/mistralai';
import type { OCRResponse } from '@mistralai/mistralai/models/components/ocrresponse.js';
import type { OCRImageObject } from '@mistralai/mistralai/models/components/ocrimageobject.js';
import type { OCRPageDimensions } from '@mistralai/mistralai/models/components/ocrpagedimensions.js';
import { RagSdkError, RagErrorCode } from '../errors/index.js';
import { detectMimeType, SUPPORTED_MIME_TYPES } from '../utils/mime.js';
import { createLogger } from '../telemetry/logger.js';
import { redactUrl } from '../utils/redact.js';

const logger = createLogger('ocr:mistral');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const IMAGE_MIME_PREFIXES = ['image/'];

export interface MistralOcrRawPage {
	index: number;
	markdown: string;
	images: OCRImageObject[];
	dimensions: OCRPageDimensions | null;
}

export interface MistralOcrRawResult {
	pages: MistralOcrRawPage[];
	model: string;
	usageInfo: {
		pagesProcessed: number;
		docSizeBytes?: number | null;
	};
}

export interface OcrAdapter {
	processFile(filePath: string, model: string): Promise<MistralOcrRawResult>;
	processBuffer(buffer: Buffer, fileName: string, model: string): Promise<MistralOcrRawResult>;
	processUrl(url: string, model: string): Promise<MistralOcrRawResult>;
}

export function createMistralOcrAdapter(apiKey: string): OcrAdapter {
	const client = new Mistral({ apiKey });

	function toRawResult(response: OCRResponse): MistralOcrRawResult {
		return {
			pages: response.pages.map((page) => ({
				index: page.index,
				markdown: page.markdown,
				images: page.images,
				dimensions: page.dimensions,
			})),
			model: response.model,
			usageInfo: {
				pagesProcessed: response.usageInfo.pagesProcessed,
				docSizeBytes: response.usageInfo.docSizeBytes,
			},
		};
	}

	function resolveDataUrl(buffer: Buffer, mimeType: string): string {
		const base64 = buffer.toString('base64');
		return `data:${mimeType};base64,${base64}`;
	}

	function validateMimeType(mimeType: string | undefined, sourceName: string): string {
		if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
			throw new RagSdkError(RagErrorCode.OCR_UNSUPPORTED_FILE, `Unsupported file type for OCR: ${sourceName}`, {
				provider: 'mistral',
				details: { expected: [...SUPPORTED_MIME_TYPES.keys()].join(', '), received: mimeType ?? 'unknown' },
			});
		}
		return mimeType;
	}

	function isImageMime(mimeType: string): boolean {
		return IMAGE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
	}

	function buildImageLimit(mimeType: string): number | undefined {
		if (mimeType === DOCX_MIME) {
			return 0;
		}
		return undefined;
	}

	async function callOcr(
		document: { type: 'document_url'; documentUrl: string } | { type: 'image_url'; imageUrl: string },
		model: string,
		imageLimit?: number,
	): Promise<OCRResponse> {
		return client.ocr.process({
			model,
			document,
			...(imageLimit !== undefined ? { imageLimit } : {}),
		});
	}

	async function processFile(filePath: string, model: string): Promise<MistralOcrRawResult> {
		const absolutePath = path.resolve(filePath);
		const fileName = path.basename(absolutePath);

		logger.info('Processing file', { filePath: absolutePath, model });

		if (!fs.existsSync(absolutePath)) {
			throw new RagSdkError(RagErrorCode.VALIDATION_INVALID_INPUT, `File not found: ${absolutePath}`, {
				provider: 'mistral',
			});
		}

		const mimeType = validateMimeType(detectMimeType(fileName), fileName);
		const buffer = fs.readFileSync(absolutePath);
		const dataUrl = resolveDataUrl(buffer, mimeType);
		const imageLimit = buildImageLimit(mimeType);

		try {
			const document = isImageMime(mimeType)
				? { type: 'image_url' as const, imageUrl: dataUrl }
				: { type: 'document_url' as const, documentUrl: dataUrl };

			const response = await callOcr(document, model, imageLimit);

			logger.info('File processed successfully', { filePath: absolutePath, pages: response.pages.length });
			return toRawResult(response);
		} catch (error) {
			if (error instanceof RagSdkError) throw error;
			throw new RagSdkError(RagErrorCode.OCR_TOTAL_FAILURE, `Mistral OCR failed for file: ${fileName}`, {
				provider: 'mistral',
				retryable: true,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async function processBuffer(buffer: Buffer, fileName: string, model: string): Promise<MistralOcrRawResult> {
		logger.info('Processing buffer', { fileName, model, size: buffer.length });

		const mimeType = validateMimeType(detectMimeType(fileName), fileName);
		const dataUrl = resolveDataUrl(buffer, mimeType);
		const imageLimit = buildImageLimit(mimeType);

		try {
			const document = isImageMime(mimeType)
				? { type: 'image_url' as const, imageUrl: dataUrl }
				: { type: 'document_url' as const, documentUrl: dataUrl };

			const response = await callOcr(document, model, imageLimit);

			logger.info('Buffer processed successfully', { fileName, pages: response.pages.length });
			return toRawResult(response);
		} catch (error) {
			if (error instanceof RagSdkError) throw error;
			throw new RagSdkError(RagErrorCode.OCR_TOTAL_FAILURE, `Mistral OCR failed for buffer: ${fileName}`, {
				provider: 'mistral',
				retryable: true,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async function processUrl(url: string, model: string): Promise<MistralOcrRawResult> {
		logger.info('Processing URL', { url: redactUrl(url), model });

		try {
			const response = await callOcr({ type: 'document_url', documentUrl: url }, model);

			logger.info('URL processed successfully', { url: redactUrl(url), pages: response.pages.length });
			return toRawResult(response);
		} catch (error) {
			if (error instanceof RagSdkError) throw error;
			throw new RagSdkError(RagErrorCode.OCR_TOTAL_FAILURE, `Mistral OCR failed for URL: ${redactUrl(url)}`, {
				provider: 'mistral',
				retryable: true,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	return { processFile, processBuffer, processUrl };
}
