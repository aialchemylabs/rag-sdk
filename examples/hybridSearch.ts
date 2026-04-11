import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';

async function main() {
	// Initialize the RAG SDK with hybrid search enabled.
	// Hybrid search combines dense (semantic) and sparse (keyword/BM25) retrieval
	// for improved recall on queries that mix domain-specific terms with natural language.
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
		retrieval: {
			hybrid: { enabled: true },
		},
		defaults: {
			tenantId: 'tenant-a',
		},
	});

	// Ingest a technical document that contains both natural language and
	// domain-specific terminology (acronyms, part numbers, etc.)
	const ingestResult = await rag.ingest.file('./documents/technical-spec.pdf', {
		processingMode: ProcessingMode.Hybrid,
		tags: ['engineering', 'specifications'],
		metadata: {
			department: 'engineering',
			revision: '2.1',
		},
	});

	console.log('Ingested document:', ingestResult.documentId);
	console.log('Chunks created:', ingestResult.chunkingResult?.totalChunks ?? 'N/A');

	// --- Dense search (default) ---
	// Uses only vector similarity -- great for semantic meaning but can miss
	// exact keyword matches like part numbers or acronyms.
	const query = 'What is the maximum operating temperature for module TXR-440?';

	const denseResult = await rag.retrieve(query, {
		topK: 5,
		scoreThreshold: 0.65,
	});

	console.log('\n--- Dense search results ---');
	console.log(`Search type: ${denseResult.searchType}`);
	console.log(`Matches: ${denseResult.totalMatches} (${denseResult.searchTimeMs}ms)`);
	for (const match of denseResult.matches) {
		console.log(`  [${match.score.toFixed(3)}] ${match.citation.sourceName} p${match.citation.pageStart}`);
		console.log(`    ${match.content.slice(0, 100)}...`);
	}

	// --- Hybrid search ---
	// Combines dense vectors with sparse (keyword) matching using reciprocal
	// rank fusion. The fusionAlpha parameter controls the balance:
	//   0.0 = pure dense (semantic only)
	//   1.0 = pure sparse (keyword only)
	//   0.5 = equal weight (good default)
	const hybridResult = await rag.retrieve.hybrid(query, {
		topK: 5,
		scoreThreshold: 0.65,
		fusionAlpha: 0.5,
	});

	console.log('\n--- Hybrid search results ---');
	console.log(`Search type: ${hybridResult.searchType}`);
	console.log(`Matches: ${hybridResult.totalMatches} (${hybridResult.searchTimeMs}ms)`);
	for (const match of hybridResult.matches) {
		console.log(`  [${match.score.toFixed(3)}] ${match.citation.sourceName} p${match.citation.pageStart}`);
		console.log(`    ${match.content.slice(0, 100)}...`);
	}

	// --- Compare the two approaches ---
	// Hybrid search typically surfaces results that mention "TXR-440" explicitly
	// (via keyword matching) while still ranking semantically relevant chunks
	// about operating temperatures highly.
	const denseIds = new Set(denseResult.matches.map((m) => m.chunkId));
	const hybridIds = new Set(hybridResult.matches.map((m) => m.chunkId));
	const overlap = [...denseIds].filter((id) => hybridIds.has(id));

	console.log('\n--- Comparison ---');
	console.log(`Dense-only chunks:  ${denseResult.totalMatches}`);
	console.log(`Hybrid chunks:      ${hybridResult.totalMatches}`);
	console.log(`Overlapping chunks: ${overlap.length}`);
	console.log(`Unique to hybrid:   ${hybridResult.totalMatches - overlap.length}`);
}

main().catch(console.error);
