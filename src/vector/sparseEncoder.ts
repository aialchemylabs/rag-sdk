/**
 * Sparse vector encoder for hybrid search.
 *
 * Converts text into a bag-of-words sparse vector using hashed token indices
 * and (optionally) log-normalised term frequencies. Compatible with the Qdrant
 * sparse vector format used for keyword-aware retrieval.
 */

/** Sparse vector representation suitable for Qdrant named vectors. */
export interface SparseVector {
	indices: number[];
	values: number[];
}

/** Tuning knobs for {@link encodeSparse}. */
export interface SparseEncoderOptions {
	/** Hash-space size. Default `30_000`. */
	vocabSize?: number;
	/** Drop common English stop words before encoding. Default `true`. */
	removeStopWords?: boolean;
	/** Apply lightweight suffix stemming. Default `true`. */
	stem?: boolean;
	/** Use `1 + log(tf)` instead of raw count. Default `true`. */
	logNormalize?: boolean;
}

// ---------------------------------------------------------------------------
// Stop words (~175 common English words)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
	'a',
	'about',
	'above',
	'after',
	'again',
	'against',
	'all',
	'also',
	'am',
	'an',
	'and',
	'any',
	'are',
	'aren',
	'as',
	'at',
	'be',
	'because',
	'been',
	'before',
	'being',
	'below',
	'between',
	'both',
	'but',
	'by',
	'can',
	'could',
	'couldn',
	'd',
	'did',
	'didn',
	'do',
	'does',
	'doesn',
	'doing',
	'don',
	'down',
	'during',
	'each',
	'etc',
	'even',
	'every',
	'few',
	'for',
	'from',
	'further',
	'get',
	'got',
	'had',
	'hadn',
	'has',
	'hasn',
	'have',
	'haven',
	'having',
	'he',
	'her',
	'here',
	'hers',
	'herself',
	'him',
	'himself',
	'his',
	'how',
	'i',
	'if',
	'in',
	'into',
	'is',
	'isn',
	'it',
	'its',
	'itself',
	'just',
	'let',
	'll',
	'm',
	'may',
	'me',
	'might',
	'more',
	'most',
	'must',
	'mustn',
	'my',
	'myself',
	'need',
	'no',
	'nor',
	'not',
	'now',
	'of',
	'off',
	'on',
	'once',
	'only',
	'or',
	'other',
	'ought',
	'our',
	'ours',
	'ourselves',
	'out',
	'over',
	'own',
	're',
	's',
	'same',
	'shall',
	'shan',
	'she',
	'should',
	'shouldn',
	'so',
	'some',
	'such',
	't',
	'than',
	'that',
	'the',
	'their',
	'theirs',
	'them',
	'themselves',
	'then',
	'there',
	'these',
	'they',
	'this',
	'those',
	'through',
	'to',
	'too',
	'under',
	'until',
	'up',
	've',
	'very',
	'was',
	'wasn',
	'we',
	'were',
	'weren',
	'what',
	'when',
	'where',
	'which',
	'while',
	'who',
	'whom',
	'why',
	'will',
	'with',
	'won',
	'would',
	'wouldn',
	'you',
	'your',
	'yours',
	'yourself',
	'yourselves',
]);

// ---------------------------------------------------------------------------
// Lightweight suffix stemmer
// ---------------------------------------------------------------------------

/**
 * Strip common English suffixes to reduce inflectional variants.
 * This is intentionally simple -- not a full Porter stemmer -- so it stays
 * fast and dependency-free while still collapsing the most common forms.
 */
function stemToken(token: string): string {
	const t = token;

	// -tion -> -t
	if (t.endsWith('tion') && t.length > 4) return t.slice(0, -3);
	// -sion -> -s
	if (t.endsWith('sion') && t.length > 4) return t.slice(0, -3);

	// -ness
	if (t.endsWith('ness') && t.length > 5) return t.slice(0, -4);
	// -ment
	if (t.endsWith('ment') && t.length > 5) return t.slice(0, -4);
	// -able / -ible
	if ((t.endsWith('able') || t.endsWith('ible')) && t.length > 5) return t.slice(0, -4);

	// -ing (keep if result < 3 chars)
	if (t.endsWith('ing') && t.length - 3 >= 3) return t.slice(0, -3);

	// -ies -> -y
	if (t.endsWith('ies') && t.length > 3) return `${t.slice(0, -3)}y`;

	// -ed (keep if result < 3 chars)
	if (t.endsWith('ed') && t.length - 2 >= 3) return t.slice(0, -2);

	// -ly
	if (t.endsWith('ly') && t.length - 2 >= 3) return t.slice(0, -2);

	// -est (keep if result < 3 chars)
	if (t.endsWith('est') && t.length - 3 >= 3) return t.slice(0, -3);

	// -er (keep if result < 3 chars)
	if (t.endsWith('er') && t.length - 2 >= 3) return t.slice(0, -2);

	// -es (keep if result < 3 chars)
	if (t.endsWith('es') && t.length - 2 >= 3) return t.slice(0, -2);

	// -s (not -ss, keep if result < 3 chars)
	if (t.endsWith('s') && !t.endsWith('ss') && t.length - 1 >= 3) return t.slice(0, -1);

	return t;
}

// ---------------------------------------------------------------------------
// Hashing (matches the original qdrantAdapter implementation)
// ---------------------------------------------------------------------------

function hashToken(token: string, vocabSize: number): number {
	let hash = 0;
	for (let i = 0; i < token.length; i++) {
		hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
	}
	return hash % vocabSize;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_VOCAB_SIZE = 30_000;

/**
 * Encode a text string into a sparse vector.
 *
 * The encoder tokenises, optionally removes stop words and stems, then
 * hashes each token into a fixed-size vocabulary space and counts term
 * frequencies. When `logNormalize` is enabled (default) the raw counts are
 * replaced with `1 + log(tf)`.
 *
 * @param text - The input text to encode.
 * @param options - Optional encoder settings.
 * @returns A {@link SparseVector} with parallel `indices` and `values` arrays.
 */
export function encodeSparse(text: string, options?: SparseEncoderOptions): SparseVector {
	const vocabSize = options?.vocabSize ?? DEFAULT_VOCAB_SIZE;
	const removeStops = options?.removeStopWords ?? true;
	const doStem = options?.stem ?? true;
	const doLogNorm = options?.logNormalize ?? true;

	// Tokenise: lowercase, extract word-like tokens, handle contractions
	const rawTokens = text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];

	// Filter and transform
	const tokens: string[] = [];
	for (const raw of rawTokens) {
		if (removeStops && STOP_WORDS.has(raw)) continue;
		tokens.push(doStem ? stemToken(raw) : raw);
	}

	if (tokens.length === 0) {
		return { indices: [], values: [] };
	}

	// Count term frequencies per hash bucket
	const counts = new Map<number, number>();
	for (const token of tokens) {
		const idx = hashToken(token, vocabSize);
		counts.set(idx, (counts.get(idx) ?? 0) + 1);
	}

	// Build output arrays
	const indices: number[] = [];
	const values: number[] = [];
	for (const [idx, count] of counts) {
		indices.push(idx);
		values.push(doLogNorm ? 1 + Math.log(count) : count);
	}

	return { indices, values };
}
