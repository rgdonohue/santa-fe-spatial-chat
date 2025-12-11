#!/usr/bin/env tsx
/**
 * Fetch Parcels from Santa Fe GIS ArcGIS REST Service
 * 
 * Harvests parcel data from the public ArcGIS REST endpoint:
 * https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/126
 * 
 * Handles pagination (max 2000 records per request) and field mapping.
 * 
 * Usage:
 *   tsx scripts/fetch-parcels.ts [--output <path>]
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FeatureCollection, Feature, Polygon } from 'geojson';

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry: {
    rings: number[][][];
    spatialReference: { wkid: number };
  };
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

/**
 * Convert ArcGIS polygon rings to GeoJSON Polygon
 */
function arcGISPolygonToGeoJSON(rings: number[][][]): Polygon {
  // First ring is exterior, rest are holes
  const coordinates = rings.map((ring) =>
    ring.map(([x, y]) => [x, y])
  ) as [number[], ...number[][]][];

  return {
    type: 'Polygon',
    coordinates,
  };
}

/**
 * Map ArcGIS fields to our ParcelProperties schema
 */
function mapArcGISFields(attributes: Record<string, unknown>): {
  parcel_id: string;
  address: string | null;
  zoning: string;
  land_use: string;
  acres: number;
  year_built: number | null;
  assessed_value: number | null;
} {
  // Extract parcel ID
  const parcelId = attributes.parcelid || attributes.lowparceli;
  const parcel_id = typeof parcelId === 'string' ? parcelId : String(parcelId || '');

  // Extract address
  const address =
    typeof attributes.siteaddres === 'string' && attributes.siteaddres.trim()
      ? attributes.siteaddres.trim()
      : null;

  // Extract zoning (use code if available, otherwise description)
  const zoning =
    typeof attributes.usecd === 'string' && attributes.usecd.trim()
      ? attributes.usecd.trim()
      : typeof attributes.usedscrp === 'string' && attributes.usedscrp.trim()
        ? attributes.usedscrp.trim()
        : 'UNKNOWN';

  // Extract land use (use description)
  const land_use =
    typeof attributes.usedscrp === 'string' && attributes.usedscrp.trim()
      ? attributes.usedscrp.trim()
      : typeof attributes.usecd === 'string' && attributes.usecd.trim()
        ? attributes.usecd.trim()
        : 'UNKNOWN';

  // Extract acres (convert from statedarea string if needed)
  let acres = 0;
  if (attributes.statedarea) {
    const areaStr = String(attributes.statedarea);
    // Try to extract number from string (e.g., "1.5 ACRES" -> 1.5)
    const match = areaStr.match(/([\d.]+)/);
    if (match) {
      acres = parseFloat(match[1]);
    }
  }
  // Fallback: calculate from Shape_STAr if available (in square meters, convert to acres)
  if (acres === 0 && attributes.Shape_STAr) {
    const sqMeters = Number(attributes.Shape_STAr);
    if (!isNaN(sqMeters) && sqMeters > 0) {
      acres = sqMeters * 0.000247105; // Convert sq meters to acres
    }
  }

  // Extract year built
  const year_built =
    attributes.resyrblt && typeof attributes.resyrblt === 'number'
      ? attributes.resyrblt
      : null;

  // Extract assessed value (current assessed value)
  const assessed_value =
    attributes.cntassdval && typeof attributes.cntassdval === 'number'
      ? attributes.cntassdval
      : null;

  return {
    parcel_id,
    address,
    zoning,
    land_use,
    acres,
    year_built,
    assessed_value,
  };
}

/**
 * Fetch a page of features from ArcGIS REST service
 */
async function fetchParcelsPage(
  offset: number = 0,
  maxRecords: number = 2000
): Promise<ArcGISResponse> {
  const baseUrl =
    'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/126/query';
  
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
 * Fetch all parcels with pagination
 */
async function fetchAllParcels(): Promise<FeatureCollection<Polygon>> {
  const features: Feature<Polygon>[] = [];
  let offset = 0;
  const maxRecords = 2000;
  let hasMore = true;
  let totalFetched = 0;

  console.log('Fetching parcels from Santa Fe GIS...\n');

  while (hasMore) {
    const response = await fetchParcelsPage(offset, maxRecords);
    
    if (!response.features || response.features.length === 0) {
      hasMore = false;
      break;
    }

    // Convert ArcGIS features to GeoJSON
    for (const arcFeature of response.features) {
      try {
        const geometry = arcGISPolygonToGeoJSON(arcFeature.geometry.rings);
        const properties = mapArcGISFields(arcFeature.attributes);

        features.push({
          type: 'Feature',
          geometry,
          properties,
        });
      } catch (error) {
        console.warn(
          `  Warning: Skipped feature with parcel_id ${arcFeature.attributes.parcelid || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`
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
      : join(process.cwd(), 'data', 'raw', 'parcels', 'parcels.geojson');

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const featureCollection = await fetchAllParcels();

    // Write GeoJSON file
    writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
    console.log(`\n✓ Saved to: ${outputPath}`);
    console.log(`\nNext step: Process with prepare-data.ts`);
    console.log(`  tsx scripts/prepare-data.ts parcels ${outputPath} 4326`);
  } catch (error) {
    console.error('\n✗ Error fetching parcels:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
