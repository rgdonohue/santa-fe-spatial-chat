#!/usr/bin/env tsx
/**
 * Fetch Short-Term Rental Permits from Santa Fe GIS ArcGIS REST Service
 * 
 * Harvests STR permit data from the public ArcGIS REST endpoint:
 * https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/127
 * 
 * Handles pagination (max 2000 records per request) and field mapping.
 * 
 * Usage:
 *   tsx scripts/fetch-str-permits.ts [--output <path>]
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FeatureCollection, Feature, Point } from 'geojson';

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry: {
    x: number;
    y: number;
    spatialReference: { wkid: number };
  };
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

/**
 * Convert ArcGIS point to GeoJSON Point
 */
function arcGISPointToGeoJSON(x: number, y: number): Point {
  return {
    type: 'Point',
    coordinates: [x, y],
  };
}

/**
 * Map ArcGIS fields to our ShortTermRentalProperties schema
 */
function mapArcGISFields(attributes: Record<string, unknown>): {
  listing_id: string;
  host_id: string | null;
  property_type: string;
  room_type: string | null;
  accommodates: number | null;
  price_per_night: number | null;
  availability_365: number | null;
  last_scraped: string | null;
  source: 'airbnb' | 'vrbo' | 'other';
  address: string | null;
  business_name: string | null;
  permit_issued_date: string | null;
  permit_expiry_date: string | null;
} {
  // Extract listing ID (use OBJECTID if no other ID available)
  const listingId = attributes.OBJECTID || `str_${Date.now()}_${Math.random()}`;
  const listing_id = String(listingId);

  // Extract address
  const address =
    typeof attributes.Match_addr === 'string' && attributes.Match_addr.trim()
      ? attributes.Match_addr.trim()
      : typeof attributes.Address === 'string' && attributes.Address.trim()
        ? attributes.Address.trim()
        : null;

  // Extract business name / DBA
  const business_name =
    typeof attributes.DBA === 'string' && attributes.DBA.trim()
      ? attributes.DBA.trim()
      : typeof attributes.Business_N === 'string' && attributes.Business_N.trim()
        ? attributes.Business_N.trim()
        : null;

  // Extract property type from Short_Term_ field or Business fields
  const property_type =
    typeof attributes.Short_Term_ === 'string' && attributes.Short_Term_.trim()
      ? attributes.Short_Term_.trim()
      : 'short_term_rental';

  // Extract permit dates
  let permit_issued_date: string | null = null;
  if (attributes.Business_5) {
    const date = attributes.Business_5;
    if (date instanceof Date) {
      permit_issued_date = date.toISOString().split('T')[0];
    } else if (typeof date === 'string') {
      permit_issued_date = date.split('T')[0];
    } else if (typeof date === 'number') {
      // ArcGIS date as milliseconds since epoch
      permit_issued_date = new Date(date).toISOString().split('T')[0];
    }
  }

  let permit_expiry_date: string | null = null;
  if (attributes.Business_6) {
    const date = attributes.Business_6;
    if (date instanceof Date) {
      permit_expiry_date = date.toISOString().split('T')[0];
    } else if (typeof date === 'string') {
      permit_expiry_date = date.split('T')[0];
    } else if (typeof date === 'number') {
      permit_expiry_date = new Date(date).toISOString().split('T')[0];
    }
  }

  // Set last_scraped to current date (since this is permit data, not scraped)
  const last_scraped = new Date().toISOString().split('T')[0];

  return {
    listing_id,
    host_id: null, // Not available in permit data
    property_type,
    room_type: null, // Not available in permit data
    accommodates: null, // Not available in permit data
    price_per_night: null, // Not available in permit data
    availability_365: null, // Not available in permit data
    last_scraped,
    source: 'other', // Permit data, not Airbnb/VRBO
    address,
    business_name,
    permit_issued_date,
    permit_expiry_date,
  };
}

/**
 * Fetch a page of features from ArcGIS REST service
 */
async function fetchSTRPermitsPage(
  offset: number = 0,
  maxRecords: number = 2000
): Promise<ArcGISResponse> {
  const baseUrl =
    'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/127/query';
  
  const params = new URLSearchParams({
    where: '1=1', // Get all features
    outFields: '*', // Get all fields
    outSR: '4326', // Request WGS84 (will be transformed from Web Mercator)
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(maxRecords),
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`  Fetching records ${offset} to ${offset + maxRecords}...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SantaFeSpatialChat/1.0 (Educational Research Project)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as ArcGISResponse;
  return data;
}

/**
 * Fetch all STR permits with pagination
 */
async function fetchAllSTRPermits(): Promise<FeatureCollection<Point>> {
  const features: Feature<Point>[] = [];
  let offset = 0;
  const maxRecords = 2000;
  let hasMore = true;
  let totalFetched = 0;

  console.log('Fetching short-term rental permits from Santa Fe GIS...\n');

  while (hasMore) {
    const response = await fetchSTRPermitsPage(offset, maxRecords);
    
    if (!response.features || response.features.length === 0) {
      hasMore = false;
      break;
    }

    // Convert ArcGIS features to GeoJSON
    for (const arcFeature of response.features) {
      try {
        const x = arcFeature.geometry.x;
        const y = arcFeature.geometry.y;

        // Skip features with invalid coordinates
        if (
          typeof x !== 'number' ||
          typeof y !== 'number' ||
          isNaN(x) ||
          isNaN(y) ||
          !isFinite(x) ||
          !isFinite(y)
        ) {
          console.warn(
            `  Warning: Skipped feature with OBJECTID ${arcFeature.attributes.OBJECTID || 'unknown'}: Invalid coordinates (x: ${x}, y: ${y})`
          );
          continue;
        }

        const geometry = arcGISPointToGeoJSON(x, y);
        const properties = mapArcGISFields(arcFeature.attributes);

        features.push({
          type: 'Feature',
          geometry,
          properties,
        });
      } catch (error) {
        console.warn(
          `  Warning: Skipped feature with OBJECTID ${arcFeature.attributes.OBJECTID || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    totalFetched += response.features.length;
    console.log(`  ✓ Fetched ${response.features.length} features (total: ${totalFetched})`);

    // Check if we need to fetch more
    hasMore = response.exceededTransferLimit === true || response.features.length === maxRecords;
    offset += maxRecords;
  }

  console.log(`\n✓ Total features fetched: ${features.length}`);

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath =
    outputIndex >= 0 && args[outputIndex + 1]
      ? args[outputIndex + 1]
      : join(process.cwd(), 'data', 'raw', 'short_term_rentals', 'str_permits.geojson');

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const featureCollection = await fetchAllSTRPermits();

    // Filter out any features with invalid coordinates (safety check)
    const validFeatures = featureCollection.features.filter((feature) => {
      if (feature.geometry.type === 'Point') {
        const [x, y] = feature.geometry.coordinates;
        return (
          typeof x === 'number' &&
          typeof y === 'number' &&
          !isNaN(x) &&
          !isNaN(y) &&
          isFinite(x) &&
          isFinite(y)
        );
      }
      return true;
    });

    const cleanedCollection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: validFeatures,
    };

    // Write GeoJSON file
    writeFileSync(outputPath, JSON.stringify(cleanedCollection, null, 2));
    console.log(`\n✓ Saved to: ${outputPath}`);
    console.log(`\nNext step: Process with prepare-data.ts`);
    console.log(`  tsx scripts/prepare-data.ts short_term_rentals ${outputPath} 4326`);
  } catch (error) {
    console.error('\n✗ Error fetching STR permits:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
