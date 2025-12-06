/**
 * Intent Parser Tests
 * 
 * Tests for natural language → StructuredQuery parsing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentParser } from '../src/lib/orchestrator/parser';
import type { LLMClient } from '../src/lib/llm/types';

// Mock LLM client
class MockLLMClient implements LLMClient {
  private responses: string[] = [];
  private callCount = 0;

  setResponse(response: string): void {
    this.responses.push(response);
  }

  async complete(prompt: string): Promise<string> {
    this.callCount++;
    const response = this.responses[this.callCount - 1];
    if (!response) {
      throw new Error('No mock response set');
    }
    return response;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

describe('IntentParser', () => {
  let mockLLM: MockLLMClient;
  let parser: IntentParser;

  beforeEach(() => {
    mockLLM = new MockLLMClient();
    parser = new IntentParser(mockLLM);
  });

  it('parses simple attribute filter query', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "parcels",
        "attributeFilters": [
          {"field": "zoning", "op": "eq", "value": "R-1"}
        ]
      }
    `);

    const result = await parser.parse('Show residential parcels');

    expect(result.query.selectLayer).toBe('parcels');
    expect(result.query.attributeFilters).toHaveLength(1);
    expect(result.query.attributeFilters?.[0]?.field).toBe('zoning');
    expect(result.query.attributeFilters?.[0]?.op).toBe('eq');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('parses spatial query with distance', async () => {
    mockLLM.setResponse(`
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
    `);

    const result = await parser.parse('Parcels within 500 meters of the Santa Fe River');

    expect(result.query.selectLayer).toBe('parcels');
    expect(result.query.spatialFilters).toHaveLength(1);
    expect(result.query.spatialFilters?.[0]?.op).toBe('within_distance');
    expect(result.query.spatialFilters?.[0]?.distance).toBe(500);
  });

  it('parses query with multiple filters', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "parcels",
        "attributeFilters": [
          {"field": "zoning", "op": "in", "value": ["R-1", "R-2"]}
        ],
        "spatialFilters": [
          {
            "op": "within_distance",
            "targetLayer": "transit_access",
            "distance": 500
          }
        ]
      }
    `);

    const result = await parser.parse('Residential parcels near transit');

    expect(result.query.attributeFilters).toBeDefined();
    expect(result.query.spatialFilters).toBeDefined();
    expect(result.query.attributeFilters?.length).toBeGreaterThan(0);
    expect(result.query.spatialFilters?.length).toBeGreaterThan(0);
  });

  it('parses aggregate query', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "short_term_rentals",
        "aggregate": {
          "groupBy": ["property_type"],
          "metrics": [{"field": "*", "op": "count", "alias": "str_count"}]
        }
      }
    `);

    const result = await parser.parse('Count short-term rentals by property type');

    expect(result.query.aggregate).toBeDefined();
    expect(result.query.aggregate?.groupBy).toContain('property_type');
    expect(result.query.aggregate?.metrics).toHaveLength(1);
  });

  it('handles JSON extraction from text response', async () => {
    mockLLM.setResponse(`
      Here is the parsed query:
      {
        "selectLayer": "census_tracts",
        "attributeFilters": [
          {"field": "median_income", "op": "lt", "value": 40000}
        ]
      }
      This query will find census tracts with low income.
    `);

    const result = await parser.parse('Census tracts with low income');

    expect(result.query.selectLayer).toBe('census_tracts');
    expect(result.query.attributeFilters?.[0]?.field).toBe('median_income');
  });

  it('throws error when LLM returns invalid JSON', async () => {
    mockLLM.setResponse('This is not JSON at all');

    await expect(parser.parse('Some query')).rejects.toThrow('LLM did not return valid JSON');
  });

  it('throws error when query validation fails', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "nonexistent_layer",
        "attributeFilters": [
          {"field": "invalid_field", "op": "invalid_op", "value": "test"}
        ]
      }
    `);

    await expect(parser.parse('Invalid query')).rejects.toThrow('Query validation failed');
  });

  it('calculates confidence score', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "parcels",
        "attributeFilters": [
          {"field": "zoning", "op": "eq", "value": "R-1"}
        ]
      }
    `);

    const result = await parser.parse('Show residential parcels');

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('lowers confidence for unknown layers', async () => {
    mockLLM.setResponse(`
      {
        "selectLayer": "unknown_layer",
        "attributeFilters": []
      }
    `);

    // Unknown layers pass Zod validation (structure is valid) but get lower confidence
    const result = await parser.parse('Query with unknown layer');

    // Confidence should be lower due to unknown layer (0.8 base - 0.3 for unknown layer = 0.5)
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.query.selectLayer).toBe('unknown_layer');
  });
});

