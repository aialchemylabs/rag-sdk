import { createRag, ProcessingMode } from '@aialchemy/rag-sdk';

async function main() {
	// Initialize the RAG SDK with required credentials.
	// The factory is async because provider loading can use dynamic imports.
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
			tenantId: 'tenant-a',
		},
	});

	// Ingest a PDF file from disk -- the SDK handles OCR, chunking,
	// embedding, and indexing in a single call
	const result = await rag.ingest.file('./documents/quarterly-report.pdf', {
		processingMode: ProcessingMode.Hybrid,
		tags: ['finance', 'quarterly'],
		metadata: {
			department: 'finance',
			quarter: 'Q4-2025',
		},
	});

	console.log('Ingestion complete');
	console.log('Document ID:', result.documentId);
	console.log('Source name:', result.sourceName);
	console.log('Status:', result.status);
	console.log('Pages processed:', result.normalizedDocument?.pageCount ?? 'N/A');
	console.log('Chunks created:', result.chunkingResult?.totalChunks ?? 'N/A');
	console.log('Chunks indexed:', result.chunksIndexed);
	console.log('Processing time:', result.processingTimeMs, 'ms');

	if (result.warnings.length > 0) {
		console.log('Warnings:', result.warnings);
	}

	// Verify the document is indexed
	const doc = await rag.documents.get(result.documentId);

	if (doc) {
		console.log('Document found:', doc.sourceName);
		console.log('MIME type:', doc.mimeType);
		console.log('Page count:', doc.pageCount);
		console.log('Chunk count:', doc.chunkCount);
		console.log('Total tokens:', doc.totalTokens);
	} else {
		console.log('Document not found');
	}
}

main().catch(console.error);
