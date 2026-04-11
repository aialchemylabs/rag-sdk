import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';

async function main() {
	// Initialize the RAG SDK -- tenancy is enforced per-operation,
	// not at the instance level, so one SDK instance serves all tenants
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
	});

	// Ingest a document for Tenant A
	const tenantAResult = await rag.ingest.file('./documents/tenant-a-policy.pdf', {
		processingMode: ProcessingMode.TextFirst,
		security: { tenantId: 'tenant-a' },
		domainId: 'hr-policies',
		tags: ['policy', 'hr'],
		metadata: {
			department: 'human-resources',
		},
	});

	console.log('Tenant A document ingested:', tenantAResult.documentId);

	// Ingest a document for Tenant B
	const tenantBResult = await rag.ingest.file('./documents/tenant-b-policy.pdf', {
		processingMode: ProcessingMode.TextFirst,
		security: { tenantId: 'tenant-b' },
		domainId: 'hr-policies',
		tags: ['policy', 'hr'],
		metadata: {
			department: 'human-resources',
		},
	});

	console.log('Tenant B document ingested:', tenantBResult.documentId);

	// Retrieve for Tenant A only -- tenant scoping is enforced through `security`,
	// so Tenant B documents will never appear in these results
	const tenantAResults = await rag.retrieve('What is the vacation policy?', {
		topK: 5,
		security: { tenantId: 'tenant-a' },
		filters: {
			domainId: 'hr-policies',
		},
	});

	console.log('\nTenant A results:');
	for (const match of tenantAResults.matches) {
		console.log(
			`  [${match.score.toFixed(3)}] ${match.citation.sourceName} (pages ${match.citation.pageStart}-${match.citation.pageEnd})`,
		);
	}

	// Retrieve for Tenant B only -- completely isolated from Tenant A
	const tenantBResults = await rag.retrieve('What is the vacation policy?', {
		topK: 5,
		security: { tenantId: 'tenant-b' },
		filters: {
			domainId: 'hr-policies',
		},
	});

	console.log('\nTenant B results:');
	for (const match of tenantBResults.matches) {
		console.log(
			`  [${match.score.toFixed(3)}] ${match.citation.sourceName} (pages ${match.citation.pageStart}-${match.citation.pageEnd})`,
		);
	}

	// List documents scoped to a specific tenant
	const tenantADocs = await rag.documents.list({
		tenantId: 'tenant-a',
	});

	console.log('\nTenant A documents:', tenantADocs.length);

	// Delete a document -- only removes chunks belonging to the specified document
	await rag.documents.delete(tenantAResult.documentId, 'tenant-a');
	console.log('Tenant A document deleted');
}

main().catch(console.error);
