import { redactSecrets } from '../utils/redact.js';

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): Logger {
	const formatMessage = (level: string, message: string, data?: Record<string, unknown>) => {
		const timestamp = new Date().toISOString();
		const safeData = data ? redactSecrets(data) : undefined;
		return {
			timestamp,
			level,
			namespace: `rag-sdk:${namespace}`,
			message,
			...(safeData ? { data: safeData } : {}),
		};
	};

	return {
		debug(message, data) {
			if (process.env.RAG_SDK_LOG_LEVEL === 'debug') {
				console.debug(JSON.stringify(formatMessage('debug', message, data)));
			}
		},
		info(message, data) {
			console.info(JSON.stringify(formatMessage('info', message, data)));
		},
		warn(message, data) {
			console.warn(JSON.stringify(formatMessage('warn', message, data)));
		},
		error(message, data) {
			console.error(JSON.stringify(formatMessage('error', message, data)));
		},
	};
}
