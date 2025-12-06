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
  constructor(private llm: LLMClient) {}

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
    // Build layer schema descriptions
    const layerDescriptions = Object.values(LAYER_SCHEMAS)
      .map((schema) => {
        const fields = Object.entries(schema.fields)
          .map(([name, type]) => `    - ${name}: ${type}`)
          .join('\n');
        return `  - ${schema.name} (${schema.geometryType}): ${schema.description || 'No description'}\n${fields}`;
      })
      .join('\n\n');

    return `You are a spatial query parser for Santa Fe, New Mexico. Convert natural language queries into structured JSON queries.

Available layers:
${layerDescriptions}

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

User: "Show residential parcels"
{
  "selectLayer": "parcels",
  "attributeFilters": [
    {"field": "zoning", "op": "in", "value": ["R-1", "R-2", "R-3", "R-4"]}
  ]
}

User: "Parcels within 500 meters of the Santa Fe River"
{
  "selectLayer": "parcels",
  "spatialFilters": [
    {
      "op": "within_distance",
      "targetLayer": "hydrology",
      "targetFilter": [{"field": "name", "op": "like", "value": "%Santa Fe River%"}],
      "distance": 500
    }
  ]
}

User: "Census tracts with median income below 40000"
{
  "selectLayer": "census_tracts",
  "attributeFilters": [
    {"field": "median_income", "op": "lt", "value": 40000}
  ]
}

User: "Vacant parcels near transit stops"
{
  "selectLayer": "parcels",
  "spatialFilters": [
    {
      "op": "within_distance",
      "targetLayer": "transit_access",
      "distance": 500
    }
  ],
  "attributeFilters": [
    {"field": "land_use", "op": "like", "value": "%vacant%"}
  ]
}

User: "Short-term rentals grouped by neighborhood"
{
  "selectLayer": "short_term_rentals",
  "aggregate": {
    "groupBy": ["property_type"],
    "metrics": [{"field": "*", "op": "count", "alias": "str_count"}]
  }
}

User: "Parcels within 500m of arroyos and inside flood zones"
{
  "selectLayer": "parcels",
  "spatialFilters": [
    {
      "op": "within_distance",
      "targetLayer": "hydrology",
      "targetFilter": [{"field": "type", "op": "eq", "value": "arroyo"}],
      "distance": 500
    },
    {
      "op": "intersects",
      "targetLayer": "flood_zones"
    }
  ],
  "spatialLogic": "and"
}

User: "Affordable housing units near schools"
{
  "selectLayer": "affordable_housing_units",
  "spatialFilters": [
    {
      "op": "within_distance",
      "targetLayer": "school_zones",
      "distance": 1000
    }
  ]
}

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
}

