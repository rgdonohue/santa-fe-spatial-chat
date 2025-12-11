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
import type { StructuredQuery } from '../../../shared/types/query';

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
 * Also parses JSON strings back to arrays for fields like route_ids/route_names
 */
function convertBigInts(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'bigint') {
      // Convert to number if it fits, otherwise string
      result[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    } else if (
      typeof value === 'string' &&
      (key === 'route_ids' || key === 'route_names' || key === 'restrictions')
    ) {
      // Parse JSON strings back to arrays for array fields
      try {
        const parsed = JSON.parse(value);
        result[key] = Array.isArray(parsed) ? parsed : value;
      } catch {
        // If parsing fails, keep as string
        result[key] = value;
      }
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

/**
 * Generate a human-readable explanation of the query results
 */
function generateExplanation(query: StructuredQuery, count: number): string {
  const parts: string[] = [];

  // Describe the layer
  const layerNames: Record<string, string> = {
    parcels: 'parcels',
    building_footprints: 'buildings',
    short_term_rentals: 'short-term rentals',
    transit_access: 'transit stops',
    zoning_districts: 'zoning districts',
    census_tracts: 'census tracts',
    hydrology: 'water features (arroyos)',
  };
  const layerName = layerNames[query.selectLayer] || query.selectLayer;

  // Build filter description
  const filterParts: string[] = [];
  if (query.attributeFilters && query.attributeFilters.length > 0) {
    const opNames: Record<string, string> = {
      eq: 'equal to',
      neq: 'not equal to',
      gt: 'greater than',
      gte: 'at least',
      lt: 'less than',
      lte: 'at most',
      like: 'matching',
      in: 'in',
    };

    for (const filter of query.attributeFilters) {
      const fieldName = filter.field.replace(/_/g, ' ');
      const opName = opNames[filter.op] || filter.op;
      filterParts.push(`${fieldName} ${opName} ${filter.value}`);
    }
  }

  // Build spatial description
  if (query.spatialFilters && query.spatialFilters.length > 0) {
    for (const filter of query.spatialFilters) {
      const targetName = layerNames[filter.targetLayer] || filter.targetLayer;
      if (filter.op === 'within_distance') {
        filterParts.push(`within ${filter.distance}m of ${targetName}`);
      } else if (filter.op === 'intersects') {
        filterParts.push(`intersecting ${targetName}`);
      } else {
        filterParts.push(`${filter.op} ${targetName}`);
      }
    }
  }

  // Compose explanation
  if (filterParts.length > 0) {
    const logic = query.attributeLogic === 'or' ? ' or ' : ' and ';
    parts.push(`Found ${count} ${layerName} where ${filterParts.join(logic)}.`);
  } else {
    parts.push(`Found ${count} ${layerName}.`);
  }

  return parts.join(' ');
}

/**
 * Generate dynamic error suggestions based on available layers
 */
function generateDynamicSuggestions(availableLayers: string[]): string[] {
  const suggestions: string[] = [];

  if (availableLayers.includes('parcels')) {
    suggestions.push('Try: "Show residential parcels"');
    suggestions.push('Try: "Parcels with assessed value over $500,000"');
  }
  if (availableLayers.includes('building_footprints')) {
    suggestions.push('Try: "Show buildings taller than 30 feet"');
    suggestions.push('Try: "Buildings built after 2020"');
  }
  if (availableLayers.includes('short_term_rentals')) {
    suggestions.push('Try: "Show short-term rentals"');
    suggestions.push('Try: "STR permits issued in 2024"');
  }
  if (availableLayers.includes('transit_access')) {
    suggestions.push('Try: "Show transit stops"');
    suggestions.push('Try: "Transit stops near affordable housing"');
  }
  if (availableLayers.includes('census_tracts')) {
    suggestions.push('Try: "Show census tracts by income"');
    suggestions.push('Try: "Census tracts with low income"');
  }
  if (availableLayers.includes('zoning_districts')) {
    suggestions.push('Try: "Show residential zones"');
  }
  if (availableLayers.includes('hydrology')) {
    suggestions.push('Try: "Show the hydrology network"');
  }

  // Fallback if no layers loaded
  if (suggestions.length === 0) {
    suggestions.push('No data layers currently loaded');
  }

  return suggestions.slice(0, 3); // Max 3 suggestions
}

const chatRoute = new Hono();

// Initialize LLM client (singleton)
const llmClient = new OllamaClient();
const parser = new IntentParser(llmClient);

/**
 * Set available layers for the parser
 * This restricts queries to only layers that exist in the database
 */
export function setAvailableLayers(layers: string[]): void {
  parser.setAvailableLayers(layers);
  console.log(`  Parser configured with layers: ${layers.join(', ')}`);
}

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

        // Generate dynamic suggestions based on available layers
        const availableLayers = parser.getAvailableLayers();
        const suggestions = generateDynamicSuggestions(availableLayers);

        return c.json(
          {
            error: 'Could not understand query',
            message: errorMessage,
            suggestions,
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

    // 4. Generate explanation based on query structure
    const explanation = generateExplanation(structuredQuery, result.features.length);

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
      const message = error.message;

      // Check for missing table error
      if (message.includes('Table with name') && message.includes('does not exist')) {
        const tableMatch = message.match(/Table with name (\w+) does not exist/);
        const missingTable = tableMatch?.[1] || 'unknown';
        const availableLayers = parser.getAvailableLayers();

        return c.json(
          {
            error: 'Data not available',
            message: `The "${missingTable}" data layer is not currently loaded.`,
            availableLayers,
            suggestions: [
              `Currently available: ${availableLayers.join(', ')}`,
              'Try asking about parcels, buildings, zoning districts, census tracts, or hydrology',
              'Example: "Show residential parcels" or "Show census tracts with high renter percentage"',
            ],
          },
          400
        );
      }

      return c.json(
        {
          error: 'Query execution failed',
          message,
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

