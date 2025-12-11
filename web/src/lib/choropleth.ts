/**
 * Choropleth mapping configuration
 *
 * Determines appropriate color schemes and breaks for thematic mapping
 * of quantitative attribute data.
 *
 * Design principles:
 * - Colorblind-safe: single-hue sequential schemes only
 * - Meaningful breaks: based on policy thresholds (poverty line, AMI), not arbitrary quantiles
 * - Clear interpretation: lighter = lower values, darker = higher values
 */

import type { Feature, Geometry } from 'geojson';
import type { StructuredQuery } from '../types/api';

/**
 * Colorblind-safe sequential color ramps (single hue, light to dark)
 * Based on ColorBrewer recommendations
 */
export const COLOR_RAMPS = {
  // Blues: light to dark (5 classes)
  blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  // Purples: light to dark (5 classes)
  purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
  // Oranges: light to dark (5 classes) - good for "intensity" data
  oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
  // Greens: light to dark (5 classes)
  greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
} as const;

/**
 * Choropleth configuration for a specific field
 */
export interface ChoroplethConfig {
  field: string;
  label: string;
  colorRamp: readonly string[];
  breaks: number[];
  classLabels: string[];
  format: (value: number) => string;
  unit?: string;
}

/**
 * Santa Fe County 2023 Area Median Income (AMI) reference
 * Used for meaningful income classification breaks
 * Source: HUD FY2023 Income Limits
 */
const SANTA_FE_AMI_2023 = 77000;

/**
 * Known numeric fields for census tracts that support choropleth mapping
 * Each field has predefined meaningful breaks based on policy thresholds
 */
interface FieldConfig {
  field: string;
  label: string;
  colorRamp: readonly string[];
  format: (value: number) => string;
  unit?: string;
  /** Fixed meaningful breaks - not calculated from data */
  fixedBreaks: number[];
  /** Labels for each class (one more than breaks) */
  classLabels: string[];
}

const CENSUS_TRACT_FIELDS: Record<string, FieldConfig> = {
  median_income: {
    field: 'median_income',
    label: 'Median Household Income',
    colorRamp: COLOR_RAMPS.blues,
    format: (v) => `$${v.toLocaleString()}`,
    unit: 'USD',
    // Breaks based on HUD income limits (% of AMI)
    // 50% AMI (~$38k), 80% AMI (~$62k), 100% AMI (~$77k), 120% AMI (~$92k)
    fixedBreaks: [38500, 61600, 77000, 92400],
    classLabels: [
      'Very Low (<50% AMI)',
      'Low (50-80% AMI)',
      'Moderate (80-100% AMI)',
      'Middle (100-120% AMI)',
      'Upper (>120% AMI)',
    ],
  },
  pct_renter: {
    field: 'pct_renter',
    label: 'Renter Households',
    colorRamp: COLOR_RAMPS.purples,
    format: (v) => `${v.toFixed(0)}%`,
    unit: '%',
    // Breaks: mostly owner, mixed, mostly renter, predominantly renter
    fixedBreaks: [25, 40, 55, 70],
    classLabels: [
      'Owner-dominated (<25%)',
      'Owner-majority (25-40%)',
      'Mixed (40-55%)',
      'Renter-majority (55-70%)',
      'Renter-dominated (>70%)',
    ],
  },
  total_population: {
    field: 'total_population',
    label: 'Total Population',
    colorRamp: COLOR_RAMPS.oranges,
    format: (v) => v.toLocaleString(),
    // Population density tiers for census tracts
    fixedBreaks: [1000, 2000, 4000, 6000],
    classLabels: [
      'Very Low (<1,000)',
      'Low (1,000-2,000)',
      'Medium (2,000-4,000)',
      'High (4,000-6,000)',
      'Very High (>6,000)',
    ],
  },
  median_age: {
    field: 'median_age',
    label: 'Median Age',
    colorRamp: COLOR_RAMPS.greens,
    format: (v) => v.toFixed(0),
    unit: 'years',
    // Age tiers
    fixedBreaks: [30, 40, 50, 60],
    classLabels: [
      'Young (<30)',
      'Younger working (30-40)',
      'Older working (40-50)',
      'Pre-retirement (50-60)',
      'Retirement age (>60)',
    ],
  },
  vacant_units: {
    field: 'vacant_units',
    label: 'Vacant Housing Units',
    colorRamp: COLOR_RAMPS.oranges,
    format: (v) => v.toLocaleString(),
    fixedBreaks: [50, 100, 200, 400],
    classLabels: [
      'Very Low (<50)',
      'Low (50-100)',
      'Moderate (100-200)',
      'High (200-400)',
      'Very High (>400)',
    ],
  },
};


/**
 * Detect the best field to use for choropleth mapping based on query
 */
function detectThematicField(
  query: StructuredQuery | null,
  features: Feature<Geometry, Record<string, unknown>>[]
): string | null {
  // If query has attribute filters, use the filtered field
  if (query?.attributeFilters && query.attributeFilters.length > 0) {
    const filteredField = query.attributeFilters[0]?.field;
    if (filteredField && filteredField in CENSUS_TRACT_FIELDS) {
      return filteredField;
    }
  }

  // If query has orderBy, use that field
  if (query?.orderBy?.field && query.orderBy.field in CENSUS_TRACT_FIELDS) {
    return query.orderBy.field;
  }

  // Default to median_income for census tracts if available
  if (features.length > 0) {
    const firstFeature = features[0];
    if (firstFeature?.properties?.median_income !== undefined) {
      return 'median_income';
    }
    if (firstFeature?.properties?.pct_renter !== undefined) {
      return 'pct_renter';
    }
  }

  return null;
}

/**
 * Determine if features should use choropleth mapping
 * Returns configuration if applicable, null otherwise
 */
export function getChoroplethConfig(
  query: StructuredQuery | null,
  features: Feature<Geometry, Record<string, unknown>>[]
): ChoroplethConfig | null {
  // Only support census_tracts for now
  if (query?.selectLayer !== 'census_tracts') {
    return null;
  }

  // Need polygon features
  if (features.length === 0 || features[0]?.geometry.type !== 'Polygon') {
    return null;
  }

  // Detect which field to use
  const thematicField = detectThematicField(query, features);
  if (!thematicField) {
    return null;
  }

  const fieldConfig = CENSUS_TRACT_FIELDS[thematicField];
  if (!fieldConfig) {
    return null;
  }

  // Verify we have data for this field
  let hasData = false;
  for (const feature of features) {
    const value = feature.properties?.[thematicField];
    if (typeof value === 'number' && !isNaN(value)) {
      hasData = true;
      break;
    }
  }

  if (!hasData) {
    return null;
  }

  // Use predefined meaningful breaks
  return {
    field: fieldConfig.field,
    label: fieldConfig.label,
    colorRamp: fieldConfig.colorRamp,
    breaks: fieldConfig.fixedBreaks,
    classLabels: fieldConfig.classLabels,
    format: fieldConfig.format,
    unit: fieldConfig.unit,
  };
}

/**
 * Build MapLibre data-driven style expression for fill-color
 * Uses step expression for classified choropleth
 */
export function buildFillColorExpression(config: ChoroplethConfig): unknown[] {
  const { field, colorRamp, breaks } = config;

  // Build step expression: ['step', ['get', field], color0, break1, color1, break2, color2, ...]
  const expression: unknown[] = [
    'step',
    ['get', field],
    colorRamp[0], // Default color for values below first break
  ];

  // Add each break point and its corresponding color
  for (let i = 0; i < breaks.length; i++) {
    const breakValue = breaks[i];
    const color = colorRamp[i + 1];
    if (breakValue !== undefined && color !== undefined) {
      expression.push(breakValue, color);
    }
  }

  return expression;
}

/**
 * Get color for a specific value (for legend or tooltips)
 */
export function getColorForValue(value: number, config: ChoroplethConfig): string {
  const { colorRamp, breaks } = config;

  for (let i = 0; i < breaks.length; i++) {
    const breakValue = breaks[i];
    if (breakValue !== undefined && value < breakValue) {
      return colorRamp[i] ?? colorRamp[0] ?? '#888';
    }
  }

  return colorRamp[colorRamp.length - 1] ?? '#888';
}
