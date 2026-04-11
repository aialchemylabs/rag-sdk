import * as fs from 'node:fs';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type {
	IngestBufferInput,
	IngestFileInput,
	IngestInput,
	IngestTextInput,
	IngestUrlInput,
} from './ingest.types.js';
import { SUPPORTED_MIME_TYPES, detectMimeType } from '../utils/mime.js';

export function detectInputType(input: IngestInput): { mimeType: string; fileName: string } {
	switch (input.type) {
		case 'file': {
			const fileName = input.fileName ?? input.filePath.split('/').pop() ?? 'unknown';
			const mimeType = detectMimeType(fileName, input.mimeType);
			if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
				throw new RagSdkError(RagErrorCode.VALIDATION_UNSUPPORTED_TYPE, `Unsupported file type: ${fileName}`, {
					details: { field: 'filePath', received: mimeType ?? 'unknown' },
				});
			}
			return { mimeType, fileName };
		}
		case 'buffer': {
			const mimeType = detectMimeType(input.fileName, input.mimeType);
			if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
				throw new RagSdkError(RagErrorCode.VALIDATION_UNSUPPORTED_TYPE, `Unsupported file type: ${input.fileName}`, {
					details: { field: 'fileName', received: mimeType ?? 'unknown' },
				});
			}
			return { mimeType, fileName: input.fileName };
		}
		case 'url': {
			const fileName = input.fileName ?? new URL(input.url).pathname.split('/').pop() ?? 'unknown';
			const mimeType = detectMimeType(fileName, input.mimeType);
			if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
				throw new RagSdkError(RagErrorCode.VALIDATION_UNSUPPORTED_TYPE, `Unsupported file type: ${fileName}`, {
					details: { field: 'url', received: mimeType ?? 'unknown' },
				});
			}
			return { mimeType, fileName };
		}
		case 'text': {
			return { mimeType: 'text/plain', fileName: input.fileName ?? 'text-input.txt' };
		}
	}
}

export function validateFileSize(input: IngestInput, maxSizeBytes: number): void {
	let size: number | undefined;

	if (input.type === 'file') {
		try {
			const stat = fs.statSync(input.filePath);
			size = stat.size;
		} catch {
			throw new RagSdkError(RagErrorCode.VALIDATION_INVALID_INPUT, `File not found: ${input.filePath}`, {
				details: { field: 'filePath', received: input.filePath },
			});
		}
	} else if (input.type === 'buffer') {
		size = input.buffer.byteLength;
	} else if (input.type === 'text') {
		size = Buffer.byteLength(input.text, 'utf-8');
	}

	if (size !== undefined && size > maxSizeBytes) {
		throw new RagSdkError(
			RagErrorCode.VALIDATION_FILE_TOO_LARGE,
			`File size ${(size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${(maxSizeBytes / 1024 / 1024).toFixed(1)}MB`,
			{
				details: { expected: `<= ${maxSizeBytes}`, received: String(size) },
			},
		);
	}
}

export async function readFileInput(input: IngestFileInput): Promise<Buffer> {
	return fs.promises.readFile(input.filePath);
}

export async function readBufferInput(input: IngestBufferInput): Promise<Buffer> {
	return input.buffer;
}

export async function readUrlInput(_input: IngestUrlInput): Promise<string> {
	return _input.url;
}

export function readTextInput(input: IngestTextInput): string {
	return input.text;
}
