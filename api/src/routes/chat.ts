/**
 * Chat endpoint
 *
 * Natural language → StructuredQuery → SQL → GeoJSON
 * Full orchestration flow with LLM parsing
 *
 * Features:
 * - LRU caching for parse results and query results
 * - Performance metrics tracking
 */

import { Hono } from 'hono';
import { OllamaClient } from '../lib/llm';
import { IntentParser } from '../lib/orchestrator/parser';
import { QueryBuilder } from '../lib/orchestrator/builder';
import { getConnection, query } from '../lib/db/init';
import {
  parseCache,
  queryCache,
  structuredQueryKey,
  getCacheStats,
} from '../lib/cache';
import type { Database } from 'duckdb';
import type { ParseResult } from '../lib/orchestrator/parser';
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

const chatRoute = new Hono();

// Initialize LLM client (singleton)
const llmClient = new OllamaClient();
const parser = new IntentParser(llmClient);

/**
 * POST /api/chat
 * Process natural language query and return results with explanation
 */
chatRoute.post('/', async (c) => {
  if (!dbInstance) {
    return c.json(
      { error: 'Database not initialized' },
      503
    );
  }

  try {
    const body = await c.req.json() as { message: string };
    
    if (!body.message || typeof body.message !== 'string') {
      return c.json(
        { error: 'Missing or invalid message field' },
        400
      );
    }

    // 1. Parse natural language to structured query (with caching)
    let parseResult: ParseResult;
    let parseTimeMs = 0;
    let parseCacheHit = false;

    // Check parse cache first
    const cachedParse = parseCache.get(body.message);
    if (cachedParse) {
      parseResult = cachedParse;
      parseCacheHit = true;
    } else {
      try {
        const parseStart = performance.now();
        parseResult = await parser.parse(body.message);
        parseTimeMs = performance.now() - parseStart;

        // Cache successful parse
        parseCache.set(body.message, parseResult);
      } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
      
      // Check if it's a connection error
      if (errorMessage.includes('Cannot connect to Ollama')) {
        return c.json(
          {
            error: 'LLM service unavailable',
            message: 'Cannot connect to Ollama. Is it running?',
            suggestions: [
              'Make sure Ollama is installed and running',
              'Check that the model is pulled: ollama pull qwen2.5:7b',
            ],
          },
          503
        );
      }

        return c.json(
          {
            error: 'Could not understand query',
            message: errorMessage,
            suggestions: [
              'Try: "Show residential parcels"',
              'Try: "Parcels near the river"',
              'Try: "Census tracts with low income"',
            ],
          },
          400
        );
      }
    }

    const { query: structuredQuery, confidence } = parseResult;

    // 2. Check query result cache
    const queryKey = structuredQueryKey(structuredQuery);
    const cachedResult = queryCache.get(queryKey);
    let queryCacheHit = false;
    let result: FeatureCollection;
    let executionTimeMs = 0;

    if (cachedResult) {
      result = cachedResult.result;
      executionTimeMs = cachedResult.executionTimeMs;
      queryCacheHit = true;
    } else {
      // 3. Build and execute SQL query
      const builder = new QueryBuilder(structuredQuery);
      const { sql, params } = builder.build();

      const start = performance.now();
      const conn = await getConnection(dbInstance);
      const rows = await query<Record<string, unknown>>(conn, sql, ...params);
      executionTimeMs = performance.now() - start;

      // Convert to GeoJSON
      const features = rows.map(rowToFeature);

      result = {
        type: 'FeatureCollection',
        features,
      };

      // Cache result
      queryCache.set(queryKey, { result, executionTimeMs });
    }

    // 4. Generate simple explanation (for now, just return metadata)
    // TODO: Add ResultExplainer in Week 6
    const explanation = `Found ${result.features.length} result${result.features.length !== 1 ? 's' : ''} for your query.`;

    return c.json({
      query: structuredQuery,
      result,
      explanation,
      confidence,
      metadata: {
        count: result.features.length,
        executionTimeMs: Math.round(executionTimeMs * 100) / 100,
        parseTimeMs: Math.round(parseTimeMs * 100) / 100,
        cache: {
          parseHit: parseCacheHit,
          queryHit: queryCacheHit,
        },
      },
    });
  } catch (error) {
    if (error instanceof Error) {
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

/**
 * GET /api/chat/stats
 * Return cache statistics
 */
chatRoute.get('/stats', (c) => {
  return c.json({
    cache: getCacheStats(),
  });
});

export default chatRoute;

