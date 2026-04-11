import type { TelemetryConfig } from '../config/config.types.js';
import type { MetricEntry, TelemetryEvent, TelemetryEventType } from './telemetry.types.js';

export class TelemetryEmitter {
	private readonly config: Required<Pick<TelemetryConfig, 'enabled'>> & TelemetryConfig;

	constructor(config?: TelemetryConfig) {
		this.config = {
			enabled: config?.enabled ?? true,
			onEvent: config?.onEvent,
			onMetric: config?.onMetric,
		};
	}

	emit(type: TelemetryEventType, data?: Omit<TelemetryEvent, 'type' | 'timestamp'>): void {
		if (!this.config.enabled) return;

		const event: TelemetryEvent = {
			type,
			timestamp: new Date().toISOString(),
			...data,
		};

		this.config.onEvent?.(event);
	}

	metric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
		if (!this.config.enabled) return;

		const entry: MetricEntry = {
			name,
			value,
			unit,
			timestamp: new Date().toISOString(),
			tags,
		};

		this.config.onMetric?.(entry);
	}

	trackDuration(label: string, startTime: number, tags?: Record<string, string>): number {
		const durationMs = Date.now() - startTime;
		this.metric(`${label}_duration_ms`, durationMs, 'ms', tags);
		return durationMs;
	}
}
