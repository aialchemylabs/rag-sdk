import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';

async function main() {
	const tenantId = 'tenant-a';

	// Initialize the RAG SDK
	const rag = await createRag({
		mistral: {
			apiKey: process.env.MISTRAL_API_KEY!,
			model: 'mistral-ocr-latest',
		},
		qdrant: {
			url: process.env.QDRANT_URL!,
			apiKey: process.env.QDRANT_API_KEY,
			collection: process.env.QDRANT_COLLECTION!,
		},
		embeddings: {
			provider: 'openai',
			model: 'text-embedding-3-small',
			apiKey: process.env.OPENAI_API_KEY!,
		},
		defaults: {
			tenantId,
		},
	});

	// Start an async ingestion job for a large file -- async mode returns
	// immediately with a pending result instead of waiting for completion
	const result = await rag.ingest.file('./documents/large-annual-report.pdf', {
		processingMode: ProcessingMode.Hybrid,
		async: true,
		security: { tenantId },
		tags: ['finance', 'annual-report'],
		metadata: {
			fiscal_year: '2025',
		},
	});

	console.log('Async ingestion started');
	console.log('Document ID:', result.documentId);
	console.log('Job ID:', result.jobId);
	console.log('Initial status:', result.status);

	// Poll for job status until it completes or fails.
	// Note: jobs.get returns null if the job is not found for this tenant.
	if (!result.jobId) {
		console.error('No job ID returned -- async ingestion may not have started.');
		return;
	}

	let job = await rag.jobs.get(result.jobId, tenantId);

	while (job && (job.status === 'pending' || job.status === 'running')) {
		console.log(`Job ${job.jobId}: ${job.status} (${Math.round(job.progress * 100)}%)...`);

		// Wait before checking again
		await new Promise((resolve) => setTimeout(resolve, 2000));
		job = await rag.jobs.get(result.jobId, tenantId);
	}

	if (job?.status === 'completed') {
		console.log('\nJob completed successfully');
		console.log('Document ID:', job.documentId);
		console.log('Source name:', job.sourceName);

		// Retrieve full document details now that ingestion is done
		const doc = await rag.documents.get(job.documentId);
		if (doc) {
			console.log('Pages:', doc.pageCount);
			console.log('Chunks:', doc.chunkCount);
			console.log('Total tokens:', doc.totalTokens);
		}
	} else if (job?.status === 'failed') {
		console.error('\nJob failed:', job.error);
	} else {
		console.error('\nJob not found');
	}

	// Start another job and then cancel it to demonstrate cancellation
	const cancelResult = await rag.ingest.file('./documents/another-large-file.pdf', {
		processingMode: ProcessingMode.OcrFirst,
		async: true,
		security: { tenantId },
		tags: ['draft'],
	});

	console.log('\nSecond job started:', cancelResult.jobId);

	// Cancel the job before it completes
	if (cancelResult.jobId) {
		await rag.jobs.cancel(cancelResult.jobId, tenantId);
		console.log('Job cancelled:', cancelResult.jobId);

		// Verify the cancellation
		const cancelledJob = await rag.jobs.get(cancelResult.jobId, tenantId);
		if (cancelledJob) {
			console.log('Cancelled job status:', cancelledJob.status);
		}
	}

	// List all jobs -- JobListFilters supports status, documentId, limit, offset
	const allJobs = await rag.jobs.list({
		status: 'completed',
		limit: 20,
	});

	console.log('\nCompleted jobs:');
	for (const j of allJobs) {
		console.log(`  ${j.jobId}: ${j.status} - ${j.sourceName}`);
	}
}

main().catch(console.error);
