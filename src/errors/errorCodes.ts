/** Machine-readable error codes covering every failure mode in the SDK. */
export enum RagErrorCode {
	// Configuration
	CONFIG_MISSING_REQUIRED = 'CONFIG_MISSING_REQUIRED',
	CONFIG_INVALID_URL = 'CONFIG_INVALID_URL',
	CONFIG_UNSUPPORTED_PROVIDER = 'CONFIG_UNSUPPORTED_PROVIDER',
	CONFIG_INVALID_RANGE = 'CONFIG_INVALID_RANGE',
	CONFIG_INCOMPATIBLE = 'CONFIG_INCOMPATIBLE',

	// Authentication
	AUTH_INVALID_KEY = 'AUTH_INVALID_KEY',
	AUTH_EXPIRED_KEY = 'AUTH_EXPIRED_KEY',
	AUTH_PROVIDER_UNAUTHORIZED = 'AUTH_PROVIDER_UNAUTHORIZED',

	// OCR
	OCR_TOTAL_FAILURE = 'OCR_TOTAL_FAILURE',
	OCR_PARTIAL_FAILURE = 'OCR_PARTIAL_FAILURE',
	OCR_PAGE_FAILURE = 'OCR_PAGE_FAILURE',
	OCR_EMPTY_RESULT = 'OCR_EMPTY_RESULT',
	OCR_UNSUPPORTED_FILE = 'OCR_UNSUPPORTED_FILE',
	OCR_TIMEOUT = 'OCR_TIMEOUT',

	// Embedding
	EMBEDDING_PROVIDER_ERROR = 'EMBEDDING_PROVIDER_ERROR',
	EMBEDDING_DIMENSION_MISMATCH = 'EMBEDDING_DIMENSION_MISMATCH',
	EMBEDDING_RATE_LIMIT = 'EMBEDDING_RATE_LIMIT',

	// Vector Database
	VECTOR_CONNECTION_ERROR = 'VECTOR_CONNECTION_ERROR',
	VECTOR_COLLECTION_NOT_FOUND = 'VECTOR_COLLECTION_NOT_FOUND',
	VECTOR_UPSERT_FAILED = 'VECTOR_UPSERT_FAILED',
	VECTOR_SEARCH_FAILED = 'VECTOR_SEARCH_FAILED',
	VECTOR_DELETE_FAILED = 'VECTOR_DELETE_FAILED',

	// Validation
	VALIDATION_INVALID_INPUT = 'VALIDATION_INVALID_INPUT',
	VALIDATION_FILE_TOO_LARGE = 'VALIDATION_FILE_TOO_LARGE',
	VALIDATION_UNSUPPORTED_TYPE = 'VALIDATION_UNSUPPORTED_TYPE',
	VALIDATION_MISSING_TENANT = 'VALIDATION_MISSING_TENANT',

	// Timeout
	TIMEOUT_INGESTION = 'TIMEOUT_INGESTION',
	TIMEOUT_RETRIEVAL = 'TIMEOUT_RETRIEVAL',
	TIMEOUT_ANSWER = 'TIMEOUT_ANSWER',

	// Partial Processing
	PARTIAL_OCR = 'PARTIAL_OCR',
	PARTIAL_INDEXING = 'PARTIAL_INDEXING',

	// Jobs
	JOB_NOT_FOUND = 'JOB_NOT_FOUND',
	JOB_ALREADY_CANCELLED = 'JOB_ALREADY_CANCELLED',
	JOB_ALREADY_COMPLETED = 'JOB_ALREADY_COMPLETED',

	// Answer
	ANSWER_PROVIDER_ERROR = 'ANSWER_PROVIDER_ERROR',
	ANSWER_NO_EVIDENCE = 'ANSWER_NO_EVIDENCE',
	ANSWER_LOW_CONFIDENCE = 'ANSWER_LOW_CONFIDENCE',

	// General
	INTERNAL_ERROR = 'INTERNAL_ERROR',
	NOT_CONFIGURED = 'NOT_CONFIGURED',
}

/** Broad category a {@link RagErrorCode} belongs to, derived from its prefix. */
export type RagErrorCategory =
	| 'configuration'
	| 'authentication'
	| 'ocr'
	| 'embedding'
	| 'vector_database'
	| 'validation'
	| 'timeout'
	| 'partial_processing'
	| 'job'
	| 'answer'
	| 'internal';

const CODE_TO_CATEGORY: Record<string, RagErrorCategory> = {};

for (const code of Object.values(RagErrorCode)) {
	if (code.startsWith('CONFIG_')) CODE_TO_CATEGORY[code] = 'configuration';
	else if (code.startsWith('AUTH_')) CODE_TO_CATEGORY[code] = 'authentication';
	else if (code.startsWith('OCR_')) CODE_TO_CATEGORY[code] = 'ocr';
	else if (code.startsWith('EMBEDDING_')) CODE_TO_CATEGORY[code] = 'embedding';
	else if (code.startsWith('VECTOR_')) CODE_TO_CATEGORY[code] = 'vector_database';
	else if (code.startsWith('VALIDATION_')) CODE_TO_CATEGORY[code] = 'validation';
	else if (code.startsWith('TIMEOUT_')) CODE_TO_CATEGORY[code] = 'timeout';
	else if (code.startsWith('PARTIAL_')) CODE_TO_CATEGORY[code] = 'partial_processing';
	else if (code.startsWith('JOB_')) CODE_TO_CATEGORY[code] = 'job';
	else if (code.startsWith('ANSWER_')) CODE_TO_CATEGORY[code] = 'answer';
	else CODE_TO_CATEGORY[code] = 'internal';
}

/** Resolve the {@link RagErrorCategory} for a given error code. */
export function getErrorCategory(code: RagErrorCode): RagErrorCategory {
	return CODE_TO_CATEGORY[code] ?? 'internal';
}
