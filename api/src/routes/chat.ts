/**
 * Chat endpoint
 *
 * Natural language -> grounding -> StructuredQuery -> SQL -> GeoJSON
 */

import { Hono } from 'hono';
import { OllamaClient } from '../lib/llm';
import { IntentParser } from '../lib/orchestrator/parser';
import { QueryBuilder } from '../lib/orchestrator/builder';
import { getConnection, query } from '../lib/db/init';
import {
  parseCache,
  queryCache,
  getCacheStats,
} from '../lib/cache';
import type { LayerRegistry } from '../lib/layers/registry';
import type { Database } from 'duckdb';
import type { ParseResult } from '../lib/orchestrator/parser';
import type { FeatureCollection } from 'geojson';
import type { StructuredQuery } from '../../../shared/types/query';
import {
  applyQueryLimits,
  getQueryHash,
  getQuerySourceLayers,
  normalizeStructuredQuery,
  validateQueryAgainstRegistry,
} from '../lib/orchestrator/query-grounding';
import {
  assessGroundingRequest,
  type GroundingAssessment,
} from '../lib/orchestrator/intent-router';

let dbInstance: Database | null = null;
let layerRegistry: LayerRegistry | null = null;

const chatRoute = new Hono();

const llmClient = new OllamaClient();
const parser = new IntentParser(llmClient);

export function setDatabase(db: Database): void {
  dbInstance = db;
}

export function setLayerRegistry(registry: LayerRegistry): void {
  layerRegistry = registry;
  parser.setAvailableLayers(registry.loadedLayerNames);
  parser.setAvailableLayerFields(
    Object.fromEntries(
      Object.values(registry.layers).map((layer) => [layer.name, layer.queryableFields])
    )
  );
  console.log(`  Parser configured with layers: ${registry.loadedLayerNames.join(', ')}`);
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

function generateExplanation(query: StructuredQuery, count: number): string {
  const layerNames: Record<string, string> = {
    parcels: 'parcels',
    building_footprints: 'buildings',
    short_term_rentals: 'short-term rentals',
    transit_access: 'transit stops',
    zoning_districts: 'zoning districts',
    census_tracts: 'census tracts',
    hydrology: 'water features',
    flood_zones: 'flood zones',
    neighborhoods: 'neighborhoods',
    parks: 'parks',
    bikeways: 'bikeways',
    historic_districts: 'historic districts',
    city_limits: 'city limits',
  };

  const attributeParts: string[] = [];
  const spatialParts: string[] = [];
  const layerName = layerNames[query.selectLayer] || query.selectLayer;

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
      attributeParts.push(
        `${filter.field.replace(/_/g, ' ')} ${opNames[filter.op] || filter.op} ${filter.value}`
      );
    }
  }

  if (query.spatialFilters && query.spatialFilters.length > 0) {
    for (const filter of query.spatialFilters) {
      const targetName = layerNames[filter.targetLayer] || filter.targetLayer;
      if (filter.op === 'within_distance') {
        spatialParts.push(`within ${filter.distance}m of ${targetName}`);
      } else if (filter.op === 'nearest') {
        spatialParts.push(`nearest ${filter.limit} to ${targetName}`);
      } else {
        spatialParts.push(`${filter.op} ${targetName}`);
      }
    }
  }

  const segments: string[] = [];
  if (attributeParts.length > 0) {
    const attributeLogic = (query.attributeLogic ?? 'and').toUpperCase();
    segments.push(attributeParts.join(` ${attributeLogic} `));
  }
  if (spatialParts.length > 0) {
    const spatialLogic = (query.spatialLogic ?? 'and').toUpperCase();
    segments.push(spatialParts.join(` ${spatialLogic} `));
  }

  if (segments.length === 0) {
    return `Found ${count} ${layerName}.`;
  }

  return `Found ${count} ${layerName} where ${segments.join(' AND ')}.`;
}

function generateDynamicSuggestions(availableLayers: string[]): string[] {
  const suggestions: string[] = [];

  if (availableLayers.includes('parcels')) {
    suggestions.push('Try: "Show parcels with assessed value over 500000"');
  }
  if (availableLayers.includes('zoning_districts')) {
    suggestions.push('Try: "Show zoning districts with zone_code like R%"');
  }
  if (availableLayers.includes('census_tracts')) {
    suggestions.push('Try: "Show census tracts with median income below 50000"');
  }
  if (availableLayers.includes('hydrology')) {
    suggestions.push('Try: "Parcels within 200 meters of hydrology"');
  }

  if (suggestions.length === 0) {
    suggestions.push('No data layers are currently loaded.');
  }

  return suggestions.slice(0, 3);
}

function unsupportedResponse(
  grounding: GroundingAssessment,
  availableLayers: string[]
): {
  error: string;
  message: string;
  grounding: GroundingAssessment;
  availableLayers: string[];
  suggestions: string[];
} {
  const missing = grounding.missingLayers.join(', ');
  const requested = grounding.requestedConcepts.join(', ');
  const reason =
    grounding.status === 'unsupported'
      ? `This request requires unavailable dataset(s): ${missing}`
      : `This request is only partially supported. Missing dataset(s): ${missing}`;

  return {
    error:
      grounding.status === 'unsupported'
        ? 'Unsupported request for current datasets'
        : 'Partially supported request',
    message: requested ? `${reason}. Requested concepts: ${requested}` : reason,
    grounding,
    availableLayers,
    suggestions:
      grounding.suggestions.length > 0
        ? grounding.suggestions
        : generateDynamicSuggestions(availableLayers),
  };
}

chatRoute.post('/', async (c) => {
  if (!dbInstance) {
    return c.json({ error: 'Database not initialized' }, 503);
  }
  if (!layerRegistry) {
    return c.json({ error: 'Layer registry not initialized' }, 503);
  }

  try {
    const body = (await c.req.json()) as { message: string };
    if (!body.message || typeof body.message !== 'string') {
      return c.json({ error: 'Missing or invalid message field' }, 400);
    }

    const availableLayers = layerRegistry.loadedLayerNames;
    const grounding = assessGroundingRequest(body.message, availableLayers);
    if (grounding.disambiguationPrompt) {
      return c.json(
        {
          error: 'Clarification required',
          message: grounding.disambiguationPrompt,
          grounding,
          suggestions: grounding.suggestions,
        },
        400
      );
    }
    if (grounding.status !== 'exact_match') {
      return c.json(unsupportedResponse(grounding, availableLayers), 400);
    }

    let parseResult: ParseResult;
    let parseTimeMs = 0;
    let parseCacheHit = false;

    const cachedParse = parseCache.get(body.message);
    if (cachedParse) {
      parseResult = cachedParse;
      parseCacheHit = true;
    } else {
      try {
        const parseStart = performance.now();
        parseResult = await parser.parse(body.message);
        parseTimeMs = performance.now() - parseStart;
        parseCache.set(body.message, parseResult);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown parsing error';
        if (errorMessage.includes('Cannot connect to Ollama')) {
          return c.json(
            {
              error: 'LLM service unavailable',
              message: 'Cannot connect to Ollama. Is it running?',
              grounding,
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
            grounding,
            suggestions: generateDynamicSuggestions(availableLayers),
          },
          400
        );
      }
    }

    const normalized = normalizeStructuredQuery(parseResult.query);
    const validationIssues = validateQueryAgainstRegistry(
      normalized.query,
      layerRegistry
    );
    if (validationIssues.length > 0) {
      return c.json(
        {
          error: 'Parsed query does not match loaded data',
          details: validationIssues,
          grounding,
          normalizationNotes: normalized.notes,
          suggestions: generateDynamicSuggestions(availableLayers),
        },
        400
      );
    }

    const limitApplication = applyQueryLimits(normalized.query, layerRegistry);
    const executableQuery = limitApplication.query;
    const queryHash = getQueryHash(executableQuery);

    const cachedResult = queryCache.get(queryHash);
    let queryCacheHit = false;
    let result: FeatureCollection;
    let executionTimeMs = 0;

    if (cachedResult) {
      result = cachedResult.result;
      executionTimeMs = cachedResult.executionTimeMs;
      queryCacheHit = true;
    } else {
      const builder = new QueryBuilder(executableQuery, {
        simplifyToleranceDeg: limitApplication.simplifyToleranceDeg,
      });
      const { sql, params } = builder.build();

      const start = performance.now();
      const conn = await getConnection(dbInstance);
      const rows = await query<Record<string, unknown>>(conn, sql, ...params);
      executionTimeMs = performance.now() - start;

      const features = rows.map(rowToFeature);
      result = {
        type: 'FeatureCollection',
        features,
      };

      queryCache.set(queryHash, { result, executionTimeMs });
    }

    const explanation = generateExplanation(executableQuery, result.features.length);

    return c.json({
      query: executableQuery,
      result,
      explanation,
      confidence: parseResult.confidence,
      grounding,
      metadata: {
        count: result.features.length,
        executionTimeMs: Math.round(executionTimeMs * 100) / 100,
        parseTimeMs: Math.round(parseTimeMs * 100) / 100,
        queryHash,
        sourceLayers: getQuerySourceLayers(executableQuery),
        truncated: limitApplication.truncated,
        maxFeaturesApplied: limitApplication.maxFeaturesApplied,
        hardCap: limitApplication.hardCap,
        defaultLimitApplied: limitApplication.defaultLimitApplied,
        normalizationNotes: normalized.notes,
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

    return c.json({ error: 'Unknown error' }, 500);
  }
});

chatRoute.get('/stats', (c) => {
  return c.json({
    cache: getCacheStats(),
  });
});

export default chatRoute;
