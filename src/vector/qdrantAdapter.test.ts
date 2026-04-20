import { describe, expect, it, vi } from 'vitest';
import type { Chunk } from '../chunking/chunk.types.js';

const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@qdrant/js-client-rest', () => ({
	QdrantClient: class {
		upsert = upsertMock;
		delete = deleteMock;
	},
}));

vi.mock('../telemetry/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { QdrantAdapter } from './qdrantAdapter.js';

function makeChunk(index: number): Chunk {
	return {
		chunkId: `chk_${index}`,
		documentId: 'doc_test',
		content: `Content ${index}`,
		tokenCount: 10,
		embedding: [0.1, 0.2, 0.3],
		metadata: {
			documentId: 'doc_test',
			chunkId: `chk_${index}`,
			chunkIndex: index,
			sourceName: 'test.pdf',
			pageStart: 0,
			pageEnd: 0,
			processingMode: 'hybrid',
			embeddingVersion: 'v1',
			ocrProvider: 'mistral',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	};
}

describe('QdrantAdapter.upsertChunks — atomic rollback', () => {
	it('rolls back points inserted by earlier batches when a later batch fails', async () => {
		upsertMock.mockReset();
		deleteMock.mockReset();

		// Two batches of 100: first succeeds, second fails.
		upsertMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('qdrant network error'));
		deleteMock.mockResolvedValueOnce(undefined);

		const adapter = new QdrantAdapter({ url: 'http://localhost:6333', collectionPrefix: 'test' });
		const chunks: Chunk[] = [];
		for (let i = 0; i < 150; i++) {
			chunks.push(makeChunk(i));
		}

		await expect(adapter.upsertChunks(chunks, 'tenant-a')).rejects.toThrow();

		expect(upsertMock).toHaveBeenCalledTimes(2);
		expect(deleteMock).toHaveBeenCalledTimes(1);
		const [collectionName, deleteArgs] = deleteMock.mock.calls[0] ?? [];
		expect(collectionName).toBe('test_tenant-a');
		expect((deleteArgs as { points: (string | number)[] }).points.length).toBe(100);
	});

	it('does not call delete when the first batch fails (nothing to roll back)', async () => {
		upsertMock.mockReset();
		deleteMock.mockReset();
		upsertMock.mockRejectedValueOnce(new Error('qdrant boom'));

		const adapter = new QdrantAdapter({ url: 'http://localhost:6333', collectionPrefix: 'test' });
		const chunks = [makeChunk(0), makeChunk(1)];

		await expect(adapter.upsertChunks(chunks, 'tenant-a')).rejects.toThrow();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('validates every chunk has an embedding before any upsert', async () => {
		upsertMock.mockReset();
		deleteMock.mockReset();

		const adapter = new QdrantAdapter({ url: 'http://localhost:6333', collectionPrefix: 'test' });
		const chunks = [makeChunk(0), makeChunk(1)];
		chunks[1] = { ...chunks[1], embedding: undefined } as Chunk;

		await expect(adapter.upsertChunks(chunks, 'tenant-a')).rejects.toThrow(/has no embedding/);
		expect(upsertMock).not.toHaveBeenCalled();
		expect(deleteMock).not.toHaveBeenCalled();
	});
});
