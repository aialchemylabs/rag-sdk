import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';

async function main() {
	// Initialize with answering configuration enabled
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
		answering: {
			provider: 'openai',
			model: 'gpt-4o',
			apiKey: process.env.OPENAI_API_KEY!,
		},
		defaults: {
			tenantId: 'tenant-a',
		},
	});

	// Step 1: Ingest a document so there is content to retrieve against
	const ingestResult = await rag.ingest.file('./documents/product-manual.pdf', {
		processingMode: ProcessingMode.Hybrid,
		tags: ['product', 'documentation'],
		metadata: {
			version: '3.2',
		},
	});

	console.log('Ingested document:', ingestResult.documentId);

	// Step 2: Retrieve relevant chunks for a query
	const retrievalResult = await rag.retrieve('How do I reset the device to factory settings?', {
		topK: 5,
		scoreThreshold: 0.7,
	});

	console.log('\nRetrieved chunks:');
	for (const match of retrievalResult.matches) {
		console.log(
			`  [${match.score.toFixed(3)}] ${match.citation.sourceName} (pages ${match.citation.pageStart}-${match.citation.pageEnd})`,
		);
		console.log(`    ${match.content.slice(0, 120)}...`);
	}
	console.log(`Search time: ${retrievalResult.searchTimeMs}ms (${retrievalResult.searchType})`);

	// Step 3: Generate a cited answer using the retrieval + generation pipeline
	const answerResult = await rag.answer('How do I reset the device to factory settings?', {
		topK: 5,
		scoreThreshold: 0.7,
	});

	console.log('\nGenerated answer:');
	console.log(answerResult.answer);

	// Display citations that ground the answer (no-citation-no-claim guarantee)
	if (answerResult.citations.length > 0) {
		console.log('\nCitations:');
		for (const citation of answerResult.citations) {
			console.log(
				`  [${citation.citationIndex}] ${citation.anchor.sourceName}, pages ${citation.anchor.pageStart}-${citation.anchor.pageEnd} (chunk ${citation.anchor.chunkId})`,
			);
			console.log(`    Relevance: ${citation.relevanceScore.toFixed(3)}`);
			if (citation.text) {
				console.log(`    Text: "${citation.text.slice(0, 100)}..."`);
			}
		}
	}

	// Display source documents used
	if (answerResult.sources.length > 0) {
		console.log('\nSources:');
		for (const source of answerResult.sources) {
			console.log(`  - ${source.sourceName} (${source.pageRange})`);
		}
	}

	// Check confidence and risk indicators
	console.log('\nConfidence:', answerResult.confidence);
	console.log('Risk level:', answerResult.riskLevel);

	if (answerResult.disclaimer) {
		console.log('Disclaimer:', answerResult.disclaimer);
	}

	console.log(
		`\nTiming: retrieval=${answerResult.retrievalTimeMs}ms, generation=${answerResult.generationTimeMs}ms, total=${answerResult.totalTimeMs}ms`,
	);
}

main().catch(console.error);
