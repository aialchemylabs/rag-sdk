import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDocumentStore } from './inMemoryDocumentStore.js';
import type { StoredDocument } from './documentStore.types.js';

function makeDoc(overrides: Partial<StoredDocument> = {}): StoredDocument {
	return {
		documentId: 'doc-1',
		sourceName: 'test.pdf',
		mimeType: 'application/pdf',
		pageCount: 5,
		chunkCount: 10,
		totalTokens: 2000,
		tenantId: 'tenant-a',
		embeddingVersion: 'openai:text-embedding-3-small',
		processingMode: 'hybrid',
		createdAt: '2025-01-01T00:00:00.000Z',
		updatedAt: '2025-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('InMemoryDocumentStore', () => {
	let store: InMemoryDocumentStore;

	beforeEach(() => {
		store = new InMemoryDocumentStore();
	});

	describe('put + get', () => {
		it('should store and retrieve a document', async () => {
			const doc = makeDoc();

			await store.put(doc);
			const result = await store.get('doc-1', 'tenant-a');

			expect(result).toEqual(doc);
		});

		it('should return null for a missing document', async () => {
			const result = await store.get('nonexistent', 'tenant-a');

			expect(result).toBeNull();
		});

		it('should overwrite an existing document (upsert behavior)', async () => {
			const original = makeDoc({ chunkCount: 10 });
			const updated = makeDoc({ chunkCount: 25, updatedAt: '2025-06-01T00:00:00.000Z' });

			await store.put(original);
			await store.put(updated);
			const result = await store.get('doc-1', 'tenant-a');

			expect(result?.chunkCount).toBe(25);
			expect(result?.updatedAt).toBe('2025-06-01T00:00:00.000Z');
		});

		it('should return a defensive copy (mutations do not affect the store)', async () => {
			const doc = makeDoc({ tags: ['finance'] });
			await store.put(doc);

			const retrieved = await store.get('doc-1', 'tenant-a');
			expect(retrieved).not.toBeNull();
			retrieved?.tags?.push('mutated');

			const fresh = await store.get('doc-1', 'tenant-a');
			expect(fresh?.tags).toEqual(['finance']);
		});
	});

	describe('list', () => {
		it('should filter by tenantId (tenant isolation)', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', tenantId: 'tenant-a' }));
			await store.put(makeDoc({ documentId: 'doc-2', tenantId: 'tenant-b' }));
			await store.put(makeDoc({ documentId: 'doc-3', tenantId: 'tenant-a' }));

			const results = await store.list({ tenantId: 'tenant-a' });

			expect(results).toHaveLength(2);
			expect(results.map((d) => d.documentId).sort()).toEqual(['doc-1', 'doc-3']);
		});

		it('should filter by domainId', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', domainId: 'finance' }));
			await store.put(makeDoc({ documentId: 'doc-2', domainId: 'legal' }));
			await store.put(makeDoc({ documentId: 'doc-3', domainId: 'finance' }));

			const results = await store.list({ tenantId: 'tenant-a', domainId: 'finance' });

			expect(results).toHaveLength(2);
			expect(results.map((d) => d.documentId).sort()).toEqual(['doc-1', 'doc-3']);
		});

		it('should filter by tags (must match ALL tags)', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', tags: ['finance', 'q1', 'report'] }));
			await store.put(makeDoc({ documentId: 'doc-2', tags: ['finance'] }));
			await store.put(makeDoc({ documentId: 'doc-3', tags: ['finance', 'q1'] }));

			const results = await store.list({ tenantId: 'tenant-a', tags: ['finance', 'q1'] });

			expect(results).toHaveLength(2);
			expect(results.map((d) => d.documentId).sort()).toEqual(['doc-1', 'doc-3']);
		});

		it('should not match documents with no tags when filtering by tags', async () => {
			await store.put(makeDoc({ documentId: 'doc-1' }));

			const results = await store.list({ tenantId: 'tenant-a', tags: ['finance'] });

			expect(results).toHaveLength(0);
		});

		it('should respect limit', async () => {
			await store.put(makeDoc({ documentId: 'doc-1' }));
			await store.put(makeDoc({ documentId: 'doc-2' }));
			await store.put(makeDoc({ documentId: 'doc-3' }));

			const results = await store.list({ tenantId: 'tenant-a', limit: 2 });

			expect(results).toHaveLength(2);
		});

		it('should respect offset', async () => {
			await store.put(makeDoc({ documentId: 'doc-1' }));
			await store.put(makeDoc({ documentId: 'doc-2' }));
			await store.put(makeDoc({ documentId: 'doc-3' }));

			const results = await store.list({ tenantId: 'tenant-a', offset: 1, limit: 100 });

			expect(results).toHaveLength(2);
		});

		it('should respect both offset and limit together', async () => {
			for (let i = 1; i <= 5; i++) {
				await store.put(makeDoc({ documentId: `doc-${i}` }));
			}

			const results = await store.list({ tenantId: 'tenant-a', offset: 1, limit: 2 });

			expect(results).toHaveLength(2);
		});

		it('should default limit to 100', async () => {
			for (let i = 1; i <= 105; i++) {
				await store.put(makeDoc({ documentId: `doc-${i}` }));
			}

			const results = await store.list({ tenantId: 'tenant-a' });

			expect(results).toHaveLength(100);
		});

		it('should return defensive copies in list results', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', tags: ['original'] }));

			const results = await store.list({ tenantId: 'tenant-a' });
			expect(results).toHaveLength(1);
			results[0]?.tags?.push('mutated');

			const fresh = await store.list({ tenantId: 'tenant-a' });
			expect(fresh[0]?.tags).toEqual(['original']);
		});
	});

	describe('delete', () => {
		it('should return true when the document existed', async () => {
			await store.put(makeDoc());

			const result = await store.delete('doc-1', 'tenant-a');

			expect(result).toBe(true);
		});

		it('should return false when the document did not exist', async () => {
			const result = await store.delete('nonexistent', 'tenant-a');

			expect(result).toBe(false);
		});

		it('should remove the document from get and list', async () => {
			await store.put(makeDoc());
			await store.delete('doc-1', 'tenant-a');

			const getResult = await store.get('doc-1', 'tenant-a');
			const listResult = await store.list({ tenantId: 'tenant-a' });

			expect(getResult).toBeNull();
			expect(listResult).toHaveLength(0);
		});
	});

	describe('update', () => {
		it('should merge a partial patch into the existing document', async () => {
			await store.put(makeDoc({ chunkCount: 10, tags: ['old'] }));

			await store.update('doc-1', 'tenant-a', {
				chunkCount: 20,
				tags: ['new', 'updated'],
				updatedAt: '2025-06-01T00:00:00.000Z',
			});
			const result = await store.get('doc-1', 'tenant-a');

			expect(result?.chunkCount).toBe(20);
			expect(result?.tags).toEqual(['new', 'updated']);
			expect(result?.updatedAt).toBe('2025-06-01T00:00:00.000Z');
			expect(result?.sourceName).toBe('test.pdf');
		});

		it('should silently skip if the document is not found', async () => {
			await expect(store.update('nonexistent', 'tenant-a', { chunkCount: 99 })).resolves.toBeUndefined();
		});
	});

	describe('tenant isolation', () => {
		it('should treat the same documentId under different tenantIds as separate documents', async () => {
			const docA = makeDoc({ documentId: 'shared-id', tenantId: 'tenant-a', sourceName: 'a.pdf' });
			const docB = makeDoc({ documentId: 'shared-id', tenantId: 'tenant-b', sourceName: 'b.pdf' });

			await store.put(docA);
			await store.put(docB);

			const resultA = await store.get('shared-id', 'tenant-a');
			const resultB = await store.get('shared-id', 'tenant-b');

			expect(resultA?.sourceName).toBe('a.pdf');
			expect(resultB?.sourceName).toBe('b.pdf');
		});

		it('should not delete a document from another tenant', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', tenantId: 'tenant-a' }));
			await store.put(makeDoc({ documentId: 'doc-1', tenantId: 'tenant-b' }));

			await store.delete('doc-1', 'tenant-a');

			const resultA = await store.get('doc-1', 'tenant-a');
			const resultB = await store.get('doc-1', 'tenant-b');

			expect(resultA).toBeNull();
			expect(resultB).not.toBeNull();
		});

		it('should not update a document from another tenant', async () => {
			await store.put(makeDoc({ documentId: 'doc-1', tenantId: 'tenant-a', chunkCount: 10 }));
			await store.put(makeDoc({ documentId: 'doc-1', tenantId: 'tenant-b', chunkCount: 10 }));

			await store.update('doc-1', 'tenant-a', { chunkCount: 99 });

			const resultA = await store.get('doc-1', 'tenant-a');
			const resultB = await store.get('doc-1', 'tenant-b');

			expect(resultA?.chunkCount).toBe(99);
			expect(resultB?.chunkCount).toBe(10);
		});
	});
});
