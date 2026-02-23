# Project Status Report

**Date**: February 23, 2026  
**Scope**: NL-to-data grounding hardening + truthful map/query behavior

## Current Summary

The project has moved beyond early "Week 5 readiness" and now runs with:

- 13 loaded spatial layers from `api/data/manifest.json`
- Runtime layer registry (manifest + table introspection)
- Strict grounding behavior for unsupported intents (no silent fallback substitution)
- Canonical `/api/query` payload contract with backward compatibility
- Query-level caps/defaults + truncation metadata
- Geometry-aware selected-feature highlighting on the map

## What Is Implemented

### API Grounding + Contracts

- `/api/query` now accepts canonical payload: `{ "query": StructuredQuery }`
- Backward compatibility for direct-body `StructuredQuery` is retained temporarily
- Query normalization added (zoning boolean aliases mapped to executable filters)
- Registry-backed validation prevents binder failures from missing fields/layers
- Temporal query requests are explicitly rejected as unsupported

### Layer Availability Signaling

- `/api/layers` now returns runtime-aware layer metadata:
  - `name`
  - `schemaFields`
  - `isLoaded`
  - `loadedFields`
  - `featureCount`
  - `geometryType`

### Chat Grounding

- Added deterministic intent grounding pass before LLM parsing
- Unsupported or partial requests return explicit grounding feedback:
  - `status`: `exact_match | partial_match | unsupported`
  - `requestedConcepts`, `missingConcepts`, `missingLayers`
- Parser prompt now forbids invented layers/fields and disallows fallback substitution

### Query Performance + Metadata

- Default per-geometry limits added when user omits `limit`
- Hard caps enforce upper bounds for payload safety
- Response metadata includes:
  - `queryHash`
  - `sourceLayers`
  - `truncated`
  - `maxFeaturesApplied`
  - `hardCap`
  - `defaultLimitApplied`

### Frontend Truthfulness Updates

- Selected-feature visualization now works across:
  - polygons (fill + outline)
  - lines
  - points (halo/circle emphasis)
- Results panel now shows provenance/grounding metadata:
  - grounding status
  - missing layers (when relevant)
  - source layers
  - query hash
  - truncation notices
- Map legend now has:
  - choropleth units when available
  - standardized default legend for non-choropleth queries

### Test Coverage Added

- `api/tests/intent-router.test.ts`
- `api/tests/query-grounding.test.ts`

All API tests currently pass.

## Known Manual Roadblocks

The following remain human/data-governance dependent:

1. `affordable_housing_units` acquisition and licensing confirmation
2. `eviction_filings` legal/privacy policy and anonymization workflow
3. School attendance polygons (`school_zones`) from district source
4. `wildfire_risk` source decision (raster workflow + parcel linkage policy)
5. Vacancy derivation policy (`vacancy_status`) across assessor/USPS signals

## Validation Snapshot

- `api`: typecheck passes
- `api`: lint passes
- `api`: tests pass (37 tests)
- `web`: typecheck passes
- `web`: lint passes

## Immediate Next Work

1. Add route-level integration tests for `/api/chat`, `/api/query`, `/api/layers`, `/api/templates` with fixture DB.
2. Implement richer deterministic intent router scoring + disambiguation prompts for boundary/place references.
3. Add explicit export/provenance UX for GeoJSON/CSV with query + data vintage metadata.
4. Consolidate data prep pipeline usage around a single authoritative script path and document it in `README.md`.
