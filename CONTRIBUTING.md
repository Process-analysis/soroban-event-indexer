# Contributing to soroban-event-indexer

Thank you for your interest in contributing to `soroban-event-indexer`! We welcome bug fixes, documentation improvements, performance optimizations, and feature enhancements.

## Code of Conduct

All contributors are expected to uphold the [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior through GitHub moderation channels.

## Development Setup

### Prerequisites
- Node.js 20+ (Node.js 20, 22, or 24 LTS recommended)
- `pnpm` (v9+) or `npm` (v10+)
- C/C++ compiler toolchain (for compiling SQLite bindings)
- Optional: PostgreSQL 14+ for running the Postgres storage test suite (`TEST_DATABASE_URL`)

### Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<OWNER>/soroban-event-indexer.git
   cd soroban-event-indexer
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   pnpm run build
   ```

4. Run the test suite:
   ```bash
   pnpm test
   ```

## Branch and Commit Conventions

- Use descriptive branch names prefixed with the type of change:
  - `feature/<name>` for new features
  - `fix/<name>` for bug fixes
  - `docs/<name>` for documentation updates
  - `chore/<name>` for tooling and dependency maintenance
- We enforce [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat: add postgres connection retry backoff`
  - `fix: handle null address in scval decoder`
  - `test: add property test for batch deduplication`
  - `docs: update quickstart for sqlite custom path`
  - `chore: bump dependencies`

## Testing Guidelines

- **Unit Tests**: Place in `tests/*.test.ts`. Cover happy paths, error paths, and edge cases.
- **Store Contract Tests**: If modifying `Store` or storage adapters, run the shared store contract suite (`tests/storage.test.ts`).
- **Postgres Tests**: Run with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/test_indexer pnpm test`.
- **Property-based Tests**: We use `fast-check` to test state invariants across random permutations.
- Ensure all tests pass with zero warnings:
  ```bash
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  pnpm test
  ```

## Pull Request Checklist

Before opening a pull request, please verify:
- [ ] Code builds without errors (`pnpm run build`).
- [ ] TypeScript passes in strict mode (`pnpm run typecheck`).
- [ ] Linter and formatter checks pass (`pnpm run lint && pnpm run format:check`).
- [ ] All unit, integration, and property-based tests pass (`pnpm test`).
- [ ] New functionality includes corresponding unit/integration tests.
- [ ] Documentation (`README.md`, `docs/`) is updated if public APIs or config options change.
- [ ] No temporary, scratch, or credential files are committed.
