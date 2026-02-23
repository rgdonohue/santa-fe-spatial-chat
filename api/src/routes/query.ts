/**
 * Query endpoint
 *
 * Canonical request: { query: StructuredQuery }
 * Backward-compatible request: StructuredQuery (deprecated)
 */

import { Hono } from 'hono';
import { validateQuery } from '../lib/orchestrator/validator';
import { QueryBuilder } from '../lib/orchestrator/builder';
import { getConnection, query } from '../lib/db/init';
import type { LayerRegistry } from '../lib/layers/registry';
import {
  applyQueryLimits,
  getQueryHash,
  getQuerySourceLayers,
  normalizeStructuredQuery,
  validateQueryAgainstRegistry,
} from '../lib/orchestrator/query-grounding';
import type { Database } from 'duckdb';
import type { FeatureCollection } from 'geojson';
import type { StructuredQuery } from '../../../shared/types/query';

// Store database instance (initialized on startup)
let dbInstance: Database | null = null;
let layerRegistry: LayerRegistry | null = null;

export function setDatabase(db: Database): void {
  dbInstance = db;
}

export function setLayerRegistry(registry: LayerRegistry): void {
  layerRegistry = registry;
}

function convertBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'bigint') {
      result[key] = Number.isSafeInteger(Number(value))
        ? Number(value)
        : value.toString();
    } else if (
      typeof value === 'string' &&
      (key === 'route_ids' || key === 'route_names' || key === 'restrictions')
    ) {
      try {
        const parsed = JSON.parse(value);
        result[key] = Array.isArray(parsed) ? parsed : value;
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function rowToFeature(row: Record<string, unknown>): GeoJSON.Feature {
  const { geometry, ...properties } = row;

  let geom: GeoJSON.Geometry;
  if (typeof geometry === 'string') {
    geom = JSON.parse(geometry) as GeoJSON.Geometry;
  } else if (typeof geometry === 'object' && geometry !== null) {
    geom = geometry as GeoJSON.Geometry;
  } else {
    throw new Error('Invalid geometry in result');
  }

  return {
    type: 'Feature',
    geometry: geom,
    properties: convertBigInts(properties),
  };
}

function extractStructuredQueryPayload(body: unknown): {
  payload: unknown;
  requestFormat: 'wrapped' | 'direct';
} {
  if (
    typeof body === 'object' &&
    body !== null &&
    'query' in body &&
    typeof (body as Record<string, unknown>).query === 'object'
  ) {
    return {
      payload: (body as { query: unknown }).query,
      requestFormat: 'wrapped',
    };
  }

  return { payload: body, requestFormat: 'direct' };
}

function buildValidationSuggestions(layerRegistryValue: LayerRegistry): string[] {
  const loaded = layerRegistryValue.loadedLayerNames;
  return [
    `Use only loaded layers: ${loaded.join(', ')}`,
    'Check field names from GET /api/layers',
    'Temporal queries are not supported yet',
  ];
}

const queryRoute = new Hono();

queryRoute.post('/', async (c) => {
  if (!dbInstance) {
    return c.json({ error: 'Database not initialized' }, 503);
  }
  if (!layerRegistry) {
    return c.json({ error: 'Layer registry not initialized' }, 503);
  }

  try {
    const body = await c.req.json();
    const { payload, requestFormat } = extractStructuredQueryPayload(body);

    const validatedQuery = validateQuery(payload);

    const normalized = normalizeStructuredQuery(validatedQuery);
    const issues = validateQueryAgainstRegistry(normalized.query, layerRegistry);
    if (issues.length > 0) {
      return c.json(
        {
          error: 'Query validation failed against loaded data',
          details: issues,
          suggestions: buildValidationSuggestions(layerRegistry),
          normalizationNotes: normalized.notes,
        },
        400
      );
    }

    const limitApplication = applyQueryLimits(normalized.query, layerRegistry);
    const executableQuery: StructuredQuery = limitApplication.query;

    const builder = new QueryBuilder(executableQuery, {
      simplifyToleranceDeg: limitApplication.simplifyToleranceDeg,
    });
    const { sql, params } = builder.build();

    const start = performance.now();
    const conn = await getConnection(dbInstance);
    const rows = await query<Record<string, unknown>>(conn, sql, ...params);
    const elapsed = performance.now() - start;

    const features = rows.map(rowToFeature);
    const result: FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    return c.json({
      ...result,
      metadata: {
        count: features.length,
        executionTimeMs: Math.round(elapsed * 100) / 100,
        query: executableQuery,
        queryHash: getQueryHash(executableQuery),
        sourceLayers: getQuerySourceLayers(executableQuery),
        truncated: limitApplication.truncated,
        maxFeaturesApplied: limitApplication.maxFeaturesApplied,
        hardCap: limitApplication.hardCap,
        defaultLimitApplied: limitApplication.defaultLimitApplied,
        simplifyToleranceDeg: limitApplication.simplifyToleranceDeg,
        normalizationNotes: normalized.notes,
        requestFormat,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ZodError') {
        return c.json(
          {
            error: 'Invalid query payload',
            details: error.message,
            expected: 'POST { "query": StructuredQuery }',
          },
          400
        );
      }

      const isBinderError =
        error.message.includes('Binder Error') ||
        error.message.includes('Referenced column');
      if (isBinderError) {
        return c.json(
          {
            error: 'Query references unavailable fields',
            message: error.message,
            suggestions: layerRegistry
              ? buildValidationSuggestions(layerRegistry)
              : [],
          },
          400
        );
      }

      return c.json(
        {
          error: 'Query execution failed',
          message: error.message,
        },
        500
      );
    }

    return c.json({ error: 'Unknown error' }, 500);
  }
});

export default queryRoute;
