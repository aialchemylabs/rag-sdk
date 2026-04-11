const SECRET_KEY_PATTERNS = [/api[_-]?key/i, /secret/i, /password/i, /token/i, /credential/i, /auth/i];

const URL_KEY_PATTERNS = [/url$/i, /endpoint/i, /base_?url/i, /href/i];

/**
 * Redact credentials embedded in a URL string (e.g. `https://user:pass@host`).
 * Preserves scheme + host for debuggability while stripping userinfo and query params
 * that commonly carry tokens.
 */
export function redactUrl(url: string): string {
	try {
		const parsed = new URL(url);
		// Strip userinfo (user:password@)
		if (parsed.username || parsed.password) {
			parsed.username = '';
			parsed.password = '';
		}
		// Strip query params that look like secrets
		for (const key of [...parsed.searchParams.keys()]) {
			if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
				parsed.searchParams.set(key, '[REDACTED]');
			}
		}
		return parsed.toString();
	} catch {
		// Not a valid URL — redact entirely to be safe
		return '[REDACTED_URL]';
	}
}

function redactValue(key: string, value: unknown): unknown {
	if (typeof value !== 'string' || value.length === 0) return value;

	if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
		return '[REDACTED]';
	}
	if (URL_KEY_PATTERNS.some((p) => p.test(key))) {
		return redactUrl(value);
	}
	return value;
}

export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
			redacted[key] = typeof value === 'string' && value.length > 0 ? '[REDACTED]' : value;
		} else if (URL_KEY_PATTERNS.some((p) => p.test(key)) && typeof value === 'string') {
			redacted[key] = redactUrl(value);
		} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			redacted[key] = redactSecrets(value as Record<string, unknown>);
		} else {
			redacted[key] = redactValue(key, value) ?? value;
		}
	}
	return redacted;
}
