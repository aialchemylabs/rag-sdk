import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { JobManager } from './jobManager.js';
import { InMemoryJobStore } from './inMemoryStore.js';

vi.mock('../telemetry/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock('../utils/index.js', () => {
	let counter = 0;
	return {
		generateId: (prefix?: string) => {
			counter++;
			return prefix ? `${prefix}_${counter}` : `${counter}`;
		},
	};
});

describe('JobManager', () => {
	let store: InMemoryJobStore;
	let manager: JobManager;

	beforeEach(() => {
		store = new InMemoryJobStore();
		manager = new JobManager({ store, concurrency: 2, timeoutMs: 5000 });
	});

	afterEach(async () => {
		await manager.shutdown();
	});

	describe('job creation and queueing', () => {
		it('creates a job with pending status', async () => {
			const task = vi.fn(async () => 'done');
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			expect(job.jobId).toBeTruthy();
			expect(job.documentId).toBe('doc-1');
			expect(job.sourceName).toBe('test.pdf');
			expect(job.tenantId).toBe('tenant-a');
			expect(job.status).toBe('pending');
			expect(job.progress).toBe(0);
			expect(job.createdAt).toBeTruthy();
		});

		it('stores the job in the store', async () => {
			const task = vi.fn(async () => 'done');
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			const stored = await store.get(job.jobId);
			expect(stored).not.toBeNull();
			expect(stored?.documentId).toBe('doc-1');
		});
	});

	describe('status transitions', () => {
		it('transitions pending -> running -> completed', async () => {
			let resolveTask: (value: string) => void;
			const taskPromise = new Promise<string>((resolve) => {
				resolveTask = resolve;
			});

			const task = vi.fn(async () => {
				const result = await taskPromise;
				return result;
			});

			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			// Allow microtasks to process so the job starts running
			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('running');
			});

			resolveTask?.('success');

			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('completed');
			});

			const final = await store.get(job.jobId);
			expect(final?.progress).toBe(100);
			expect(final?.completedAt).toBeTruthy();
			expect(final?.result).toBe('success');
		});
	});

	describe('job cancellation', () => {
		it('cancels a pending job', async () => {
			// Fill concurrency slots so next job stays pending
			const blockingTasks: Array<() => void> = [];
			for (let i = 0; i < 2; i++) {
				const task = vi.fn(
					() =>
						new Promise<void>((resolve) => {
							blockingTasks.push(resolve);
						}),
				);
				await manager.createJob(`doc-blocker-${i}`, 'block.pdf', 'tenant-a', task);
			}

			// This job should be queued (pending) since concurrency is 2
			const pendingTask = vi.fn(async () => 'should-not-run');
			const pendingJob = await manager.createJob('doc-pending', 'pending.pdf', 'tenant-a', pendingTask);

			const cancelled = await manager.cancelJob(pendingJob.jobId, 'tenant-a');
			expect(cancelled.status).toBe('cancelled');
			expect(pendingTask).not.toHaveBeenCalled();

			// Clean up blocking tasks
			for (const resolve of blockingTasks) {
				resolve();
			}
		});

		it('cancels a running job by aborting', async () => {
			let taskSignal: AbortSignal;
			const task = vi.fn(async (_job: unknown, signal: AbortSignal) => {
				taskSignal = signal;
				return new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				});
			});

			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('running');
			});

			const cancelled = await manager.cancelJob(job.jobId, 'tenant-a');
			expect(cancelled.status).toBe('cancelled');
			expect(taskSignal?.aborted).toBe(true);
		});

		it('throws when cancelling an already cancelled job', async () => {
			const task = vi.fn(() => new Promise<void>(() => {}));
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('running');
			});

			await manager.cancelJob(job.jobId, 'tenant-a');

			await expect(manager.cancelJob(job.jobId, 'tenant-a')).rejects.toThrow('already cancelled');
		});

		it('throws when cancelling a completed job', async () => {
			const task = vi.fn(async () => 'done');
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('completed');
			});

			await expect(manager.cancelJob(job.jobId, 'tenant-a')).rejects.toThrow('already completed');
		});

		it('throws when cancelling a job with wrong tenantId', async () => {
			const task = vi.fn(() => new Promise<void>(() => {}));
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await expect(manager.cancelJob(job.jobId, 'tenant-b')).rejects.toThrow('not found');
		});
	});

	describe('job failure handling', () => {
		it('marks job as failed when task throws', async () => {
			const task = vi.fn(async () => {
				throw new Error('Something went wrong');
			});

			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await vi.waitFor(async () => {
				const current = await store.get(job.jobId);
				expect(current?.status).toBe('failed');
			});

			const failed = await store.get(job.jobId);
			expect(failed?.error).toBe('Something went wrong');
			expect(failed?.completedAt).toBeTruthy();
		});
	});

	describe('concurrency limits', () => {
		it('respects concurrency limit', async () => {
			const resolvers: Array<() => void> = [];
			const taskFactory = () =>
				vi.fn(
					() =>
						new Promise<void>((resolve) => {
							resolvers.push(resolve);
						}),
				);

			const task1 = taskFactory();
			const task2 = taskFactory();
			const task3 = taskFactory();

			await manager.createJob('doc-1', 'a.pdf', 'tenant-a', task1);
			await manager.createJob('doc-2', 'b.pdf', 'tenant-a', task2);
			const job3 = await manager.createJob('doc-3', 'c.pdf', 'tenant-a', task3);

			// Wait for the first two to start running
			await vi.waitFor(async () => {
				expect(task1).toHaveBeenCalled();
				expect(task2).toHaveBeenCalled();
			});

			// Third task should NOT have been called yet (concurrency = 2)
			expect(task3).not.toHaveBeenCalled();

			const job3Status = await store.get(job3.jobId);
			expect(job3Status?.status).toBe('pending');

			// Complete one job to free a slot
			resolvers[0]?.();

			await vi.waitFor(async () => {
				expect(task3).toHaveBeenCalled();
			});

			// Clean up
			for (const resolve of resolvers.slice(1)) {
				resolve();
			}
		});
	});

	describe('timeout behavior', () => {
		it('aborts a job that exceeds the timeout', async () => {
			const shortManager = new JobManager({ store: new InMemoryJobStore(), concurrency: 2, timeoutMs: 50 });

			let taskSignal: AbortSignal;
			const task = vi.fn(async (_job: unknown, signal: AbortSignal) => {
				taskSignal = signal;
				return new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				});
			});

			const job = await shortManager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			await vi.waitFor(
				async () => {
					const current = await shortManager.getJob(job.jobId, 'tenant-a');
					expect(current?.status).toBe('cancelled');
				},
				{ timeout: 1000 },
			);

			expect(taskSignal?.aborted).toBe(true);

			await shortManager.shutdown();
		});
	});

	describe('getJob', () => {
		it('returns null for non-existent job', async () => {
			const result = await manager.getJob('nonexistent', 'tenant-a');
			expect(result).toBeNull();
		});

		it('returns null when tenantId does not match', async () => {
			const task = vi.fn(async () => 'done');
			const job = await manager.createJob('doc-1', 'test.pdf', 'tenant-a', task);

			const result = await manager.getJob(job.jobId, 'tenant-b');
			expect(result).toBeNull();
		});
	});

	describe('shutdown', () => {
		it('rejects new jobs after shutdown', async () => {
			await manager.shutdown();

			const task = vi.fn(async () => 'done');
			await expect(manager.createJob('doc-1', 'test.pdf', 'tenant-a', task)).rejects.toThrow('shut down');
		});
	});
});
