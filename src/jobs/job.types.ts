/** Lifecycle status of an async ingestion job. */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Persistent record tracking an async ingestion job. */
export interface JobRecord {
	jobId: string;
	documentId: string;
	sourceName: string;
	tenantId: string;
	status: JobStatus;
	progress: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	result?: unknown;
}

/** Filters for listing / querying jobs. */
export interface JobListFilters {
	status?: JobStatus;
	documentId?: string;
	tenantId?: string;
	limit?: number;
	offset?: number;
}
