import { describe, it, expect, vi } from 'vitest';
import {
  buildEquityPrompt,
  generateEquityExplanation,
  generateExplanation,
} from '../src/lib/utils/explanation';
import type { LLMClient } from '../src/lib/llm/types';
import type { StructuredQuery } from '../../../shared/types/query';

const CENSUS_QUERY: StructuredQuery = {
  selectLayer: 'census_tracts',
  attributeFilters: [{ field: 'median_income', op: 'lt', value: 40000 }],
};

const PARCEL_QUERY: StructuredQuery = {
  selectLayer: 'parcels',
  spatialFilters: [{ op: 'within_distance', targetLayer: 'transit_access', distance: 300 }],
};

const SAMPLE_FEATURES = [
  { properties: { median_income: 35000, pct_renter: 0.62, total_population: 1200 } },
  { properties: { median_income: 38500, pct_renter: 0.55, total_population: 900 } },
  { properties: { median_income: 42000, pct_renter: 0.45, total_population: 800 } },
];

// ── buildEquityPrompt ────────────────────────────────────────────────────────

describe('buildEquityPrompt', () => {
  it('includes the feature count', () => {
    const prompt = buildEquityPrompt(CENSUS_QUERY, 'Found 3 census tracts.', 3, SAMPLE_FEATURES);
    expect(prompt).toContain('Feature count: 3');
  });

  it('includes numeric field statistics in the prompt', () => {
    const prompt = buildEquityPrompt(CENSUS_QUERY, 'Found 3 census tracts.', 3, SAMPLE_FEATURES);
    expect(prompt).toContain('median_income');
    expect(prompt).toContain('Result statistics');
    // min value should appear
    expect(prompt).toContain('35,000');
    // max value should appear
    expect(prompt).toContain('42,000');
  });

  it('includes layer-specific equity context hint', () => {
    const prompt = buildEquityPrompt(CENSUS_QUERY, 'Found 3 census tracts.', 3, []);
    // census_tracts hint references gentrification
    expect(prompt).toContain('gentrification');
  });

  it('includes spatial filter target layer equity context', () => {
    const prompt = buildEquityPrompt(PARCEL_QUERY, 'Found 10 parcels.', 10, []);
    // transit_access context should appear as additional context
    expect(prompt).toContain('transit');
  });

  it('omits statistics section when features array is empty', () => {
    const prompt = buildEquityPrompt(CENSUS_QUERY, 'Found 0 census tracts.', 0, []);
    expect(prompt).not.toContain('Result statistics');
  });

  it('handles features with null properties gracefully', () => {
    const features = [{ properties: null }, { properties: { median_income: 30000 } }];
    const prompt = buildEquityPrompt(CENSUS_QUERY, 'Found 2 census tracts.', 2, features);
    expect(prompt).toContain('median_income');
  });
});

// ── generateEquityExplanation ────────────────────────────────────────────────

describe('generateEquityExplanation', () => {
  it('calls the LLM and returns trimmed narrative', async () => {
    const mockLLM: LLMClient = {
      complete: vi.fn().mockResolvedValue('  12 census tracts below AMI threshold.  '),
    };
    const result = await generateEquityExplanation(
      mockLLM,
      CENSUS_QUERY,
      3,
      SAMPLE_FEATURES
    );
    expect(mockLLM.complete).toHaveBeenCalledOnce();
    expect(result.equityNarrative).toBe('12 census tracts below AMI threshold.');
  });

  it('returns the deterministic fallback when LLM throws', async () => {
    const mockLLM: LLMClient = {
      complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    const result = await generateEquityExplanation(mockLLM, CENSUS_QUERY, 3, SAMPLE_FEATURES);
    expect(result.equityNarrative).toBeNull();
    expect(result.explanation).toBe(generateExplanation(CENSUS_QUERY, 3));
  });

  it('falls back to null when LLM exceeds the timeout', async () => {
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 10_000))
      ),
    };
    const result = await generateEquityExplanation(
      mockLLM,
      CENSUS_QUERY,
      3,
      SAMPLE_FEATURES,
      { timeoutMs: 100 }
    );
    expect(result.equityNarrative).toBeNull();
    expect(result.explanation).toBeTruthy();
  }, 3000);

  it('includes result statistics in the LLM prompt', async () => {
    let capturedPrompt = '';
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return 'Narrative';
      }),
    };
    await generateEquityExplanation(mockLLM, CENSUS_QUERY, 3, SAMPLE_FEATURES);
    expect(capturedPrompt).toContain('median_income');
    expect(capturedPrompt).toContain('35,000'); // min value from SAMPLE_FEATURES
  });

  it('works with no features (zero-result query)', async () => {
    const mockLLM: LLMClient = {
      complete: vi.fn().mockResolvedValue('No results found.'),
    };
    const result = await generateEquityExplanation(mockLLM, CENSUS_QUERY, 0, []);
    expect(result.equityNarrative).toBe('No results found.');
  });
});
