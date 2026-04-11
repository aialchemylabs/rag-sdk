import type { DocumentStore, DocumentStoreListFilters, StoredDocument } from './documentStore.types.js';

function clone(doc: StoredDocument): StoredDocument {
	return structuredClone(doc);
}

/**
 * In-memory document store using a Map.
 *
 * **WARNING: All data is lost on process restart.** This store is intended for
 * development, testing, and short-lived SDK instances only. Do NOT use in
 * production without replacing it with a persistent {@link DocumentStore}
 * implementation backed by a database (e.g. PostgreSQL, Redis, DynamoDB).
 *
 * Pass your custom store via `createRag({ documentStore: myStore })`.
 */
export class InMemoryDocumentStore implements DocumentStore {
	private readonly docs = new Map<string, StoredDocument>();

	private key(documentId: string, tenantId: string): string {
		return `${tenantId}::${documentId}`;
	}

	async put(doc: StoredDocument): Promise<void> {
		this.docs.set(this.key(doc.documentId, doc.tenantId), clone(doc));
	}

	async get(documentId: string, tenantId: string): Promise<StoredDocument | null> {
		const doc = this.docs.get(this.key(documentId, tenantId));
		return doc ? clone(doc) : null;
	}

	async list(filters: DocumentStoreListFilters): Promise<StoredDocument[]> {
		let results: StoredDocument[] = [];

		for (const doc of this.docs.values()) {
			if (doc.tenantId !== filters.tenantId) continue;
			if (filters.domainId && doc.domainId !== filters.domainId) continue;
			if (filters.tags && filters.tags.length > 0) {
				const docTags = doc.tags ?? [];
				const hasAllTags = filters.tags.every((tag) => docTags.includes(tag));
				if (!hasAllTags) continue;
			}
			results.push(clone(doc));
		}

		const offset = filters.offset ?? 0;
		const limit = filters.limit ?? 100;
		results = results.slice(offset, offset + limit);

		return results;
	}

	async delete(documentId: string, tenantId: string): Promise<boolean> {
		return this.docs.delete(this.key(documentId, tenantId));
	}

	async update(documentId: string, tenantId: string, patch: Partial<StoredDocument>): Promise<void> {
		const key = this.key(documentId, tenantId);
		const existing = this.docs.get(key);
		if (!existing) return;
		this.docs.set(key, { ...existing, ...patch });
	}
}
