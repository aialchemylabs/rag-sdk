import * as path from 'node:path';

export const SUPPORTED_MIME_TYPES = new Map<string, string>([
	['application/pdf', 'pdf'],
	['image/png', 'png'],
	['image/jpeg', 'jpeg'],
	['image/tiff', 'tiff'],
	['image/webp', 'webp'],
	['image/gif', 'gif'],
	['image/bmp', 'bmp'],
	['image/avif', 'avif'],
	['text/plain', 'text'],
	['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
	['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
]);

const EXTENSION_TO_MIME = new Map<string, string>([
	['.pdf', 'application/pdf'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.tiff', 'image/tiff'],
	['.tif', 'image/tiff'],
	['.webp', 'image/webp'],
	['.gif', 'image/gif'],
	['.bmp', 'image/bmp'],
	['.avif', 'image/avif'],
	['.txt', 'text/plain'],
	['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
]);

export function detectMimeType(fileName: string, providedMimeType?: string): string | undefined {
	if (providedMimeType && SUPPORTED_MIME_TYPES.has(providedMimeType)) {
		return providedMimeType;
	}
	const ext = path.extname(fileName).toLowerCase();
	return EXTENSION_TO_MIME.get(ext);
}
