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

import { resetState, baseConfig, qdrantCollections } from './e2eHelpers.js';
import { createRag } from '../src/createRag.js';
import type { RagClient } from '../src/createRag.js';

beforeEach(() => {
	resetState();
});

describe('Multi-Tenant Isolation', () => {
	let rag: RagClient;

	beforeEach(async () => {
		rag = await createRag(baseConfig({ qdrant: { url: 'http://localhost:6333', collection: 'test-mt' } }));

		await rag.ingest.text('Tenant Alpha confidential document about machine learning.', {
			security: { tenantId: 'tenant-alpha' },
			tags: ['alpha-doc'],
		});

		await rag.ingest.text('Tenant Beta confidential document about data engineering.', {
			security: { tenantId: 'tenant-beta' },
			tags: ['beta-doc'],
		});
	});

	it('creates separate collections per tenant', () => {
		expect(qdrantCollections.has('test-mt_tenant-alpha')).toBe(true);
		expect(qdrantCollections.has('test-mt_tenant-beta')).toBe(true);
	});

	it('retrieval for tenant-alpha returns only its documents', async () => {
		const result = await rag.retrieve('machine learning', {
			security: { tenantId: 'tenant-alpha' },
		});

		expect(result.matches.length).toBeGreaterThan(0);
		for (const match of result.matches) {
			expect(match.metadata.tenantId).toBe('tenant-alpha');
		}
	});

	it('retrieval for tenant-beta does not return tenant-alpha docs', async () => {
		const result = await rag.retrieve('machine learning', {
			security: { tenantId: 'tenant-beta' },
		});

		for (const match of result.matches) {
			expect(match.metadata.tenantId).not.toBe('tenant-alpha');
		}
	});

	it('delete for tenant-alpha does not affect tenant-beta', async () => {
		const alphaDoc = await rag.documents.list({ tenantId: 'tenant-alpha' });
		expect(alphaDoc.length).toBeGreaterThan(0);

		await rag.documents.delete(alphaDoc[0]!.documentId, 'tenant-alpha');

		const betaDocs = await rag.documents.list({ tenantId: 'tenant-beta' });
		expect(betaDocs.length).toBeGreaterThan(0);
	});

	it('documents.list scoped by tenant', async () => {
		const alphaDocs = await rag.documents.list({ tenantId: 'tenant-alpha' });
		const betaDocs = await rag.documents.list({ tenantId: 'tenant-beta' });

		expect(alphaDocs.length).toBeGreaterThan(0);
		expect(betaDocs.length).toBeGreaterThan(0);

		for (const doc of alphaDocs) {
			expect(doc.tenantId).toBe('tenant-alpha');
		}
		for (const doc of betaDocs) {
			expect(doc.tenantId).toBe('tenant-beta');
		}
	});
});
