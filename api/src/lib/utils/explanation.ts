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

const LAYER_DISPLAY_NAMES: Record<string, { en: string; es: string }> = {
  parcels:            { en: 'parcels',           es: 'parcelas' },
  building_footprints:{ en: 'buildings',         es: 'edificios' },
  short_term_rentals: { en: 'short-term rentals', es: 'alquileres de corto plazo' },
  transit_access:     { en: 'transit stops',      es: 'paradas de tránsito' },
  zoning_districts:   { en: 'zoning districts',   es: 'distritos de zonificación' },
  census_tracts:      { en: 'census tracts',      es: 'sectores censales' },
  hydrology:          { en: 'water features',     es: 'elementos hidrológicos' },
  flood_zones:        { en: 'flood zones',         es: 'zonas inundables' },
  neighborhoods:      { en: 'neighborhoods',       es: 'barrios' },
  parks:              { en: 'parks',              es: 'parques' },
  bikeways:           { en: 'bikeways',           es: 'ciclovías' },
  historic_districts: { en: 'historic districts', es: 'distritos históricos' },
  city_limits:        { en: 'city limits',         es: 'límites de la ciudad' },
  affordable_housing: { en: 'affordable housing', es: 'vivienda asequible' },
};

const OP_DISPLAY_NAMES: Record<string, { en: string; es: string }> = {
  eq:  { en: 'equal to',     es: 'igual a' },
  neq: { en: 'not equal to', es: 'distinto de' },
  gt:  { en: 'greater than', es: 'mayor que' },
  gte: { en: 'at least',     es: 'al menos' },
  lt:  { en: 'less than',    es: 'menor que' },
  lte: { en: 'at most',      es: 'como máximo' },
  like:{ en: 'matching',     es: 'que coincide con' },
  in:  { en: 'in',           es: 'en' },
};

function layerName(layer: string, lang: 'en' | 'es'): string {
  return LAYER_DISPLAY_NAMES[layer]?.[lang] ?? layer;
}

function opName(op: string, lang: 'en' | 'es'): string {
  return OP_DISPLAY_NAMES[op]?.[lang] ?? op;
}

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
export function generateExplanation(
  query: StructuredQuery,
  count: number,
  lang: 'en' | 'es' = 'en'
): string {
  const attributeParts: string[] = [];
  const spatialParts: string[] = [];
  const layer = layerName(query.selectLayer, lang);

  if (query.attributeFilters && query.attributeFilters.length > 0) {
    for (const filter of query.attributeFilters) {
      attributeParts.push(
        `${filter.field.replace(/_/g, ' ')} ${opName(filter.op, lang)} ${filter.value}`
      );
    }
  }

  if (query.spatialFilters && query.spatialFilters.length > 0) {
    for (const filter of query.spatialFilters) {
      const target = layerName(filter.targetLayer, lang);
      if (filter.op === 'within_distance') {
        spatialParts.push(
          lang === 'es'
            ? `dentro de ${filter.distance}m de ${target}`
            : `within ${filter.distance}m of ${target}`
        );
      } else if (filter.op === 'nearest') {
        spatialParts.push(
          lang === 'es'
            ? `los ${filter.limit} más cercanos a ${target}`
            : `nearest ${filter.limit} to ${target}`
        );
      } else {
        spatialParts.push(
          lang === 'es'
            ? `que ${filter.op} ${target}`
            : `${filter.op} ${target}`
        );
      }
    }
  }

  const logicWord = (logic: string) =>
    lang === 'es' ? (logic === 'or' ? 'O' : 'Y') : logic.toUpperCase();

  const segments: string[] = [];
  if (attributeParts.length > 0) {
    const w = logicWord(query.attributeLogic ?? 'and');
    segments.push(attributeParts.join(` ${w} `));
  }
  if (spatialParts.length > 0) {
    const w = logicWord(query.spatialLogic ?? 'and');
    segments.push(spatialParts.join(` ${w} `));
  }

  if (segments.length === 0) {
    return lang === 'es'
      ? `Se encontraron ${count} ${layer}.`
      : `Found ${count} ${layer}.`;
  }

  return lang === 'es'
    ? `Se encontraron ${count} ${layer} donde ${segments.join(' Y ')}.`
    : `Found ${count} ${layer} where ${segments.join(' AND ')}.`;
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
  features: Array<{ properties: Record<string, unknown> | null }> = [],
  lang: 'en' | 'es' = 'en'
): string {
  const equityHint = EQUITY_CONTEXT[query.selectLayer] ?? '';
  const spatialLayers = (query.spatialFilters ?? []).map((f) => f.targetLayer);
  const additionalContext = spatialLayers
    .map((l) => EQUITY_CONTEXT[l])
    .filter(Boolean)
    .join(' ');

  const stats = computeResultStats(features);
  const layer = layerName(query.selectLayer, lang);

  const langInstruction = lang === 'es'
    ? 'Responde en español. Usa vocabulario del español nuevomexicano: parcela, acequia, barrio, sector censal, baldía, valor tasado, arroyo — no español genérico. Mantén el mismo tono natural y cercano a la comunidad.'
    : 'Respond in English.';

  return `You are a housing equity analyst for Santa Fe, New Mexico.
A user queried spatial data and got the following result:

${deterministicExplanation}

Query details:
- Primary layer: ${query.selectLayer} (${layer})
- Feature count: ${count}
${query.attributeFilters?.length ? `- Attribute filters: ${JSON.stringify(query.attributeFilters)}` : ''}
${query.spatialFilters?.length ? `- Spatial filters: ${JSON.stringify(query.spatialFilters)}` : ''}
${stats ? `\nResult statistics (value ranges across matched features):\n${stats}` : ''}

${equityHint ? `Context: ${equityHint}` : ''}
${additionalContext ? `Additional context: ${additionalContext}` : ''}

${langInstruction}

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
  options?: { timeoutMs?: number; lang?: 'en' | 'es' }
): Promise<{ explanation: string; equityNarrative: string | null }> {
  const lang = options?.lang ?? 'en';
  const deterministicExplanation = generateExplanation(query, count, lang);

  try {
    const prompt = buildEquityPrompt(query, deterministicExplanation, count, features, lang);
    const timeoutMs = options?.timeoutMs ?? 5000;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const narrative = await Promise.race([
        llm.complete(prompt, {
          temperature: 0.3,
          maxTokens: 300,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('LLM explanation timed out'));
          }, timeoutMs);
        }),
      ]);

      return {
        explanation: deterministicExplanation,
        equityNarrative: narrative.trim(),
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  } catch {
    // LLM unavailable or timed out — degrade gracefully
    return {
      explanation: deterministicExplanation,
      equityNarrative: null,
    };
  }
}
