import { RagSdkError } from '../errors/index.js';
import { RagErrorCode } from '../errors/index.js';
import { generateId } from '../utils/index.js';
import { createLogger } from '../telemetry/logger.js';
import type { JobRecord, JobListFilters } from './job.types.js';
import type { JobStore } from './jobStore.types.js';

type JobTask = (job: JobRecord, signal: AbortSignal) => Promise<unknown>;

interface QueuedJob {
	jobId: string;
	task: JobTask;
}

const logger = createLogger('jobs');

export class JobManager {
	private readonly store: JobStore;
	private readonly concurrency: number;
	private readonly timeoutMs: number;
	private readonly abortControllers = new Map<string, AbortController>();
	private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly queue: QueuedJob[] = [];
	private runningCount = 0;
	private isShutdown = false;

	constructor(config: { store: JobStore; concurrency: number; timeoutMs: number }) {
		this.store = config.store;
		this.concurrency = config.concurrency;
		this.timeoutMs = config.timeoutMs;
	}

	async createJob(documentId: string, sourceName: string, tenantId: string, task: JobTask): Promise<JobRecord> {
		if (this.isShutdown) {
			throw new RagSdkError(RagErrorCode.INTERNAL_ERROR, 'JobManager has been shut down');
		}

		const jobId = generateId('job');
		const now = new Date().toISOString();

		const job: JobRecord = {
			jobId,
			documentId,
			sourceName,
			tenantId,
			status: 'pending',
			progress: 0,
			createdAt: now,
		};

		await this.store.create(job);
		logger.info('Job created', { jobId, documentId, sourceName });

		this.queue.push({ jobId, task });
		this.processQueue();

		return { ...job };
	}

	async getJob(jobId: string, tenantId: string): Promise<JobRecord | null> {
		const job = await this.store.get(jobId);
		if (!job) {
			return null;
		}
		if (job.tenantId !== tenantId) {
			return null;
		}
		return job;
	}

	async listJobs(filters: JobListFilters): Promise<JobRecord[]> {
		return this.store.list(filters);
	}

	async cancelJob(jobId: string, tenantId: string): Promise<JobRecord> {
		const job = await this.store.get(jobId);

		if (!job) {
			throw new RagSdkError(RagErrorCode.JOB_NOT_FOUND, `Job not found: ${jobId}`, {
				details: { jobId },
			});
		}

		if (job.tenantId !== tenantId) {
			throw new RagSdkError(RagErrorCode.JOB_NOT_FOUND, `Job not found: ${jobId}`, {
				details: { jobId },
			});
		}

		if (job.status === 'cancelled') {
			throw new RagSdkError(RagErrorCode.JOB_ALREADY_CANCELLED, `Job already cancelled: ${jobId}`, {
				details: { jobId },
			});
		}

		if (job.status === 'completed') {
			throw new RagSdkError(RagErrorCode.JOB_ALREADY_COMPLETED, `Job already completed: ${jobId}`, {
				details: { jobId },
			});
		}

		const now = new Date().toISOString();

		if (job.status === 'running') {
			const controller = this.abortControllers.get(jobId);
			if (controller) {
				controller.abort();
			}
			this.cleanupJob(jobId);
		}

		if (job.status === 'pending') {
			const idx = this.queue.findIndex((q) => q.jobId === jobId);
			if (idx !== -1) {
				this.queue.splice(idx, 1);
			}
		}

		const patch: Partial<JobRecord> = {
			status: 'cancelled',
			completedAt: now,
		};

		await this.store.update(jobId, patch);
		logger.info('Job cancelled', { jobId });

		const updated = await this.store.get(jobId);
		return updated as JobRecord;
	}

	async shutdown(): Promise<void> {
		this.isShutdown = true;
		this.queue.length = 0;

		const runningJobIds = Array.from(this.abortControllers.keys());

		const cancelPromises = runningJobIds.map(async (jobId) => {
			try {
				const job = await this.store.get(jobId);
				if (job) {
					await this.cancelJob(jobId, job.tenantId);
				}
			} catch {
				// Best effort during shutdown
			}
		});

		await Promise.all(cancelPromises);
		logger.info('JobManager shut down', { cancelledJobs: runningJobIds.length });
	}

	private processQueue(): void {
		if (this.isShutdown) {
			return;
		}

		while (this.runningCount < this.concurrency && this.queue.length > 0) {
			const queued = this.queue.shift() as (typeof this.queue)[number];
			this.runJob(queued.jobId, queued.task);
		}
	}

	private async runJob(jobId: string, task: JobTask): Promise<void> {
		this.runningCount++;

		const controller = new AbortController();
		this.abortControllers.set(jobId, controller);

		const now = new Date().toISOString();
		await this.store.update(jobId, { status: 'running', startedAt: now });

		const timeoutTimer = setTimeout(() => {
			logger.warn('Job timed out', { jobId, timeoutMs: this.timeoutMs });
			controller.abort();
		}, this.timeoutMs);
		this.timeoutTimers.set(jobId, timeoutTimer);

		logger.info('Job started', { jobId });

		try {
			const job = await this.store.get(jobId);
			if (!job || job.status !== 'running') {
				return;
			}

			const result = await task(job, controller.signal);

			if (controller.signal.aborted) {
				return;
			}

			await this.store.update(jobId, {
				status: 'completed',
				progress: 100,
				completedAt: new Date().toISOString(),
				result,
			});
			logger.info('Job completed', { jobId });
		} catch (err) {
			if (controller.signal.aborted) {
				const current = await this.store.get(jobId);
				if (current && current.status === 'running') {
					await this.store.update(jobId, {
						status: 'cancelled',
						completedAt: new Date().toISOString(),
					});
				}
				return;
			}

			const errorMessage = err instanceof Error ? err.message : String(err);
			await this.store.update(jobId, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				error: errorMessage,
			});
			logger.error('Job failed', { jobId, error: errorMessage });
		} finally {
			this.cleanupJob(jobId);
			this.runningCount--;
			this.processQueue();
		}
	}

	private cleanupJob(jobId: string): void {
		this.abortControllers.delete(jobId);
		const timer = this.timeoutTimers.get(jobId);
		if (timer) {
			clearTimeout(timer);
			this.timeoutTimers.delete(jobId);
		}
	}
}
