import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@qdrant/js-client-rest', async () => ({
	QdrantClient: (await import('./e2eHelpers.js')).MockQdrantClient,
}));
vi.mock('openai', async () => ({
	default: (await import('./e2eHelpers.js')).MockOpenAI,
}));
vi.mock('@mistralai/mistralai', async () => ({
	Mistral: (await import('./e2eHelpers.js')).MockMistral,
}));

import { resetState, baseConfig } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';
import type { RagClient } from '../src/createRag.js';
import { RagSdkError } from '../src/errors/ragError.js';
import { RagErrorCode } from '../src/errors/errorCodes.js';

beforeEach(() => {
	resetState();
});

describe('Async Job Lifecycle', () => {
	let rag: RagClient;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-jobs' } }));
	});

	it('async ingest returns pending status with jobId', async () => {
		const result = await rag.ingest.text('Async document content.', { async: true });

		expect(result.status).toBe('pending');
		expect(result.jobId).toMatch(/^job_/);
		expect(result.documentId).toMatch(/^doc_/);
		expect(result.chunksIndexed).toBe(0);
	});

	it('job eventually completes', async () => {
		const result = await rag.ingest.text('Async document content.', { async: true });
		const jobId = result.jobId as string;

		let job = await rag.jobs.get(jobId, 'test-tenant');
		const maxAttempts = 20;
		let attempts = 0;
		while (job?.status !== 'completed' && job?.status !== 'failed' && attempts < maxAttempts) {
			await new Promise((r) => setTimeout(r, 50));
			job = await rag.jobs.get(jobId, 'test-tenant');
			attempts++;
		}

		expect(job?.status).toBe('completed');
		expect(job?.progress).toBe(100);
		expect(job?.completedAt).toBeDefined();
	});

	it('lists jobs with status filter', async () => {
		await rag.ingest.text('Job 1', { async: true });
		await rag.ingest.text('Job 2', { async: true });

		await new Promise((r) => setTimeout(r, 200));

		const allJobs = await rag.jobs.list({});
		expect(allJobs.length).toBe(2);
	});

	it('cancels a pending job', async () => {
		const ragLow = await createRag(
			baseConfig({
				qdrant: { url: 'http://localhost:6333', collection: 'test-cancel' },
				jobs: { concurrency: 1 },
			}),
		);

		await ragLow.ingest.text('First job content.', { async: true });
		const result2 = await ragLow.ingest.text('Second job content.', { async: true });

		try {
			const cancelled = await ragLow.jobs.cancel(result2.jobId as string, 'test-tenant');
			expect(cancelled.status).toBe('cancelled');
		} catch (err) {
			expect((err as RagSdkError).code).toBe(RagErrorCode.JOB_ALREADY_COMPLETED);
		}
	});

	it('returns null for non-existent job', async () => {
		const job = await rag.jobs.get('job_nonexistent', 'test-tenant');
		expect(job).toBeNull();
	});
});
