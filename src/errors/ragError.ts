import { type RagErrorCategory, type RagErrorCode, getErrorCategory } from './errorCodes.js';

/** Structured context attached to a {@link RagSdkError}. */
export interface RagErrorDetails {
	provider?: string;
	documentId?: string;
	pageIndex?: number;
	field?: string;
	expected?: string;
	received?: string;
	[key: string]: unknown;
}

/** Base error class for all SDK errors, carrying a machine-readable code and optional retry/provider context. */
export class RagSdkError extends Error {
	public readonly code: RagErrorCode;
	public readonly category: RagErrorCategory;
	public readonly retryable: boolean;
	public readonly provider?: string;
	public readonly details?: RagErrorDetails;

	constructor(
		code: RagErrorCode,
		message: string,
		options?: {
			retryable?: boolean;
			provider?: string;
			details?: RagErrorDetails;
			cause?: Error;
		},
	) {
		super(message, { cause: options?.cause });
		this.name = 'RagSdkError';
		this.code = code;
		this.category = getErrorCategory(code);
		this.retryable = options?.retryable ?? false;
		this.provider = options?.provider;
		this.details = options?.details;
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			category: this.category,
			message: this.message,
			retryable: this.retryable,
			provider: this.provider,
			details: this.details,
		};
	}
}
