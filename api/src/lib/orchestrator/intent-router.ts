export type GroundingStatus = 'exact_match' | 'partial_match' | 'unsupported';

export interface GroundingAssessment {
  status: GroundingStatus;
  requestedConcepts: string[];
  matchedLayers: string[];
  missingConcepts: string[];
  missingLayers: string[];
  disambiguationPrompt?: string;
  suggestions: string[];
}

interface ConceptRule {
  concept: string;
  patterns: RegExp[];
  requiredLayers: string[];
  suggestion: string;
}

const CONCEPT_RULES: ConceptRule[] = [
  {
    concept: 'affordable_housing',
    patterns: [
      /\baffordable housing\b/i,
      /\bdeed[- ]restricted\b/i,
      /\bincome[- ]restricted\b/i,
      /\blihtc\b/i,
    ],
    requiredLayers: ['affordable_housing_units'],
    suggestion:
      'Affordable housing data is not loaded yet. Try transit, zoning, parcels, or census tracts.',
  },
  {
    concept: 'evictions',
    patterns: [/\bevictions?\b/i, /\beviction filings?\b/i],
    requiredLayers: ['eviction_filings'],
    suggestion:
      'Eviction filing data is not loaded yet. Try census tracts or parcels-based analyses.',
  },
  {
    concept: 'school_zones',
    patterns: [/\bschool zones?\b/i, /\battendance zones?\b/i],
    requiredLayers: ['school_zones'],
    suggestion:
      'School attendance zone polygons are not loaded yet. Try parks, transit, or neighborhood-based filters.',
  },
  {
    concept: 'wildfire_risk',
    patterns: [/\bwildfire\b/i, /\bfire risk\b/i, /\bwui\b/i],
    requiredLayers: ['wildfire_risk'],
    suggestion:
      'Wildfire risk layer is not loaded yet. Try flood zones or hydrology risk analyses.',
  },
  {
    concept: 'vacancy_status',
    patterns: [/\bvacancy status\b/i, /\busps vacancy\b/i, /\blong[- ]term vacancy\b/i],
    requiredLayers: ['vacancy_status'],
    suggestion:
      'Vacancy status layer is not loaded yet. Try vacant parcels using parcel land_use filters.',
  },
];

const AMBIGUOUS_AREA_PATTERNS = [/\bdowntown\b/i, /\brailyard\b/i, /\bmidtown\b/i];

export function assessGroundingRequest(
  userMessage: string,
  availableLayers: string[]
): GroundingAssessment {
  const requestedConcepts: string[] = [];
  const matchedLayers = new Set<string>();
  const missingConcepts: string[] = [];
  const missingLayers = new Set<string>();
  const suggestions: string[] = [];

  for (const rule of CONCEPT_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(userMessage));
    if (!matched) {
      continue;
    }

    requestedConcepts.push(rule.concept);
    const unavailable = rule.requiredLayers.filter(
      (layer) => !availableLayers.includes(layer)
    );

    if (unavailable.length === 0) {
      for (const layer of rule.requiredLayers) {
        matchedLayers.add(layer);
      }
    } else {
      missingConcepts.push(rule.concept);
      for (const layer of unavailable) {
        missingLayers.add(layer);
      }
      suggestions.push(rule.suggestion);
    }
  }

  const areaTermDetected = AMBIGUOUS_AREA_PATTERNS.some((pattern) =>
    pattern.test(userMessage)
  );
  const hasBoundaryLayer =
    availableLayers.includes('neighborhoods') ||
    availableLayers.includes('city_limits') ||
    availableLayers.includes('historic_districts');

  let disambiguationPrompt: string | undefined;
  if (areaTermDetected && !hasBoundaryLayer) {
    disambiguationPrompt =
      'That place name is ambiguous in the current data. Please specify a concrete boundary layer or address.';
    suggestions.push(
      'Try specifying a neighborhood name, coordinates, or a known boundary.'
    );
  }

  let status: GroundingStatus = 'exact_match';
  if (missingConcepts.length > 0 && matchedLayers.size === 0) {
    status = 'unsupported';
  } else if (missingConcepts.length > 0 || disambiguationPrompt) {
    status = 'partial_match';
  }

  return {
    status,
    requestedConcepts,
    matchedLayers: Array.from(matchedLayers).sort(),
    missingConcepts,
    missingLayers: Array.from(missingLayers).sort(),
    disambiguationPrompt,
    suggestions: Array.from(new Set(suggestions)).slice(0, 4),
  };
}
