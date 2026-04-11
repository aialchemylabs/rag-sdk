import { estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
	it('should return 0 for an empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('should return a positive number for a known string', () => {
		const tokens = estimateTokens('Hello, world!');

		expect(tokens).toBeGreaterThan(0);
	});

	it('should return higher counts for longer strings', () => {
		const short = estimateTokens('short');
		const long = estimateTokens('This is a much longer string that should produce more tokens than the short one.');

		expect(long).toBeGreaterThan(short);
	});
});
