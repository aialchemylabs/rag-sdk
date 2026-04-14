import type { TelemetryConfig } from '../config/config.types.js';
import { createLogger } from './logger.js';
import type { MetricEntry, TelemetryEvent, TelemetryEventType } from './telemetry.types.js';

const logger = createLogger('telemetry:emitter');

/** Per-call telemetry override handler. Receives a typed TelemetryEvent. */
export type TelemetryEventHandler = (event: TelemetryEvent) => void | Promise<void>;

export class TelemetryEmitter {
	private readonly enabled: boolean;
	private readonly onEvent?: (event: unknown) => void | Promise<void>;
	private readonly onMetric?: (metric: unknown) => void | Promise<void>;
	private readonly overrideOnEvent?: TelemetryEventHandler;

	constructor(config?: TelemetryConfig, overrideOnEvent?: TelemetryEventHandler) {
		this.enabled = config?.enabled ?? true;
		this.onEvent = config?.onEvent as ((event: unknown) => void | Promise<void>) | undefined;
		this.onMetric = config?.onMetric as ((metric: unknown) => void | Promise<void>) | undefined;
		this.overrideOnEvent = overrideOnEvent;
	}

	emit(type: TelemetryEventType, data?: Omit<TelemetryEvent, 'type' | 'timestamp'>): void {
		if (!this.enabled) return;

		const event: TelemetryEvent = {
			type,
			timestamp: new Date().toISOString(),
			...data,
		};

		if (this.overrideOnEvent) {
			this.safeInvoke(this.overrideOnEvent as (e: TelemetryEvent) => void | Promise<void>, event, 'per-call');
		}
		if (this.onEvent) {
			this.safeInvoke(this.onEvent as (e: TelemetryEvent) => void | Promise<void>, event, 'client');
		}
	}

	metric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
		if (!this.enabled) return;

		const entry: MetricEntry = {
			name,
			value,
			unit,
			timestamp: new Date().toISOString(),
			tags,
		};

		if (this.onMetric) {
			try {
				const maybePromise = this.onMetric(entry);
				if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
					(maybePromise as Promise<void>).catch((err) => {
						logger.error('Telemetry onMetric handler rejected', {
							metric: name,
							error: err instanceof Error ? err.message : String(err),
						});
					});
				}
			} catch (err) {
				logger.error('Telemetry onMetric handler threw', {
					metric: name,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	trackDuration(label: string, startTime: number, tags?: Record<string, string>): number {
		const durationMs = Date.now() - startTime;
		this.metric(`${label}_duration_ms`, durationMs, 'ms', tags);
		return durationMs;
	}

	/**
	 * Returns an emitter scoped for the duration of a single call. Events emitted
	 * through the returned instance are delivered to BOTH the per-call `override`
	 * handler (first) and the client-scoped handler (second). Errors in either
	 * handler are swallowed and logged so telemetry can never break the call.
	 */
	withOverride(override?: TelemetryEventHandler): TelemetryEmitter {
		if (!override) return this;
		return new TelemetryEmitter(
			{
				enabled: this.enabled,
				onEvent: this.onEvent as TelemetryConfig['onEvent'],
				onMetric: this.onMetric as TelemetryConfig['onMetric'],
			},
			override,
		);
	}

	private safeInvoke(
		handler: (event: TelemetryEvent) => void | Promise<void>,
		event: TelemetryEvent,
		source: 'per-call' | 'client',
	): void {
		try {
			const maybePromise = handler(event);
			if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
				(maybePromise as Promise<void>).catch((err) => {
					logger.error(`Telemetry ${source} onEvent handler rejected`, {
						eventType: event.type,
						error: err instanceof Error ? err.message : String(err),
					});
				});
			}
		} catch (err) {
			logger.error(`Telemetry ${source} onEvent handler threw`, {
				eventType: event.type,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
