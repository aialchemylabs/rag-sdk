import { describe, expect, it, vi } from 'vitest';
import { TelemetryEmitter } from './emitter.js';
import type { TelemetryEvent } from './telemetry.types.js';

vi.mock('./logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe('TelemetryEmitter', () => {
	it('delivers events to the client-scoped handler', () => {
		const onEvent = vi.fn();
		const emitter = new TelemetryEmitter({ enabled: true, onEvent });

		emitter.emit('ingestion_started', { documentId: 'doc_1' });

		expect(onEvent).toHaveBeenCalledTimes(1);
		const event = onEvent.mock.calls[0]?.[0] as TelemetryEvent;
		expect(event.type).toBe('ingestion_started');
		expect(event.documentId).toBe('doc_1');
		expect(event.timestamp).toBeTruthy();
	});

	it('is a no-op when disabled', () => {
		const onEvent = vi.fn();
		const emitter = new TelemetryEmitter({ enabled: false, onEvent });

		emitter.emit('ingestion_started');

		expect(onEvent).not.toHaveBeenCalled();
	});

	it('swallows and logs exceptions thrown by the client onEvent handler', () => {
		const onEvent = vi.fn(() => {
			throw new Error('boom');
		});
		const emitter = new TelemetryEmitter({ enabled: true, onEvent });

		expect(() => emitter.emit('ingestion_completed', { documentId: 'doc_1' })).not.toThrow();
		expect(onEvent).toHaveBeenCalledTimes(1);
	});

	it('swallows rejected promises returned by the onEvent handler', async () => {
		const onEvent = vi.fn(async () => {
			throw new Error('async boom');
		});
		const emitter = new TelemetryEmitter({ enabled: true, onEvent });

		expect(() => emitter.emit('ingestion_completed')).not.toThrow();
		// Give the microtask queue a chance to flush the rejection
		await new Promise((r) => setImmediate(r));
	});

	describe('withOverride', () => {
		it('returns the same instance when no override is provided', () => {
			const emitter = new TelemetryEmitter({ enabled: true, onEvent: vi.fn() });
			expect(emitter.withOverride(undefined)).toBe(emitter);
		});

		it('dispatches events to both per-call override and client-scoped handler', () => {
			const clientHandler = vi.fn();
			const overrideHandler = vi.fn();
			const emitter = new TelemetryEmitter({ enabled: true, onEvent: clientHandler });

			const scoped = emitter.withOverride(overrideHandler);
			scoped.emit('embeddings_started', { documentId: 'doc_x' });

			expect(overrideHandler).toHaveBeenCalledTimes(1);
			expect(clientHandler).toHaveBeenCalledTimes(1);
			expect((overrideHandler.mock.calls[0]?.[0] as TelemetryEvent).type).toBe('embeddings_started');
			expect((clientHandler.mock.calls[0]?.[0] as TelemetryEvent).type).toBe('embeddings_started');
		});

		it('runs the per-call override before the client handler', () => {
			const order: string[] = [];
			const clientHandler = vi.fn(() => {
				order.push('client');
			});
			const overrideHandler = vi.fn(() => {
				order.push('override');
			});
			const emitter = new TelemetryEmitter({ enabled: true, onEvent: clientHandler });

			emitter.withOverride(overrideHandler).emit('ingestion_started');

			expect(order).toEqual(['override', 'client']);
		});

		it('swallow-and-logs an exception from the per-call override without blocking the client handler', () => {
			const clientHandler = vi.fn();
			const overrideHandler = vi.fn(() => {
				throw new Error('override boom');
			});
			const emitter = new TelemetryEmitter({ enabled: true, onEvent: clientHandler });

			expect(() => emitter.withOverride(overrideHandler).emit('ingestion_failed')).not.toThrow();
			expect(overrideHandler).toHaveBeenCalledTimes(1);
			expect(clientHandler).toHaveBeenCalledTimes(1);
		});

		it('swallow-and-logs an exception from the client handler without blocking the override', () => {
			const clientHandler = vi.fn(() => {
				throw new Error('client boom');
			});
			const overrideHandler = vi.fn();
			const emitter = new TelemetryEmitter({ enabled: true, onEvent: clientHandler });

			expect(() => emitter.withOverride(overrideHandler).emit('ingestion_failed')).not.toThrow();
			expect(overrideHandler).toHaveBeenCalledTimes(1);
			expect(clientHandler).toHaveBeenCalledTimes(1);
		});

		it('passes the typed TelemetryEvent to the override handler', () => {
			const overrideHandler = vi.fn<(e: TelemetryEvent) => void>();
			const emitter = new TelemetryEmitter({ enabled: true });

			emitter.withOverride(overrideHandler).emit('qdrant_upsert_failed', {
				documentId: 'doc_1',
				tenantId: 'tenant-a',
				error: 'upsert blew up',
			});

			const event = overrideHandler.mock.calls[0]?.[0];
			expect(event?.type).toBe('qdrant_upsert_failed');
			expect(event?.documentId).toBe('doc_1');
			expect(event?.tenantId).toBe('tenant-a');
			expect(event?.error).toBe('upsert blew up');
		});
	});
});
