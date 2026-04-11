import { encodeSparse } from './sparseEncoder.js';
import type { SparseVector } from './sparseEncoder.js';

describe('encodeSparse', () => {
	// -------------------------------------------------------------------
	// Tokenisation
	// -------------------------------------------------------------------

	describe('tokenisation', () => {
		it('should strip punctuation and keep alphanumeric tokens', () => {
			const result = encodeSparse('Hello, world! Testing 123.', {
				removeStopWords: false,
				stem: false,
				logNormalize: false,
			});

			// "hello", "world", "testing", "123" should all produce hashes
			expect(result.indices.length).toBeGreaterThanOrEqual(4);
			expect(result.values.length).toBe(result.indices.length);
		});

		it('should handle contractions as single tokens', () => {
			const result = encodeSparse("don't can't won't", {
				removeStopWords: false,
				stem: false,
				logNormalize: false,
			});

			// Each contraction is one token
			expect(result.indices.length).toBe(3);
		});

		it('should lowercase all tokens', () => {
			const upper = encodeSparse('HELLO', { removeStopWords: false, stem: false, logNormalize: false });
			const lower = encodeSparse('hello', { removeStopWords: false, stem: false, logNormalize: false });

			expect(upper.indices).toEqual(lower.indices);
			expect(upper.values).toEqual(lower.values);
		});
	});

	// -------------------------------------------------------------------
	// Stop word removal
	// -------------------------------------------------------------------

	describe('stop word removal', () => {
		it('should remove common stop words by default', () => {
			const withStops = encodeSparse('the quick brown fox', { stem: false, logNormalize: false });
			const withoutStops = encodeSparse('the quick brown fox', {
				removeStopWords: false,
				stem: false,
				logNormalize: false,
			});

			// "the" is a stop word, so the default result should have fewer tokens
			expect(withStops.indices.length).toBeLessThan(withoutStops.indices.length);
		});

		it('should keep all tokens when removeStopWords is false', () => {
			const result = encodeSparse('this is a test', {
				removeStopWords: false,
				stem: false,
				logNormalize: false,
			});

			// "this", "is", "a", "test" = 4 distinct tokens
			expect(result.indices.length).toBe(4);
		});

		it('should remove stop words like "the", "is", "and", "of"', () => {
			const result = encodeSparse('the is and of', { stem: false, logNormalize: false });

			// All are stop words => empty
			expect(result.indices).toEqual([]);
			expect(result.values).toEqual([]);
		});
	});

	// -------------------------------------------------------------------
	// Stemming
	// -------------------------------------------------------------------

	describe('stemming', () => {
		it('should stem -ing suffix: "testing" and "test" map to the same hash', () => {
			const stemmed = encodeSparse('testing', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('test', { removeStopWords: false, logNormalize: false });

			// "testing" -> "test" (strip -ing), "test" stays "test"
			expect(stemmed.indices).toEqual(base.indices);
		});

		it('should stem -s suffix: "cats" -> same as "cat"', () => {
			const stemmed = encodeSparse('cats', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('cat', { removeStopWords: false, logNormalize: false });

			expect(stemmed.indices).toEqual(base.indices);
		});

		it('should stem -ed suffix: "processed" -> "process"', () => {
			const stemmed = encodeSparse('processed', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('process', { removeStopWords: false, logNormalize: false });

			expect(stemmed.indices).toEqual(base.indices);
		});

		it('should stem -tion to -t: "creation" -> "creat"', () => {
			const stemmed = encodeSparse('creation', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('creat', { removeStopWords: false, logNormalize: false });

			expect(stemmed.indices).toEqual(base.indices);
		});

		it('should stem -ies to -y: "queries" -> "query"', () => {
			const stemmed = encodeSparse('queries', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('query', { removeStopWords: false, logNormalize: false });

			expect(stemmed.indices).toEqual(base.indices);
		});

		it('should not stem short words that would become < 3 chars', () => {
			// "bed" has length 3; stripping -ed would give "b" (1 char) => should NOT stem
			const result = encodeSparse('bed', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('b', { removeStopWords: false, logNormalize: false });

			expect(result.indices).not.toEqual(base.indices);
		});

		it('should not strip -s from words ending in -ss', () => {
			const result = encodeSparse('lass', { removeStopWords: false, logNormalize: false });
			const base = encodeSparse('las', { removeStopWords: false, logNormalize: false });

			// "lass" ends in -ss, so -s stripping should NOT fire
			expect(result.indices).not.toEqual(base.indices);
		});

		it('should not stem when stem option is false', () => {
			const noStem = encodeSparse('running', { removeStopWords: false, stem: false, logNormalize: false });
			const withStem = encodeSparse('running', { removeStopWords: false, stem: true, logNormalize: false });

			// Without stemming, "running" hashes differently from "run"
			expect(noStem.indices).not.toEqual(withStem.indices);
		});
	});

	// -------------------------------------------------------------------
	// Log-TF normalisation
	// -------------------------------------------------------------------

	describe('log-TF normalisation', () => {
		it('should apply 1 + log(tf) when logNormalize is true', () => {
			// "test test test" => tf=3 for "test"
			const result = encodeSparse('test test test', {
				removeStopWords: false,
				stem: false,
				logNormalize: true,
			});

			expect(result.indices.length).toBe(1);
			expect(result.values[0]).toBeCloseTo(1 + Math.log(3), 10);
		});

		it('should use raw count when logNormalize is false', () => {
			const result = encodeSparse('test test test', {
				removeStopWords: false,
				stem: false,
				logNormalize: false,
			});

			expect(result.indices.length).toBe(1);
			expect(result.values[0]).toBe(3);
		});

		it('should return value of 1 for a single occurrence with log normalisation', () => {
			const result = encodeSparse('unique', {
				removeStopWords: false,
				stem: false,
				logNormalize: true,
			});

			// 1 + log(1) = 1 + 0 = 1
			expect(result.values[0]).toBe(1);
		});
	});

	// -------------------------------------------------------------------
	// Edge cases
	// -------------------------------------------------------------------

	describe('edge cases', () => {
		it('should return empty arrays for empty input', () => {
			const result = encodeSparse('');

			expect(result.indices).toEqual([]);
			expect(result.values).toEqual([]);
		});

		it('should return empty arrays for whitespace-only input', () => {
			const result = encodeSparse('   \t\n  ');

			expect(result.indices).toEqual([]);
			expect(result.values).toEqual([]);
		});

		it('should return empty arrays for input with only stop words', () => {
			const result = encodeSparse('the a an is are was were');

			expect(result.indices).toEqual([]);
			expect(result.values).toEqual([]);
		});

		it('should return empty arrays for punctuation-only input', () => {
			const result = encodeSparse('!!! ... ???');

			expect(result.indices).toEqual([]);
			expect(result.values).toEqual([]);
		});
	});

	// -------------------------------------------------------------------
	// Hash consistency
	// -------------------------------------------------------------------

	describe('hash consistency', () => {
		it('should produce identical output for identical input', () => {
			const a = encodeSparse('machine learning model');
			const b = encodeSparse('machine learning model');

			expect(a.indices).toEqual(b.indices);
			expect(a.values).toEqual(b.values);
		});

		it('should produce indices within vocabSize range', () => {
			const vocabSize = 1000;
			const result = encodeSparse('some random text tokens for testing', {
				vocabSize,
				removeStopWords: false,
				stem: false,
			});

			for (const idx of result.indices) {
				expect(idx).toBeGreaterThanOrEqual(0);
				expect(idx).toBeLessThan(vocabSize);
			}
		});

		it('should respect custom vocabSize', () => {
			const small = encodeSparse('hello world test', { vocabSize: 10, removeStopWords: false, stem: false });
			const large = encodeSparse('hello world test', { vocabSize: 100_000, removeStopWords: false, stem: false });

			for (const idx of small.indices) {
				expect(idx).toBeLessThan(10);
			}
			for (const idx of large.indices) {
				expect(idx).toBeLessThan(100_000);
			}
		});
	});

	// -------------------------------------------------------------------
	// Output structure
	// -------------------------------------------------------------------

	describe('output structure', () => {
		it('should return indices and values arrays of equal length', () => {
			const result = encodeSparse('the quick brown fox jumps over the lazy dog');

			expect(result.indices.length).toBe(result.values.length);
		});

		it('should conform to SparseVector interface', () => {
			const result: SparseVector = encodeSparse('test');

			expect(Array.isArray(result.indices)).toBe(true);
			expect(Array.isArray(result.values)).toBe(true);
		});

		it('should have no duplicate indices', () => {
			const result = encodeSparse('word word word different different', {
				removeStopWords: false,
				stem: false,
			});

			const uniqueIndices = new Set(result.indices);
			expect(uniqueIndices.size).toBe(result.indices.length);
		});

		it('should have all positive values', () => {
			const result = encodeSparse('some text with several words to encode', {
				removeStopWords: false,
			});

			for (const value of result.values) {
				expect(value).toBeGreaterThan(0);
			}
		});
	});

	// -------------------------------------------------------------------
	// Default options
	// -------------------------------------------------------------------

	describe('default options', () => {
		it('should enable stop word removal by default', () => {
			const defaultResult = encodeSparse('the fox');
			const explicitNoStops = encodeSparse('the fox', { removeStopWords: false, stem: true, logNormalize: true });

			// With default (stop words removed), "the" is dropped
			expect(defaultResult.indices.length).toBeLessThan(explicitNoStops.indices.length);
		});

		it('should enable stemming by default', () => {
			const defaultResult = encodeSparse('running', { removeStopWords: false, logNormalize: false });
			const noStem = encodeSparse('running', { removeStopWords: false, stem: false, logNormalize: false });

			// Default stems "running" -> "run"; no-stem keeps "running"
			expect(defaultResult.indices).not.toEqual(noStem.indices);
		});

		it('should enable log normalisation by default', () => {
			const result = encodeSparse('test test test', { removeStopWords: false, stem: false });

			// log-normalised value for tf=3 is ~2.099, not 3
			expect(result.values[0]).toBeCloseTo(1 + Math.log(3), 10);
		});
	});
});
