import type {
  Feature,
  Polygon,
  LineString,
  Point,
  FeatureCollection,
} from 'geojson';

// ============================================================================
// Core Domain Types
// ============================================================================

/**
 * Parcel properties from Santa Fe County Assessor
 *
 * County parcel zoning, land use, and year built are not queryable here because
 * the current parcel source does not contain reliable values for those fields.
 * Restoring them requires a County Assessor source with authoritative attributes.
 */
export interface ParcelProperties {
  parcel_id: string;
  address: string | null;
  acres: number;
  assessed_value: number | null;
}

export type ParcelFeature = Feature<Polygon, ParcelProperties>;
export type ParcelCollection = FeatureCollection<Polygon, ParcelProperties>;

/**
 * Census tract properties from US Census ACS
 */
export interface CensusTractProperties {
  geoid: string;
  name: string;
  total_population: number;
  median_income: number | null;
  median_age: number | null;
  pct_renter: number | null;
  // Additional housing metrics
  total_housing_units: number | null;
  owner_occupied_units: number | null;
  renter_occupied_units: number | null;
  vacant_units: number | null;
}

export type CensusTractFeature = Feature<Polygon, CensusTractProperties>;
export type CensusTractCollection = FeatureCollection<
  Polygon,
  CensusTractProperties
>;

/**
 * Hydrology features (rivers, streams, arroyos, acequias)
 */
export interface HydrologyProperties {
  name: string;
  type: 'ARROYO' | 'ACEQUIA' | 'CANADA' | 'CREEK' | 'SPRINGS';
  length_km: number; // Legacy field name; current values are meters, not kilometers.
}

export type HydrologyFeature = Feature<LineString, HydrologyProperties>;
export type HydrologyCollection = FeatureCollection<
  LineString,
  HydrologyProperties
>;

/**
 * Zoning district properties
 */
export interface ZoningDistrictProperties {
  zone_code: string;
  zone_name: string;
  // Virtual fields rewritten in query-grounding.ts to zone_code filters.
  allows_residential: boolean;
  allows_commercial: boolean;
}

export type ZoningDistrictFeature = Feature<Polygon, ZoningDistrictProperties>;
export type ZoningDistrictCollection = FeatureCollection<
  Polygon,
  ZoningDistrictProperties
>;

/**
 * Building footprint properties
 */
export interface BuildingFootprintProperties {
  building_id: string;
  address: string | null;
  height: number | null; // Height in feet
  source: string | null; // Data source (e.g., "LIDAR", "SURVEY")
}

export type BuildingFootprintFeature = Feature<Polygon, BuildingFootprintProperties>;
export type BuildingFootprintCollection = FeatureCollection<
  Polygon,
  BuildingFootprintProperties
>;

// ============================================================================
// Housing-Focused Types
// ============================================================================

/**
 * Short-term rental permit properties.
 *
 * This layer reflects City permit records, not listing-scrape data.
 */
export interface ShortTermRentalProperties {
  listing_id: string;
  address: string | null; // Full address
  business_name: string | null; // DBA or business name
  permit_issued_date: string | null; // ISO date string (YYYY-MM-DD)
  permit_expiry_date: string | null; // ISO date string (YYYY-MM-DD)
}

export type ShortTermRentalFeature = Feature<Point, ShortTermRentalProperties>;
export type ShortTermRentalCollection = FeatureCollection<
  Point,
  ShortTermRentalProperties
>;

/**
 * Vacancy status for parcels
 */
export interface VacancyStatusProperties {
  parcel_id: string;
  vacancy_type: 'seasonal' | 'long_term' | 'unknown';
  vacant: boolean;
  vacant_since: string | null; // ISO date string
  source: 'assessor' | 'usps' | 'combined';
}

export type VacancyStatusFeature = Feature<Point, VacancyStatusProperties>;
export type VacancyStatusCollection = FeatureCollection<
  Point,
  VacancyStatusProperties
>;

/**
 * Affordable housing units
 */
export interface AffordableHousingProperties {
  unit_id: string;
  property_name: string | null;
  address: string;
  total_units: number;
  affordable_units: number;
  income_restriction_pct_ami: number | null; // % of Area Median Income; mostly null in current data.
  deed_restricted: boolean;
  restriction_expires: string | null; // ISO date string; currently null for all records.
  property_type: 'apartment' | 'townhouse' | 'single_family' | 'other';
}

export type AffordableHousingFeature = Feature<
  Point | Polygon,
  AffordableHousingProperties
>;
export type AffordableHousingCollection = FeatureCollection<
  Point | Polygon,
  AffordableHousingProperties
>;

/**
 * Eviction filing records
 */
export interface EvictionFilingProperties {
  filing_id: string;
  case_number: string | null;
  filing_date: string; // ISO date string
  address: string;
  unit_number: string | null;
  eviction_type: 'non_payment' | 'lease_violation' | 'owner_use' | 'other';
  outcome: 'dismissed' | 'settled' | 'judgment' | 'pending' | null;
  // Privacy: no personal identifiers
}

export type EvictionFilingFeature = Feature<Point, EvictionFilingProperties>;
export type EvictionFilingCollection = FeatureCollection<
  Point,
  EvictionFilingProperties
>;

/**
 * Transit access points (stops, stations)
 */
export interface TransitAccessProperties {
  stop_id: string;
  stop_type: 'bus' | 'rail' | 'other';
}

export type TransitAccessFeature = Feature<Point, TransitAccessProperties>;
export type TransitAccessCollection = FeatureCollection<
  Point,
  TransitAccessProperties
>;

/**
 * School zones
 */
export interface SchoolZoneProperties {
  zone_id: string;
  school_name: string;
  school_type: 'elementary' | 'middle' | 'high' | 'charter' | 'other';
  district: string;
  grades: string; // e.g., "K-5", "6-8"
}

export type SchoolZoneFeature = Feature<Polygon, SchoolZoneProperties>;
export type SchoolZoneCollection = FeatureCollection<
  Polygon,
  SchoolZoneProperties
>;

/**
 * Historic districts
 */
export interface HistoricDistrictProperties {
  district_id: string;
  district_name: string;
  designation_type: 'national' | 'state' | 'local';
}

export type HistoricDistrictFeature = Feature<
  Polygon,
  HistoricDistrictProperties
>;
export type HistoricDistrictCollection = FeatureCollection<
  Polygon,
  HistoricDistrictProperties
>;

/**
 * Flood zones (FEMA NFHL)
 */
export interface FloodZoneProperties {
  zone_id: string;
  zone_code: string; // e.g., "AE", "X", "A"
  zone_name: string;
  flood_risk_level: 'high' | 'moderate' | 'low' | 'minimal'; // Current dataset is all "high".
  base_flood_elevation: number | null; // Feet; FEMA uses -9999 as a no-data sentinel in current source data.
  source: 'fema_nfhl';
}

export type FloodZoneFeature = Feature<Polygon, FloodZoneProperties>;
export type FloodZoneCollection = FeatureCollection<
  Polygon,
  FloodZoneProperties
>;

/**
 * Wildfire risk zones
 */
export interface WildfireRiskProperties {
  zone_id: string;
  risk_level: 'extreme' | 'high' | 'moderate' | 'low';
  fuel_model: string | null;
  source: string; // e.g., "USFS", "State"
}

export type WildfireRiskFeature = Feature<Polygon, WildfireRiskProperties>;
export type WildfireRiskCollection = FeatureCollection<
  Polygon,
  WildfireRiskProperties
>;

/**
 * Neighborhood associations
 */
export interface NeighborhoodProperties {
  neighborhood_id: string;
  name: string;
  type: string;
  established_date: string | null;
  notes: string | null;
}

export type NeighborhoodFeature = Feature<Polygon, NeighborhoodProperties>;
export type NeighborhoodCollection = FeatureCollection<
  Polygon,
  NeighborhoodProperties
>;

/**
 * City limits boundary
 */
export interface CityLimitsProperties {
  boundary_id: string;
  name: string;
  area_sq_mi: number | null;
  area_acres: number | null;
}

export type CityLimitsFeature = Feature<Polygon, CityLimitsProperties>;
export type CityLimitsCollection = FeatureCollection<
  Polygon,
  CityLimitsProperties
>;

/**
 * City parks
 */
export interface ParkProperties {
  park_id: string;
  name: string;
  park_type: string;
  owner: string;
  acres: number | null;
  council_district: string | null;
}

export type ParkFeature = Feature<Polygon, ParkProperties>;
export type ParkCollection = FeatureCollection<Polygon, ParkProperties>;

/**
 * Bikeways
 */
export interface BikewayProperties {
  bikeway_id: string;
  name: string | null;
}

export type BikewayFeature = Feature<LineString, BikewayProperties>;
export type BikewayCollection = FeatureCollection<LineString, BikewayProperties>;

// ============================================================================
// Layer Schema Registry
// ============================================================================

/**
 * Field type definitions for schema validation
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'null'
  | 'string | null'
  | 'number | null'
  | 'boolean | null';

/**
 * Layer schema for validation and API documentation
 */
export interface LayerSchema {
  name: string;
  geometryType: 'Polygon' | 'LineString' | 'Point' | 'Polygon | Point';
  fields: Record<string, FieldType>;
  description?: string;
}

/**
 * Registry of all available layers and their schemas
 */
export const LAYER_SCHEMAS: Record<string, LayerSchema> = {
  parcels: {
    name: 'parcels',
    geometryType: 'Polygon',
    description: 'Property parcels from Santa Fe County Assessor',
    fields: {
      parcel_id: 'string',
      address: 'string | null',
      acres: 'number',
      assessed_value: 'number | null',
    },
  },
  census_tracts: {
    name: 'census_tracts',
    geometryType: 'Polygon',
    description: 'US Census tracts with demographic and housing data',
    fields: {
      geoid: 'string',
      name: 'string',
      total_population: 'number',
      median_income: 'number | null',
      median_age: 'number | null',
      pct_renter: 'number | null',
      total_housing_units: 'number | null',
      owner_occupied_units: 'number | null',
      renter_occupied_units: 'number | null',
      vacant_units: 'number | null',
    },
  },
  hydrology: {
    name: 'hydrology',
    geometryType: 'LineString',
    description:
      'Hydrology lines; type values are uppercase and length_km values are stored in meters despite the legacy field name.',
    fields: {
      name: 'string',
      type: 'string', // 'ARROYO' | 'ACEQUIA' | 'CANADA' | 'CREEK' | 'SPRINGS'
      length_km: 'number',
    },
  },
  zoning_districts: {
    name: 'zoning_districts',
    geometryType: 'Polygon',
    description: 'Zoning districts with development regulations',
    fields: {
      zone_code: 'string',
      zone_name: 'string',
      // Virtual rewrites handled in query-grounding.ts.
      allows_residential: 'boolean',
      allows_commercial: 'boolean',
    },
  },
  building_footprints: {
    name: 'building_footprints',
    geometryType: 'Polygon',
    description: 'Building footprints with height and source information',
    fields: {
      building_id: 'string',
      address: 'string | null',
      height: 'number | null',
      source: 'string | null',
    },
  },
  short_term_rentals: {
    name: 'short_term_rentals',
    geometryType: 'Point',
    description:
      'City short-term rental permit records; this is permit data, not listing-scrape data.',
    fields: {
      listing_id: 'string',
      address: 'string | null',
      business_name: 'string | null',
      permit_issued_date: 'string | null',
      permit_expiry_date: 'string | null',
    },
  },
  vacancy_status: {
    name: 'vacancy_status',
    geometryType: 'Point',
    description: 'Vacancy status for residential parcels',
    fields: {
      parcel_id: 'string',
      vacancy_type: 'string', // 'seasonal' | 'long_term' | 'unknown'
      vacant: 'boolean',
      vacant_since: 'string | null',
      source: 'string', // 'assessor' | 'usps' | 'combined'
    },
  },
  affordable_housing_units: {
    name: 'affordable_housing_units',
    geometryType: 'Polygon | Point',
    description: 'Affordable housing developments and units',
    fields: {
      unit_id: 'string',
      property_name: 'string | null',
      address: 'string',
      total_units: 'number',
      affordable_units: 'number',
      income_restriction_pct_ami: 'number | null', // Mostly null in current data.
      deed_restricted: 'boolean',
      restriction_expires: 'string | null', // Currently null in current data.
      property_type: 'string', // 'apartment' | 'townhouse' | 'single_family' | 'other'
    },
  },
  eviction_filings: {
    name: 'eviction_filings',
    geometryType: 'Point',
    description: 'Eviction filing records (geocoded addresses)',
    fields: {
      filing_id: 'string',
      case_number: 'string | null',
      filing_date: 'string',
      address: 'string',
      unit_number: 'string | null',
      eviction_type: 'string', // 'non_payment' | 'lease_violation' | 'owner_use' | 'other'
      outcome: 'string | null', // 'dismissed' | 'settled' | 'judgment' | 'pending'
    },
  },
  transit_access: {
    name: 'transit_access',
    geometryType: 'Point',
    description: 'Transit stops and stations',
    fields: {
      stop_id: 'string',
      stop_type: 'string', // 'bus' | 'rail' | 'other'
    },
  },
  school_zones: {
    name: 'school_zones',
    geometryType: 'Polygon',
    description: 'School attendance zones',
    fields: {
      zone_id: 'string',
      school_name: 'string',
      school_type: 'string', // 'elementary' | 'middle' | 'high' | 'charter' | 'other'
      district: 'string',
      grades: 'string',
    },
  },
  historic_districts: {
    name: 'historic_districts',
    geometryType: 'Polygon',
    description: 'Historic preservation districts',
    fields: {
      district_id: 'string',
      district_name: 'string',
      designation_type: 'string', // 'national' | 'state' | 'local'
    },
  },
  flood_zones: {
    name: 'flood_zones',
    geometryType: 'Polygon',
    description:
      'FEMA flood hazard zones; flood_risk_level is currently all "high" and base_flood_elevation may use -9999 as a no-data sentinel.',
    fields: {
      zone_id: 'string',
      zone_code: 'string',
      zone_name: 'string',
      flood_risk_level: 'string', // 'high' | 'moderate' | 'low' | 'minimal'
      base_flood_elevation: 'number | null',
      source: 'string',
    },
  },
  wildfire_risk: {
    name: 'wildfire_risk',
    geometryType: 'Polygon',
    description: 'Wildfire risk zones',
    fields: {
      zone_id: 'string',
      risk_level: 'string', // 'extreme' | 'high' | 'moderate' | 'low'
      fuel_model: 'string | null',
      source: 'string',
    },
  },
  neighborhoods: {
    name: 'neighborhoods',
    geometryType: 'Polygon',
    description: 'Neighborhood associations for community-level analysis',
    fields: {
      neighborhood_id: 'string',
      name: 'string',
      type: 'string',
      established_date: 'string | null',
      notes: 'string | null',
    },
  },
  city_limits: {
    name: 'city_limits',
    geometryType: 'Polygon',
    description: 'City of Santa Fe municipal boundary',
    fields: {
      boundary_id: 'string',
      name: 'string',
      area_sq_mi: 'number | null',
      area_acres: 'number | null',
    },
  },
  parks: {
    name: 'parks',
    geometryType: 'Polygon',
    description: 'City parks and recreational areas',
    fields: {
      park_id: 'string',
      name: 'string',
      park_type: 'string',
      owner: 'string',
      acres: 'number | null',
      council_district: 'string | null',
    },
  },
  bikeways: {
    name: 'bikeways',
    geometryType: 'LineString',
    description: 'Bicycle routes and paths',
    fields: {
      bikeway_id: 'string',
      name: 'string | null',
    },
  },
} as const;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for ParcelFeature
 */
export function isParcelFeature(
  feature: Feature
): feature is ParcelFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.parcel_id === 'string' &&
    typeof props.acres === 'number'
  );
}

/**
 * Type guard for CensusTractFeature
 */
export function isCensusTractFeature(
  feature: Feature
): feature is CensusTractFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.geoid === 'string' &&
    typeof props.name === 'string' &&
    typeof props.total_population === 'number'
  );
}

/**
 * Type guard for HydrologyFeature
 */
export function isHydrologyFeature(
  feature: Feature
): feature is HydrologyFeature {
  if (feature.geometry.type !== 'LineString') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.name === 'string' &&
    typeof props.type === 'string' &&
    ['ARROYO', 'ACEQUIA', 'CANADA', 'CREEK', 'SPRINGS'].includes(props.type) &&
    typeof props.length_km === 'number'
  );
}

/**
 * Type guard for ShortTermRentalFeature
 */
export function isShortTermRentalFeature(
  feature: Feature
): feature is ShortTermRentalFeature {
  if (feature.geometry.type !== 'Point') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.listing_id === 'string'
  );
}

/**
 * Type guard for VacancyStatusFeature
 */
export function isVacancyStatusFeature(
  feature: Feature
): feature is VacancyStatusFeature {
  if (feature.geometry.type !== 'Point') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.parcel_id === 'string' &&
    typeof props.vacant === 'boolean'
  );
}

/**
 * Type guard for AffordableHousingFeature
 */
export function isAffordableHousingFeature(
  feature: Feature
): feature is AffordableHousingFeature {
  const props = feature.properties;
  return (
    (feature.geometry.type === 'Point' ||
      feature.geometry.type === 'Polygon') &&
    typeof props === 'object' &&
    props !== null &&
    typeof props.unit_id === 'string' &&
    typeof props.address === 'string' &&
    typeof props.total_units === 'number' &&
    typeof props.affordable_units === 'number' &&
    typeof props.deed_restricted === 'boolean'
  );
}

/**
 * Type guard for EvictionFilingFeature
 */
export function isEvictionFilingFeature(
  feature: Feature
): feature is EvictionFilingFeature {
  if (feature.geometry.type !== 'Point') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.filing_id === 'string' &&
    typeof props.filing_date === 'string' &&
    typeof props.address === 'string'
  );
}

/**
 * Type guard for TransitAccessFeature
 */
export function isTransitAccessFeature(
  feature: Feature
): feature is TransitAccessFeature {
  if (feature.geometry.type !== 'Point') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.stop_id === 'string' &&
    typeof props.stop_type === 'string'
  );
}

/**
 * Type guard for SchoolZoneFeature
 */
export function isSchoolZoneFeature(
  feature: Feature
): feature is SchoolZoneFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.zone_id === 'string' &&
    typeof props.school_name === 'string' &&
    typeof props.school_type === 'string'
  );
}

/**
 * Type guard for HistoricDistrictFeature
 */
export function isHistoricDistrictFeature(
  feature: Feature
): feature is HistoricDistrictFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.district_id === 'string' &&
    typeof props.district_name === 'string' &&
    typeof props.designation_type === 'string'
  );
}

/**
 * Type guard for FloodZoneFeature
 */
export function isFloodZoneFeature(
  feature: Feature
): feature is FloodZoneFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.zone_id === 'string' &&
    typeof props.zone_code === 'string' &&
    typeof props.flood_risk_level === 'string'
  );
}

/**
 * Type guard for WildfireRiskFeature
 */
export function isWildfireRiskFeature(
  feature: Feature
): feature is WildfireRiskFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.zone_id === 'string' &&
    typeof props.risk_level === 'string'
  );
}

/**
 * Type guard for BuildingFootprintFeature
 */
export function isBuildingFootprintFeature(
  feature: Feature
): feature is BuildingFootprintFeature {
  if (feature.geometry.type !== 'Polygon') return false;
  const props = feature.properties;
  return (
    typeof props === 'object' &&
    props !== null &&
    typeof props.building_id === 'string'
  );
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Union type of all feature types
 */
export type AnyFeature =
  | ParcelFeature
  | CensusTractFeature
  | HydrologyFeature
  | ZoningDistrictFeature
  | BuildingFootprintFeature
  | ShortTermRentalFeature
  | VacancyStatusFeature
  | AffordableHousingFeature
  | EvictionFilingFeature
  | TransitAccessFeature
  | SchoolZoneFeature
  | HistoricDistrictFeature
  | FloodZoneFeature
  | WildfireRiskFeature
  | NeighborhoodFeature
  | CityLimitsFeature
  | ParkFeature
  | BikewayFeature;

/**
 * Union type of all property types
 */
export type AnyProperties =
  | ParcelProperties
  | CensusTractProperties
  | HydrologyProperties
  | ZoningDistrictProperties
  | BuildingFootprintProperties
  | ShortTermRentalProperties
  | VacancyStatusProperties
  | AffordableHousingProperties
  | EvictionFilingProperties
  | TransitAccessProperties
  | SchoolZoneProperties
  | HistoricDistrictProperties
  | FloodZoneProperties
  | WildfireRiskProperties
  | NeighborhoodProperties
  | CityLimitsProperties
  | ParkProperties
  | BikewayProperties;

/**
 * Layer name type (keys of LAYER_SCHEMAS)
 */
export type LayerName = keyof typeof LAYER_SCHEMAS;
