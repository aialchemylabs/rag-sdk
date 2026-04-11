# Contributing to @aialchemy/rag-sdk

Thanks for your interest in contributing. This guide covers the essentials.

## Prerequisites

- Node.js >= 22 (see `.nvmrc`)
- pnpm 10+ (enforced -- do not use npm or yarn)

## Development Setup

```bash
git clone https://github.com/aialchemy/rag-sdk.git
cd rag-sdk
pnpm install
pnpm run build
```

Verify everything works:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

## Scripts

| Command                | Purpose                      |
| ---------------------- | ---------------------------- |
| `pnpm run build`       | Build with tsup              |
| `pnpm run typecheck`   | Type-check with tsc --noEmit |
| `pnpm run lint`        | Lint with Biome              |
| `pnpm run lint:fix`    | Lint and auto-fix with Biome |
| `pnpm run format`      | Format with Biome            |
| `pnpm run test`        | Run tests with Vitest        |
| `pnpm run test:watch`  | Run tests in watch mode      |

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

- **TypeScript strict mode** -- all strict flags enabled, plus `noUncheckedIndexedAccess`
- **Indentation:** tabs
- **Quotes:** single quotes
- **Semicolons:** always
- **Trailing commas:** all
- **Line width:** 120
- **Module format:** ESM-only (`import`/`export`, no `require`)

Run `pnpm run lint:fix` and `pnpm run format` before committing.

## Code Organization

```
src/
  feature/
    featureName.ts          # Implementation
    featureName.types.ts    # Types and interfaces
    featureName.test.ts     # Tests (colocated)
    index.ts                # Public exports for the module
```

- **Types** go in colocated `.types.ts` files.
- **Tests** go in colocated `.test.ts` files next to the code they test.
- **Exports** are re-exported through `index.ts` barrel files.

## Naming Conventions

| Element     | Convention          | Example                  |
| ----------- | ------------------- | ------------------------ |
| Files       | camelCase           | `documentLoader.ts`      |
| Classes     | PascalCase          | `DocumentLoader`         |
| Interfaces  | PascalCase          | `ChunkingConfig`         |
| Functions   | camelCase           | `parseDocument`          |
| Constants   | SCREAMING_SNAKE     | `MAX_FILE_SIZE`          |
| Type files  | camelCase.types.ts  | `embeddings.types.ts`    |
| Test files  | camelCase.test.ts   | `embeddings.test.ts`     |

## Testing

Tests use [Vitest](https://vitest.dev/) and follow the **Arrange-Act-Assert** pattern:

```typescript
import { describe, expect, it } from 'vitest';

describe('parseDocument', () => {
  it('should extract text from a valid PDF buffer', () => {
    // Arrange
    const buffer = createTestPdfBuffer();

    // Act
    const result = parseDocument(buffer);

    // Assert
    expect(result.text).toContain('expected content');
  });
});
```

Run the full suite with `pnpm run test`. Use `pnpm run test:watch` during development.

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add DOCX chunking support
fix: handle empty embedding response from OpenAI
docs: update retrieval configuration examples
test: add integration tests for Qdrant indexer
refactor: extract shared validation logic
chore: bump vitest to v4
```

Keep commits focused on a single change. Write the subject in imperative mood, lowercase, no trailing period.

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes, ensuring all checks pass:
   ```bash
   pnpm run typecheck && pnpm run lint && pnpm run test
   ```
3. Push your branch and open a pull request against `main`.
4. Fill in the PR description: summarize the change, link related issues, and note any breaking changes.
5. Address review feedback with new commits (do not force-push during review).
6. A maintainer will merge once approved and CI is green.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
