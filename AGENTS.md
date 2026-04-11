# AGENTS.md

## Project Mission

`@aialchemy/rag-sdk` is a TypeScript-first, production-oriented RAG SDK for document ingestion, OCR, chunking, embeddings, indexing, retrieval, and answer generation. It standardizes the full document RAG pipeline under a single installable package, targeting backend engineers who need trust-first outputs, auditable retrieval, and tenant-aware isolation.

---

## Locked V1 Decisions

The following decisions are fixed and must not be revisited without an explicit ADR:

- **OCR provider:** Mistral OCR (mandatory, no fallback abstraction in V1)
- **Vector database:** Qdrant (mandatory, no alternative backend in V1)
- **Public package:** single package `@aialchemy/rag-sdk` on npmjs
- **Collection strategy:** per-tenant collections with strict metadata filters
- **Answer trust policy:** no-citation-no-claim -- answers must include citation anchors when retrieval is used; unsupported claims must be refused or downgraded
- **SDK key:** removed in v0.1.0 — no SDK key required for initialization

---

## Package and Tooling Non-Negotiables

- **Package manager:** pnpm (enforced via `packageManager` field)
- **Language:** TypeScript, strict mode
- **Linter/formatter:** Biome
- **Module format:** ESM-first (`"type": "module"`)
- **Node version:** 22+ (enforced via `engines`)
- **Build tool:** tsup
- **Test runner:** Vitest
- **Runtime validation:** Zod for config and public option parsing

---

## Public API Stability Rules

- Keep the public API surface small: `createRag` factory plus core types
- Do not add new top-level exports without reviewing the requirement
- Do not break V1 consumers -- treat config schema, chunk metadata schema, citation output schema, and answer result schema as stability boundaries
- Avoid deep-import culture: consumers should only import from the package root
- Prefer additive, optional fields over breaking changes

---

## Approved Reuse from `references/`

The `references/` directory contains prior implementation patterns from a related project. The following reuse rules apply:

- **Approved:** algorithm patterns, pipeline sequencing logic, chunking strategies, retrieval scoring approaches
- **Not approved:** Express route layout, SSE streaming architecture, HTTP server structure, middleware patterns
- Reference code must be adapted to fit the SDK's internal architecture, not copied wholesale

---

## Execution Order for Agents

Implementation should proceed in this order. Each phase depends on the previous:

1. **Foundation** -- project setup, config validation, `createRag` factory, error types, telemetry hooks
2. **OCR / Normalize / Chunking** -- Mistral OCR integration, output normalization, chunking engine with metadata
3. **Embeddings / Vector / Retrieval** -- embedding provider abstraction, Qdrant client, upsert/retrieval, metadata filtering
4. **Jobs / Answering** -- async job tracking, answer generation with citations, no-citation-no-claim enforcement
5. **Docs** -- README, examples, CHANGELOG, migration notes

Do not jump ahead. Each phase must have passing tests before the next begins.

---

## Guardrails

Every agent and contributor must enforce these constraints:

- **No deep-import sprawl:** all public API must be exported from the package root; no `@aialchemy/rag-sdk/internal/*` paths
- **No raw Mistral payload leaks:** OCR output must be normalized into the SDK's internal model before reaching consumers
- **No tenant filter bypass:** if tenancy is configured, retrieval and deletion must always include tenant scoping; silent omission is a bug
- **No missing citation metadata:** every indexed chunk must carry document ID, source name, page range, chunk ID, and embedding version; incomplete metadata is a bug
- **No secret logging:** API keys, tokens, and credentials must never appear in logs or error details
- **No untyped errors:** all errors returned to consumers must use the SDK's typed error hierarchy
