/**
 * Pre-built Equity Analysis Query Templates
 *
 * These templates provide ready-to-use queries for common housing equity analyses.
 * They can be executed directly via the /api/query endpoint or used as examples
 * in the UI.
 */

import type { StructuredQuery } from '../../../../shared/types/query';

/**
 * Template metadata for UI display
 */
export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: 'housing' | 'displacement' | 'access' | 'risk' | 'opportunity';
  query: StructuredQuery;
  explanation: string;
  dataRequirements: string[];
}

/**
 * Housing Equity Analysis Templates
 */
export const EQUITY_TEMPLATES: QueryTemplate[] = [
  // ============================================================================
  // DISPLACEMENT PRESSURE
  // ============================================================================
  {
    id: 'str-density-by-tract',
    name: 'Short-Term Rental Density by Census Tract',
    description:
      'Identifies census tracts with high concentrations of short-term rentals, which may indicate displacement pressure on long-term residents.',
    category: 'displacement',
    query: {
      selectLayer: 'short_term_rentals',
      aggregate: {
        groupBy: ['census_tract_geoid'],
        metrics: [
          { field: '*', op: 'count', alias: 'str_count' },
          { field: 'price_per_night', op: 'avg', alias: 'avg_price' },
        ],
      },
    },
    explanation:
      'High STR density can reduce available housing for residents and drive up rents. Compare with median income to identify equity concerns.',
    dataRequirements: ['short_term_rentals'],
  },

  {
    id: 'evictions-low-income',
    name: 'Eviction Filings in Low-Income Areas',
    description:
      'Maps eviction filings in census tracts with below-median income to identify displacement hotspots.',
    category: 'displacement',
    query: {
      selectLayer: 'eviction_filings',
      spatialFilters: [
        {
          op: 'within',
          targetLayer: 'census_tracts',
          targetFilter: [{ field: 'median_income', op: 'lt', value: 50000 }],
        },
      ],
    },
    explanation:
      'Eviction concentrations in low-income areas signal housing instability and potential need for tenant protections or rental assistance.',
    dataRequirements: ['eviction_filings', 'census_tracts'],
  },

  {
    id: 'vacancy-hotspots',
    name: 'Vacancy Hotspots',
    description:
      'Identifies areas with high vacancy rates that may indicate speculation or abandonment.',
    category: 'displacement',
    query: {
      selectLayer: 'vacancy_status',
      attributeFilters: [{ field: 'vacant', op: 'eq', value: 1 }], // 1 = true
      aggregate: {
        groupBy: ['vacancy_type'],
        metrics: [{ field: '*', op: 'count', alias: 'vacant_count' }],
      },
    },
    explanation:
      'Distinguishing seasonal vs long-term vacancy helps identify speculative holdings vs second homes.',
    dataRequirements: ['vacancy_status'],
  },

  // ============================================================================
  // HOUSING ACCESS & OPPORTUNITY
  // ============================================================================
  {
    id: 'affordable-near-transit',
    name: 'Affordable Housing Near Transit',
    description:
      'Identifies affordable housing units within walking distance of transit stops.',
    category: 'access',
    query: {
      selectLayer: 'affordable_housing_units',
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'transit_access',
          distance: 800, // ~10 minute walk
        },
      ],
    },
    explanation:
      'Transit access is critical for low-income residents who may not own cars. This shows which affordable units have good transit connectivity.',
    dataRequirements: ['affordable_housing_units', 'transit_access'],
  },

  {
    id: 'affordable-near-schools',
    name: 'Affordable Housing Near Schools',
    description:
      'Maps affordable housing units relative to school zones for families with children.',
    category: 'access',
    query: {
      selectLayer: 'affordable_housing_units',
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'school_zones',
          targetFilter: [
            { field: 'school_type', op: 'in', value: ['elementary', 'middle'] },
          ],
          distance: 1600, // ~1 mile / 20 min walk
        },
      ],
    },
    explanation:
      'Proximity to quality schools is a key factor in housing choice for families. This identifies affordable options near schools.',
    dataRequirements: ['affordable_housing_units', 'school_zones'],
  },

  {
    id: 'expiring-deed-restrictions',
    name: 'Affordable Units with Expiring Deed Restrictions',
    description:
      'Identifies affordable housing units whose deed restrictions expire in the next 5 years, representing preservation priorities.',
    category: 'opportunity',
    query: {
      selectLayer: 'affordable_housing_units',
      attributeFilters: [
        { field: 'deed_restricted', op: 'eq', value: 1 }, // 1 = true
        { field: 'restriction_expires', op: 'lt', value: '2030-01-01' },
      ],
      orderBy: { field: 'restriction_expires', direction: 'asc' },
    },
    explanation:
      'Units with expiring restrictions may convert to market rate, reducing affordable housing stock. Early identification enables preservation efforts.',
    dataRequirements: ['affordable_housing_units'],
  },

  {
    id: 'vacant-near-transit',
    name: 'Vacant Parcels Near Transit (Development Opportunity)',
    description:
      'Identifies vacant or underutilized parcels near transit that could support affordable housing development.',
    category: 'opportunity',
    query: {
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'land_use', op: 'like', value: '%vacant%' },
      ],
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'transit_access',
          distance: 800,
        },
      ],
    },
    explanation:
      'Transit-oriented development on vacant parcels can provide affordable housing with lower transportation costs for residents.',
    dataRequirements: ['parcels', 'transit_access'],
  },

  // ============================================================================
  // ENVIRONMENTAL RISK & EQUITY
  // ============================================================================
  {
    id: 'flood-risk-low-income',
    name: 'Flood Risk in Low-Income Census Tracts',
    description:
      'Identifies residential parcels in flood zones within low-income areas.',
    category: 'risk',
    query: {
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'zoning', op: 'in', value: ['R-1', 'R-2', 'R-3', 'R-4'] },
      ],
      spatialFilters: [
        {
          op: 'intersects',
          targetLayer: 'flood_zones',
          targetFilter: [
            { field: 'flood_risk_level', op: 'in', value: ['high', 'moderate'] },
          ],
        },
        {
          op: 'within',
          targetLayer: 'census_tracts',
          targetFilter: [{ field: 'median_income', op: 'lt', value: 50000 }],
        },
      ],
      spatialLogic: 'and',
    },
    explanation:
      'Low-income residents often live in higher-risk areas and have fewer resources to recover from flooding. This identifies vulnerable populations.',
    dataRequirements: ['parcels', 'flood_zones', 'census_tracts'],
  },

  {
    id: 'arroyo-proximity',
    name: 'Housing Near Arroyos (Flash Flood Risk)',
    description:
      'Identifies residential properties near arroyos, which pose flash flood risk in the desert Southwest.',
    category: 'risk',
    query: {
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'zoning', op: 'in', value: ['R-1', 'R-2', 'R-3', 'R-4'] },
      ],
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'hydrology',
          targetFilter: [{ field: 'type', op: 'eq', value: 'arroyo' }],
          distance: 100, // meters
        },
      ],
    },
    explanation:
      'Arroyos can flood rapidly during monsoon season. Properties within 100m may face elevated risk not captured by FEMA maps.',
    dataRequirements: ['parcels', 'hydrology'],
  },

  {
    id: 'wildfire-affordable',
    name: 'Affordable Housing in Wildfire Risk Zones',
    description:
      'Identifies affordable housing units in areas with elevated wildfire risk.',
    category: 'risk',
    query: {
      selectLayer: 'affordable_housing_units',
      spatialFilters: [
        {
          op: 'intersects',
          targetLayer: 'wildfire_risk',
          targetFilter: [
            { field: 'risk_level', op: 'in', value: ['extreme', 'high'] },
          ],
        },
      ],
    },
    explanation:
      'Affordable housing in wildfire zones faces both physical risk and potential insurance/maintenance cost increases.',
    dataRequirements: ['affordable_housing_units', 'wildfire_risk'],
  },

  // ============================================================================
  // HOUSING STOCK ANALYSIS
  // ============================================================================
  {
    id: 'renter-majority-tracts',
    name: 'Renter-Majority Census Tracts',
    description:
      'Identifies census tracts where renters outnumber homeowners.',
    category: 'housing',
    query: {
      selectLayer: 'census_tracts',
      attributeFilters: [{ field: 'pct_renter', op: 'gt', value: 50 }],
      orderBy: { field: 'pct_renter', direction: 'desc' },
    },
    explanation:
      'Renter-majority areas may benefit from tenant protections and are more vulnerable to displacement from rising rents.',
    dataRequirements: ['census_tracts'],
  },

  {
    id: 'high-value-low-income',
    name: 'Gentrification Pressure (High Value in Low Income Areas)',
    description:
      'Identifies parcels with high assessed values in low-income census tracts, potentially indicating gentrification.',
    category: 'housing',
    query: {
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'assessed_value', op: 'gt', value: 500000 },
      ],
      spatialFilters: [
        {
          op: 'within',
          targetLayer: 'census_tracts',
          targetFilter: [{ field: 'median_income', op: 'lt', value: 50000 }],
        },
      ],
    },
    explanation:
      'High-value properties in low-income areas may signal gentrification pressure that could displace existing residents.',
    dataRequirements: ['parcels', 'census_tracts'],
  },

  {
    id: 'historic-district-housing',
    name: 'Housing in Historic Districts',
    description:
      'Identifies residential parcels within historic districts, which may face development restrictions.',
    category: 'housing',
    query: {
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'zoning', op: 'in', value: ['R-1', 'R-2', 'R-3', 'R-4'] },
      ],
      spatialFilters: [
        {
          op: 'within',
          targetLayer: 'historic_districts',
        },
      ],
    },
    explanation:
      'Historic preservation requirements can increase housing costs and limit affordable development options.',
    dataRequirements: ['parcels', 'historic_districts'],
  },
];

/**
 * Get templates by category
 */
export function getTemplatesByCategory(
  category: QueryTemplate['category']
): QueryTemplate[] {
  return EQUITY_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): QueryTemplate | undefined {
  return EQUITY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Check which templates can be run with available layers
 */
export function getAvailableTemplates(
  availableLayers: string[]
): QueryTemplate[] {
  return EQUITY_TEMPLATES.filter((template) =>
    template.dataRequirements.every((req) => availableLayers.includes(req))
  );
}

/**
 * Get templates grouped by category
 */
export function getTemplatesGrouped(): Record<string, QueryTemplate[]> {
  const grouped: Record<string, QueryTemplate[]> = {};

  for (const template of EQUITY_TEMPLATES) {
    const category = template.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category]!.push(template);
  }

  return grouped;
}
