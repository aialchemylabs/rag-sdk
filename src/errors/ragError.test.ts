import { RagSdkError } from './ragError.js';
import { RagErrorCode } from './errorCodes.js';

describe('RagSdkError', () => {
	it('should carry the correct code, message, and category', () => {
		const error = new RagSdkError(RagErrorCode.CONFIG_MISSING_REQUIRED, 'Missing config field');

		expect(error.code).toBe(RagErrorCode.CONFIG_MISSING_REQUIRED);
		expect(error.message).toBe('Missing config field');
		expect(error.category).toBe('configuration');
	});

	it('should default retryable to false', () => {
		const error = new RagSdkError(RagErrorCode.INTERNAL_ERROR, 'Something broke');

		expect(error.retryable).toBe(false);
	});

	it('should return a well-formed object from toJSON()', () => {
		const error = new RagSdkError(RagErrorCode.EMBEDDING_RATE_LIMIT, 'Rate limited', {
			retryable: true,
			provider: 'openai',
			details: { field: 'embedding' },
		});

		const json = error.toJSON();

		expect(json).toEqual({
			name: 'RagSdkError',
			code: RagErrorCode.EMBEDDING_RATE_LIMIT,
			category: 'embedding',
			message: 'Rate limited',
			retryable: true,
			provider: 'openai',
			details: { field: 'embedding' },
		});
	});

	it('should be an instance of Error', () => {
		const error = new RagSdkError(RagErrorCode.INTERNAL_ERROR, 'test');

		expect(error).toBeInstanceOf(Error);
	});
});
