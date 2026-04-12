/**
 * Explanation generators.
 *
 * Two modes:
 *   1. generateExplanation()     — deterministic, instant, always available
 *   2. generateEquityExplanation() — LLM-driven, includes housing equity context
 *
 * The chat route uses (1) as the baseline and can optionally call (2)
 * to enrich the response when the LLM is available.
 */

import type { StructuredQuery } from '../../../../shared/types/query';
import type { LLMClient } from '../llm/types';

/** Friendly display names for known layers */
const LAYER_DISPLAY_NAMES: Record<string, string> = {
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

/** Friendly display names for comparison operators */
const OP_DISPLAY_NAMES: Record<string, string> = {
  eq: 'equal to',
  neq: 'not equal to',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  like: 'matching',
  in: 'in',
};

// ── Equity context hints keyed by layer ────────────────────────────
const EQUITY_CONTEXT: Record<string, string> = {
  parcels:
    'Property values in Santa Fe reflect historical inequities. Consider how assessed values correlate with neighborhood demographics, investment patterns, and displacement pressure.',
  short_term_rentals:
    'Short-term rental proliferation can reduce long-term housing supply, driving up rents and displacing established communities, particularly lower-income and historically Hispanic neighborhoods.',
  census_tracts:
    'Census tract data reveals spatial patterns of income, race, and housing burden. Look for disparities between adjacent tracts that may indicate gentrification boundaries.',
  transit_access:
    'Transit accessibility is an equity issue — residents without vehicle access depend on public transit for employment, healthcare, and services. Gaps in coverage disproportionately affect low-income communities.',
  zoning_districts:
    'Zoning shapes who can live where and at what density. Exclusionary zoning (large lot single-family) can perpetuate segregation by pricing out lower-income households.',
  flood_zones:
    'Flood risk disproportionately affects lower-income communities who may lack resources for mitigation or relocation. FEMA flood zones often correlate with historically underinvested areas.',
  parks:
    'Park access is a key indicator of environmental justice. Neighborhoods with fewer parks and green spaces often correlate with lower-income and minority communities.',
  bikeways:
    'Active transportation infrastructure investment patterns can reveal equity disparities. Well-connected bike networks tend to appear in wealthier neighborhoods first.',
  neighborhoods:
    'Santa Fe neighborhoods vary dramatically in resources, investment, and demographics. Historic patterns of disinvestment persist in some areas.',
  historic_districts:
    'Historic preservation can both protect cultural heritage and create barriers to affordable housing through renovation cost requirements.',
};

/**
 * Generate a deterministic human-readable explanation from a
 * StructuredQuery and the number of features returned.
 */
export function generateExplanation(query: StructuredQuery, count: number): string {
  const attributeParts: string[] = [];
  const spatialParts: string[] = [];
  const layerName = LAYER_DISPLAY_NAMES[query.selectLayer] || query.selectLayer;

  if (query.attributeFilters && query.attributeFilters.length > 0) {
    for (const filter of query.attributeFilters) {
      attributeParts.push(
        `${filter.field.replace(/_/g, ' ')} ${OP_DISPLAY_NAMES[filter.op] || filter.op} ${filter.value}`
      );
    }
  }

  if (query.spatialFilters && query.spatialFilters.length > 0) {
    for (const filter of query.spatialFilters) {
      const targetName = LAYER_DISPLAY_NAMES[filter.targetLayer] || filter.targetLayer;
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

/**
 * Compute min/median/max for numeric fields across result features.
 * Returns a formatted string for inclusion in the LLM prompt.
 */
function computeResultStats(
  features: Array<{ properties: Record<string, unknown> | null }>
): string {
  if (features.length === 0) return '';

  const numericFields: Record<string, number[]> = {};
  for (const feature of features) {
    const props = feature.properties;
    if (!props) continue;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'number' && isFinite(value)) {
        if (!numericFields[key]) numericFields[key] = [];
        numericFields[key]!.push(value);
      }
    }
  }

  const lines: string[] = [];
  for (const [field, values] of Object.entries(numericFields)) {
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const median = sorted[Math.floor(sorted.length / 2)]!;
    lines.push(
      `  ${field}: min=${min.toLocaleString()}, median=${median.toLocaleString()}, max=${max.toLocaleString()}`
    );
  }

  return lines.join('\n');
}

/**
 * Build the equity explanation prompt sent to the LLM.
 * Exported for testing.
 */
export function buildEquityPrompt(
  query: StructuredQuery,
  deterministicExplanation: string,
  count: number,
  features: Array<{ properties: Record<string, unknown> | null }> = []
): string {
  const equityHint = EQUITY_CONTEXT[query.selectLayer] ?? '';
  const spatialLayers = (query.spatialFilters ?? []).map((f) => f.targetLayer);
  const additionalContext = spatialLayers
    .map((l) => EQUITY_CONTEXT[l])
    .filter(Boolean)
    .join(' ');

  const stats = computeResultStats(features);

  return `You are a housing equity analyst for Santa Fe, New Mexico.
A user queried spatial data and got the following result:

${deterministicExplanation}

Query details:
- Primary layer: ${query.selectLayer} (${LAYER_DISPLAY_NAMES[query.selectLayer] || query.selectLayer})
- Feature count: ${count}
${query.attributeFilters?.length ? `- Attribute filters: ${JSON.stringify(query.attributeFilters)}` : ''}
${query.spatialFilters?.length ? `- Spatial filters: ${JSON.stringify(query.spatialFilters)}` : ''}
${stats ? `\nResult statistics (value ranges across matched features):\n${stats}` : ''}

${equityHint ? `Context: ${equityHint}` : ''}
${additionalContext ? `Additional context: ${additionalContext}` : ''}

Write 2-3 sentences that:
1. Summarize the result in plain language
2. Note any housing equity implications (displacement, access, affordability)
3. Suggest a follow-up question the user might ask

Keep it concise, factual, and specific to Santa Fe. Do not use bullet points.`;
}

/**
 * Generate an LLM-enriched explanation with housing equity context.
 *
 * Falls back to the deterministic explanation on any failure or timeout,
 * so callers can always use the result directly.
 */
export async function generateEquityExplanation(
  llm: LLMClient,
  query: StructuredQuery,
  count: number,
  features: Array<{ properties: Record<string, unknown> | null }> = [],
  options?: { timeoutMs?: number }
): Promise<{ explanation: string; equityNarrative: string | null }> {
  const deterministicExplanation = generateExplanation(query, count);

  try {
    const prompt = buildEquityPrompt(query, deterministicExplanation, count, features);
    const timeoutMs = options?.timeoutMs ?? 5000;

    const narrative = await Promise.race([
      llm.complete(prompt, { temperature: 0.3, maxTokens: 300 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM explanation timed out')), timeoutMs)
      ),
    ]);

    return {
      explanation: deterministicExplanation,
      equityNarrative: narrative.trim(),
    };
  } catch {
    // LLM unavailable or timed out — degrade gracefully
    return {
      explanation: deterministicExplanation,
      equityNarrative: null,
    };
  }
}
