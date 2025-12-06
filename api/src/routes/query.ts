/**
 * Query endpoint
 * 
 * Accepts structured queries and returns GeoJSON results
 */

import { Hono } from 'hono';
import { validateQuery } from '../lib/orchestrator/validator';
import { QueryBuilder } from '../lib/orchestrator/builder';
import { getConnection, query } from '../lib/db/init';
import type { Database } from 'duckdb';
import type { FeatureCollection } from 'geojson';

// Store database instance (will be initialized on startup)
let dbInstance: Database | null = null;

/**
 * Set the database instance (called on startup)
 */
export function setDatabase(db: Database): void {
  dbInstance = db;
}

/**
 * Convert BigInt values to numbers for JSON serialization
 */
function convertBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'bigint') {
      // Convert to number if it fits, otherwise string
      result[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert database row to GeoJSON feature
 */
function rowToFeature(row: Record<string, unknown>): GeoJSON.Feature {
  const { geometry, ...properties } = row;

  // Parse geometry if it's a string
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

const queryRoute = new Hono();

/**
 * POST /api/query
 * Execute a structured query and return GeoJSON results
 */
queryRoute.post('/', async (c) => {
  if (!dbInstance) {
    return c.json(
      { error: 'Database not initialized' },
      503
    );
  }

  try {
    const body = await c.req.json();

    // Validate query
    const structuredQuery = validateQuery(body);

    // Build SQL
    const builder = new QueryBuilder(structuredQuery);
    const { sql, params } = builder.build();

    // Execute query
    const start = performance.now();
    const conn = await getConnection(dbInstance);
    const rows = await query<Record<string, unknown>>(conn, sql, ...params);
    const elapsed = performance.now() - start;

    // Convert to GeoJSON
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
        query: structuredQuery,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      // Zod validation errors
      if (error.name === 'ZodError') {
        return c.json(
          {
            error: 'Invalid query',
            details: error.message,
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

    return c.json(
      {
        error: 'Unknown error',
      },
      500
    );
  }
});

export default queryRoute;

