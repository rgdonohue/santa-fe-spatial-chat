/**
 * Test Queries for Intent Parser
 * 
 * Collection of natural language queries to test parsing quality.
 * Run these manually to verify LLM parsing works correctly.
 */

export const TEST_QUERIES = [
  // Simple attribute queries
  'Show all parcels',
  'Show residential parcels',
  'Census tracts with median income below 40000',
  'Parcels with assessed value over 500000',
  
  // Spatial queries
  'Parcels within 500 meters of the Santa Fe River',
  'Parcels near arroyos',
  'Affordable housing units near schools',
  'Short-term rentals within 1km of transit stops',
  
  // Combined queries
  'Residential parcels near transit',
  'Vacant parcels within flood zones',
  'Parcels within 500m of arroyos and inside flood zones',
  
  // Aggregate queries
  'Count short-term rentals by property type',
  'Average assessed value by zoning district',
  'Number of affordable housing units by neighborhood',
  
  // Housing equity focused
  'Vacant parcels near transit stops',
  'Short-term rental density by census tract',
  'Eviction filings in low-income areas',
  'Affordable housing units near schools and transit',
  
  // Complex spatial
  'Parcels within 500m of arroyos and within 1km of transit',
  'Census tracts with high poverty and near flood zones',
] as const;

/**
 * Expected query structures for validation
 * (Used for manual testing and documentation)
 */
export const EXPECTED_QUERY_STRUCTURES = {
  'Show residential parcels': {
    selectLayer: 'parcels',
    attributeFilters: [
      { field: 'zoning', op: 'in', value: ['R-1', 'R-2', 'R-3'] },
    ],
  },
  'Parcels within 500 meters of the Santa Fe River': {
    selectLayer: 'parcels',
    spatialFilters: [
      {
        op: 'within_distance',
        targetLayer: 'hydrology',
        targetFilter: [{ field: 'name', op: 'like', value: '%Santa Fe River%' }],
        distance: 500,
      },
    ],
  },
  'Census tracts with median income below 40000': {
    selectLayer: 'census_tracts',
    attributeFilters: [
      { field: 'median_income', op: 'lt', value: 40000 },
    ],
  },
} as const;

