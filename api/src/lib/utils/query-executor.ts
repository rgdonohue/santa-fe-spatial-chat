/**
 * Shared query execution pipeline.
 *
 * Both /api/chat and /api/query need to:
 *   normalize → validate → apply limits → build SQL → execute → format GeoJSON
 *
 * This module encapsulates that shared logic so route handlers
 * only deal with request parsing and response formatting.
 */

import { QueryBuilder } from '../orchestrator/builder';
import { getConnection, query } from '../db/init';
import { queryCache } from '../cache';
import {
  applyQueryLimits,
  getQueryHash,
  getQuerySourceLayers,
  normalizeStructuredQuery,
  validateQueryAgainstRegistry,
  type QueryValidationIssue,
} from '../orchestrator/query-grounding';
import type { LayerRegistry } from '../layers/registry';
import type { Database } from 'duckdb';
import type { FeatureCollection } from 'geojson';
import type { StructuredQuery } from '../../../../shared/types/query';
import { convertBigInts, rowToFeature } from './geojson';

/**
 * Result of the normalization + validation step.
 */
export interface PreparedQuery {
  /** The executable query after normalization and limit application */
  executableQuery: StructuredQuery;
  /** Stable hash for caching / debugging */
  queryHash: string;
  /** Layers touched by this query */
  sourceLayers: string[];
  /** Whether the result count was truncated */
  truncated: boolean;
  /** The max features cap that was applied */
  maxFeaturesApplied: number;
  /** Hard cap value */
  hardCap: number;
  /** Whether a default limit was injected */
  defaultLimitApplied: boolean;
  /** Simplification tolerance (degrees) */
  simplifyToleranceDeg?: number;
  /** Notes from the normalization step (e.g. field rewrites) */
  normalizationNotes: string[];
}

/**
 * Full execution result including timing and cache metadata.
 */
export interface ExecutionResult {
  result: FeatureCollection;
  executionTimeMs: number;
  queryCacheHit: boolean;
  prepared: PreparedQuery;
}

/**
 * Normalize, validate, and prepare a StructuredQuery for execution.
 *
 * @returns PreparedQuery on success
 * @throws Error with `validationIssues` property if registry validation fails
 */
export function prepareQuery(
  rawQuery: StructuredQuery,
  registry: LayerRegistry
): PreparedQuery {
  const normalized = normalizeStructuredQuery(rawQuery);
  const issues = validateQueryAgainstRegistry(normalized.query, registry);

  if (issues.length > 0) {
    const err = new Error('Query validation failed against loaded data');
    (err as Error & { validationIssues: QueryValidationIssue[] }).validationIssues = issues;
    (err as Error & { normalizationNotes: string[] }).normalizationNotes = normalized.notes;
    throw err;
  }

  const limitApplication = applyQueryLimits(normalized.query, registry);
  const executableQuery = limitApplication.query;

  return {
    executableQuery,
    queryHash: getQueryHash(executableQuery),
    sourceLayers: getQuerySourceLayers(executableQuery),
    truncated: limitApplication.truncated,
    maxFeaturesApplied: limitApplication.maxFeaturesApplied,
    hardCap: limitApplication.hardCap,
    defaultLimitApplied: limitApplication.defaultLimitApplied,
    simplifyToleranceDeg: limitApplication.simplifyToleranceDeg,
    normalizationNotes: normalized.notes,
  };
}

/**
 * Execute a prepared query against DuckDB, returning GeoJSON.
 * Checks the query cache first; populates it on miss.
 */
export async function executeQuery(
  prepared: PreparedQuery,
  db: Database,
  options?: { skipCache?: boolean }
): Promise<ExecutionResult> {
  // Check cache
  if (!options?.skipCache) {
    const cached = queryCache.get(prepared.queryHash);
    if (cached) {
      return {
        result: cached.result,
        executionTimeMs: cached.executionTimeMs,
        queryCacheHit: true,
        prepared,
      };
    }
  }

  // Build SQL
  const builder = new QueryBuilder(prepared.executableQuery, {
    simplifyToleranceDeg: prepared.simplifyToleranceDeg,
  });
  const { sql, params } = builder.build();

  // Execute
  const start = performance.now();
  const conn = getConnection(db);
  const rows = await query<Record<string, unknown>>(conn, sql, ...params);
  const executionTimeMs = performance.now() - start;

  // Format — aggregate queries have no geometry column
  const isAggregate = Boolean(prepared.executableQuery.aggregate);
  const features = isAggregate
    ? rows.map((row) => ({
        type: 'Feature' as const,
        geometry: null as unknown as GeoJSON.Geometry,
        properties: convertBigInts(row),
      }))
    : rows.map(rowToFeature);
  const result: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  // Cache
  queryCache.set(prepared.queryHash, { result, executionTimeMs });

  return {
    result,
    executionTimeMs,
    queryCacheHit: false,
    prepared,
  };
}
