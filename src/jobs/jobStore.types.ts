import type { JobRecord, JobListFilters } from './job.types.js';

export interface JobStore {
	create(job: JobRecord): Promise<void>;
	get(jobId: string): Promise<JobRecord | null>;
	update(jobId: string, patch: Partial<JobRecord>): Promise<void>;
	list(filters: JobListFilters): Promise<JobRecord[]>;
	delete(jobId: string): Promise<void>;
}
