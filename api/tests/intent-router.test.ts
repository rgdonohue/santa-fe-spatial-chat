import { describe, expect, it } from 'vitest';
import { assessGroundingRequest } from '../src/lib/orchestrator/intent-router';

describe('assessGroundingRequest', () => {
  it('marks affordable housing requests unsupported when layer is missing', () => {
    const assessment = assessGroundingRequest(
      'Show affordable housing near transit stops',
      ['parcels', 'transit_access']
    );

    expect(assessment.status).toBe('unsupported');
    expect(assessment.missingLayers).toContain('affordable_housing_units');
    expect(assessment.missingConcepts).toContain('affordable_housing');
  });

  it('marks affordable housing request exact_match when required layer is loaded', () => {
    const assessment = assessGroundingRequest(
      'Show affordable housing near transit stops',
      ['affordable_housing_units', 'transit_access']
    );

    expect(assessment.status).toBe('exact_match');
    expect(assessment.missingLayers).toHaveLength(0);
    expect(assessment.missingConcepts).toHaveLength(0);
  });

  it('marks ambiguous downtown requests partial_match without boundary layers', () => {
    const assessment = assessGroundingRequest(
      'Show parcels near downtown',
      ['parcels', 'zoning_districts']
    );

    expect(assessment.status).toBe('partial_match');
    expect(assessment.disambiguationPrompt).toBeDefined();
  });
});
