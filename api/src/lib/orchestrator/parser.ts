/**
 * Intent Parser
 * 
 * Converts natural language queries into StructuredQuery using LLM.
 * Includes prompt engineering with layer schemas and few-shot examples.
 */

import type { LLMClient } from '../llm/types';
import type { StructuredQuery } from '../../../../shared/types/query';
import { safeValidateQuery } from './validator';
import { LAYER_SCHEMAS } from '../../../../shared/types/geo';

/**
 * Parse result with confidence score
 */
export interface ParseResult {
  query: StructuredQuery;
  confidence: number; // 0.0-1.0
  rawResponse: string; // Original LLM response for debugging
}

/**
 * Intent parser that converts NL → StructuredQuery
 */
export class IntentParser {
  private availableLayers: Set<string> = new Set();

  constructor(private llm: LLMClient) {}

  /**
   * Set which layers are actually available in the database
   * This restricts the LLM to only suggest queries against loaded data
   */
  setAvailableLayers(layers: string[]): void {
    this.availableLayers = new Set(layers);
  }

  /**
   * Get list of available layers
   */
  getAvailableLayers(): string[] {
    return Array.from(this.availableLayers);
  }

  /**
   * Parse a natural language query into a StructuredQuery
   *
   * @param userQuery - The user's natural language query
   * @returns ParseResult with query and confidence score
   * @throws Error if parsing fails completely
   */
  async parse(userQuery: string): Promise<ParseResult> {
    const prompt = this.buildPrompt(userQuery);
    const rawResponse = await this.llm.complete(prompt);

    // Extract JSON from response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM did not return valid JSON');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new Error(`Failed to parse JSON from LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Validate against schema
    const validation = safeValidateQuery(parsed);
    if (!validation.success) {
      // Lower confidence but still try to return something useful
      throw new Error(
        `Query validation failed: ${validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(userQuery, validation.data, rawResponse);

    return {
      query: validation.data,
      confidence,
      rawResponse,
    };
  }

  /**
   * Build the prompt with layer schemas and examples
   */
  private buildPrompt(userQuery: string): string {
    // Filter to only available layers (if set), otherwise show all
    const layersToShow = this.availableLayers.size > 0
      ? Object.values(LAYER_SCHEMAS).filter((s) => this.availableLayers.has(s.name))
      : Object.values(LAYER_SCHEMAS);

    // Build layer schema descriptions
    const layerDescriptions = layersToShow
      .map((schema) => {
        const fields = Object.entries(schema.fields)
          .map(([name, type]) => `    - ${name}: ${type}`)
          .join('\n');
        return `  - ${schema.name} (${schema.geometryType}): ${schema.description || 'No description'}\n${fields}`;
      })
      .join('\n\n');

    // Note about data availability
    const availabilityNote = this.availableLayers.size > 0
      ? `\nIMPORTANT: Only the layers listed above are currently available. You MUST only query these layers.
If the user asks about data we don't have (like parcels, buildings, affordable housing, roads, etc.):
- Still output a valid JSON query using the closest available alternative
- For housing/property questions, use census_tracts (has income, rent data)
- For land use questions, use zoning_districts
- For water/drainage questions, use hydrology\n`
      : '';

    // Build examples that use available layers
    const examples = this.buildExamples();

    return `You are a spatial query parser for Santa Fe, New Mexico. Convert natural language queries into structured JSON queries.

Available layers:
${layerDescriptions}
${availabilityNote}

Supported operations:
- Attribute filters: eq, neq, gt, gte, lt, lte, in, like
- Spatial filters: within_distance (meters), intersects, contains, within, nearest
- Logical operators: and, or (for combining multiple filters)

Output ONLY valid JSON matching this schema:
{
  "selectLayer": "string",
  "selectFields": ["string"] (optional),
  "attributeFilters": [{"field": "string", "op": "string", "value": "any"}] (optional),
  "attributeLogic": "and" | "or" (optional, default: "and"),
  "spatialFilters": [{"op": "string", "targetLayer": "string", "targetFilter": [...] (optional), "distance": number (for within_distance), "limit": number (for nearest)}] (optional),
  "spatialLogic": "and" | "or" (optional, default: "and"),
  "aggregate": {"groupBy": ["string"], "metrics": [{"field": "string", "op": "count|sum|avg|median|min|max", "alias": "string" (optional)}]} (optional),
  "temporal": {"baseline": {"year": number} | {"date": "YYYY-MM-DD"}, "comparison": {"year": number} | {"date": "YYYY-MM-DD"}, "metric": "string"} (optional),
  "limit": number (optional, max 1000),
  "orderBy": {"field": "string", "direction": "asc" | "desc"} (optional)
}

Examples:
${examples}

Now parse this query:
User: "${userQuery}"

Output only the JSON object, no other text:`;
  }

  /**
   * Calculate confidence score for the parsed query
   * 
   * Factors:
   * - Validation success (required, otherwise error thrown)
   * - Layer/field references match available schemas
   * - Response quality indicators
   */
  private calculateConfidence(
    userQuery: string,
    query: StructuredQuery,
    rawResponse: string
  ): number {
    let confidence = 0.8; // Base confidence if validation passed

    // Check if layer exists
    if (!(query.selectLayer in LAYER_SCHEMAS)) {
      confidence -= 0.3;
    }

    // Check if referenced fields exist in layer schema
    const layerSchema = LAYER_SCHEMAS[query.selectLayer];
    if (layerSchema) {
      // Check attribute filter fields
      if (query.attributeFilters) {
        for (const filter of query.attributeFilters) {
          if (!(filter.field in layerSchema.fields)) {
            confidence -= 0.1;
          }
        }
      }

      // Check spatial filter target layers
      if (query.spatialFilters) {
        for (const filter of query.spatialFilters) {
          if (!(filter.targetLayer in LAYER_SCHEMAS)) {
            confidence -= 0.2;
          }
        }
      }
    }

    // Check for uncertainty markers in raw response
    const uncertaintyMarkers = [
      'uncertain',
      'not sure',
      'might be',
      'possibly',
      'maybe',
      '?',
    ];
    const lowerResponse = rawResponse.toLowerCase();
    if (uncertaintyMarkers.some((marker) => lowerResponse.includes(marker))) {
      confidence -= 0.2;
    }

    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Build examples based on available layers
   * Uses only layers that are actually loaded
   */
  private buildExamples(): string {
    const hasLayer = (name: string) =>
      this.availableLayers.size === 0 || this.availableLayers.has(name);

    const examples: string[] = [];

    // Zoning examples
    if (hasLayer('zoning_districts')) {
      examples.push(`User: "Show all zoning districts"
{
  "selectLayer": "zoning_districts"
}

User: "Show R1 residential zones"
{
  "selectLayer": "zoning_districts",
  "attributeFilters": [
    {"field": "zone_code", "op": "like", "value": "R1%"}
  ]
}`);
    }

    // Census tract examples
    if (hasLayer('census_tracts')) {
      examples.push(`User: "Census tracts with median income below 50000"
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "median_income", "op": "lt", "value": 50000}
  ]
}

User: "Show census tracts with high renter percentage"
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "pct_renter", "op": "gt", "value": 50}
  ]
}

User: "Census tracts with population over 2000"
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "total_population", "op": "gt", "value": 2000}
  ]
}`);
    }

    // Hydrology examples
    if (hasLayer('hydrology')) {
      examples.push(`User: "Show the hydrology network"
{
  "selectLayer": "hydrology"
}

User: "Show all arroyos"
{
  "selectLayer": "hydrology"
}`);
    }

    // Spatial query examples (only if both layers available)
    if (hasLayer('zoning_districts') && hasLayer('hydrology')) {
      examples.push(`User: "Zoning districts near arroyos"
{
  "selectLayer": "zoning_districts",
  "spatialFilters": [
    {
      "op": "within_distance",
      "targetLayer": "hydrology",
      "distance": 200
    }
  ]
}`);
    }

    if (hasLayer('census_tracts') && hasLayer('zoning_districts')) {
      examples.push(`User: "Census tracts that intersect commercial zoning"
{
  "selectLayer": "census_tracts",
  "spatialFilters": [
    {
      "op": "intersects",
      "targetLayer": "zoning_districts",
      "targetFilter": [{"field": "zone_code", "op": "like", "value": "C%"}]
    }
  ]
}`);
    }

    // Add fallback examples for unavailable data requests
    if (hasLayer('census_tracts')) {
      examples.push(`User: "Show affordable housing locations"
(Note: affordable_housing layer not available, using census_tracts with income data as alternative)
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "median_income", "op": "lt", "value": 40000}
  ]
}

User: "Where are the low income areas?"
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "median_income", "op": "lt", "value": 35000}
  ]
}`);
    }

    return examples.join('\n\n');
  }
}

