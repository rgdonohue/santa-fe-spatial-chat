# Repository Guidelines

## Project Structure & Module Organization
- `docs/`: Architecture, build plan, data sources, learning/quick-start guides.
- `api/`: Backend (Hono/TypeScript), orchestrator, LLM client, DuckDB integration.
- `web/`: Frontend (React/TypeScript/Vite/MapLibre).
- `shared/`: Shared types (query/api/geo).
- `scripts/`: Data prep, seeding, test queries.
- `api/data/`: GeoParquet/manifest for layers.

## Build, Test, and Development Commands
- `npm run dev` (api): Start Hono dev server (default :3000).
- `npm run dev` (web): Start Vite dev server (default :5173).
- `npm run typecheck`: TypeScript check with `strict` enabled.
- `npm run lint`: ESLint/Prettier pass.
- `npm test` or `npm run test` (api/web): Run unit/integration tests (Vitest if configured).

## Coding Style & Naming Conventions
- TypeScript everywhere; `strict` + `noUncheckedIndexedAccess` + `noImplicitReturns`.
- Prefer NodeNext/ESM in API; React with functional components/hooks in web.
- Linting: ESLint with `@typescript-eslint` and Prettier; no `any` (errors), unused vars warn.
- Naming: kebab-case for files, PascalCase for React components/types, camelCase for vars/functions.
- Geometry fields: use `geom_4326` (display/intersects) and `geom_utm13` (metric ops).

## Testing Guidelines
- Framework: Vitest (api/web).
- Place tests under `api/tests` or `web/tests`; name as `*.test.ts`/`*.test.tsx`.
- Cover query builder logic (attribute/spatial/aggregate/temporal), LLM parsing validation, and UI interactions.
- Target: fast-running suite; aim for high coverage on orchestrator/query builder paths.

## Commit & Pull Request Guidelines
- Commits: concise, imperative (“Add CRS validation”, “Fix query builder aggregation”).
- PRs: include summary, linked issue (if any), tests run, and screenshots/GIFs for UI changes.
- Keep diffs focused; avoid bundling unrelated formatting. Honor existing docs and do not overwrite them without intent.

## Architecture Overview (Brief)
- Constrained `StructuredQuery` with attribute/spatial filters, optional aggregates/temporal, validated via Zod.
- Query builder chooses `geom_utm13` for metric ops and `geom_4326` for intersects/contains.
- LLM-driven NL → StructuredQuery, with validation and equity-aware explanations.

## Security & Configuration Tips
- Enforce CRS on ingest; reject unknown SRIDs.
- Guard `/api/chat` and `/api/query` with rate limits, CORS, and API key in production.
- Cap result size, distance, and limit params; log `queryHash` and latencies for observability.
