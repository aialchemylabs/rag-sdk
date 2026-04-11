import type { JobRecord, JobListFilters } from './job.types.js';
import type { JobStore } from './jobStore.types.js';

/**
 * In-memory job store using a Map.
 *
 * **WARNING: All data is lost on process restart.** This store is intended for
 * development, testing, and short-lived SDK instances only. Job state will not
 * survive restarts — running jobs will be silently lost. For production use,
 * implement the {@link JobStore} interface with a persistent backend.
 */
export class InMemoryJobStore implements JobStore {
	private readonly jobs = new Map<string, JobRecord>();

	async create(job: JobRecord): Promise<void> {
		this.jobs.set(job.jobId, { ...job });
	}

	async get(jobId: string): Promise<JobRecord | null> {
		const job = this.jobs.get(jobId);
		return job ? { ...job } : null;
	}

	async update(jobId: string, patch: Partial<JobRecord>): Promise<void> {
		const existing = this.jobs.get(jobId);
		if (!existing) {
			return;
		}
		this.jobs.set(jobId, { ...existing, ...patch });
	}

	async list(filters: JobListFilters): Promise<JobRecord[]> {
		let results = Array.from(this.jobs.values());

		if (filters.tenantId) {
			results = results.filter((j) => j.tenantId === filters.tenantId);
		}
		if (filters.status) {
			results = results.filter((j) => j.status === filters.status);
		}
		if (filters.documentId) {
			results = results.filter((j) => j.documentId === filters.documentId);
		}

		results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

		const offset = filters.offset ?? 0;
		const limit = filters.limit ?? results.length;
		return results.slice(offset, offset + limit).map((j) => ({ ...j }));
	}

	async delete(jobId: string): Promise<void> {
		this.jobs.delete(jobId);
	}
}
