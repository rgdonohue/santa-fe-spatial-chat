#!/usr/bin/env tsx
/**
 * Fetch Transit Stops from Santa Fe GIS ArcGIS REST Service
 * 
 * Harvests bus stop data from the public ArcGIS REST endpoint:
 * https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/67
 * 
 * Handles pagination (max 2000 records per request) and field mapping.
 * 
 * Usage:
 *   tsx scripts/fetch-transit.ts [--output <path>]
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
 * Map ArcGIS fields to our TransitAccessProperties schema
 */
function mapArcGISFields(attributes: Record<string, unknown>): {
  stop_id: string;
  stop_name: string;
  route_ids: string[];
  route_names: string[];
  stop_type: 'bus' | 'rail' | 'other';
  wheelchair_accessible: boolean | null;
  avg_headway_minutes: number | null;
} {
  // Extract stop ID
  const stopId = attributes.OBJECTID || attributes.STOP_ID || attributes.stop_id;
  const stop_id = stopId ? String(stopId) : `stop_${Date.now()}_${Math.random()}`;

  // Extract stop name
  const stop_name =
    typeof attributes.STOP_NAME === 'string' && attributes.STOP_NAME.trim()
      ? attributes.STOP_NAME.trim()
      : typeof attributes.NAME === 'string' && attributes.NAME.trim()
        ? attributes.NAME.trim()
        : typeof attributes.stop_name === 'string' && attributes.stop_name.trim()
          ? attributes.stop_name.trim()
          : 'Unnamed Stop';

  // Extract route IDs (may be in various fields)
  const routeIds: string[] = [];
  if (attributes.ROUTE_ID) {
    const routeId = String(attributes.ROUTE_ID);
    routeIds.push(...routeId.split(/[,;]/).map((r) => r.trim()).filter(Boolean));
  }
  if (attributes.ROUTES) {
    const routes = String(attributes.ROUTES);
    routeIds.push(...routes.split(/[,;]/).map((r) => r.trim()).filter(Boolean));
  }
  // Deduplicate
  const route_ids = Array.from(new Set(routeIds));

  // Extract route names
  const routeNames: string[] = [];
  if (attributes.ROUTE_NAME) {
    const routeName = String(attributes.ROUTE_NAME);
    routeNames.push(...routeName.split(/[,;]/).map((r) => r.trim()).filter(Boolean));
  }
  if (attributes.ROUTES_NAME) {
    const routesName = String(attributes.ROUTES_NAME);
    routeNames.push(...routesName.split(/[,;]/).map((r) => r.trim()).filter(Boolean));
  }
  const route_names = Array.from(new Set(routeNames));

  // Determine stop type (default to bus for Santa Fe Trails)
  const stop_type: 'bus' | 'rail' | 'other' = 'bus';

  // Extract wheelchair accessibility
  let wheelchair_accessible: boolean | null = null;
  if (attributes.WHEELCHAIR !== undefined) {
    wheelchair_accessible = Boolean(attributes.WHEELCHAIR);
  } else if (attributes.wheelchair_accessible !== undefined) {
    wheelchair_accessible = Boolean(attributes.wheelchair_accessible);
  }

  // Headway not typically in ArcGIS data, leave null
  const avg_headway_minutes: number | null = null;

  return {
    stop_id,
    stop_name,
    route_ids,
    route_names,
    stop_type,
    wheelchair_accessible,
    avg_headway_minutes,
  };
}

/**
 * Fetch a page of features from ArcGIS REST service
 */
async function fetchTransitStopsPage(
  offset: number = 0,
  maxRecords: number = 2000
): Promise<ArcGISResponse> {
  const baseUrl =
    'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/67/query';
  
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
 * Fetch all transit stops with pagination
 */
async function fetchAllTransitStops(): Promise<FeatureCollection<Point>> {
  const features: Feature<Point>[] = [];
  let offset = 0;
  const maxRecords = 2000;
  let hasMore = true;
  let totalFetched = 0;

  console.log('Fetching transit stops from Santa Fe GIS...\n');

  while (hasMore) {
    const response = await fetchTransitStopsPage(offset, maxRecords);
    
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

  // Filter out any features with invalid coordinates (safety check)
  const validFeatures = features.filter((feature) => {
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

  return {
    type: 'FeatureCollection',
    features: validFeatures,
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
      : join(process.cwd(), 'data', 'raw', 'transit', 'transit_stops.geojson');

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const featureCollection = await fetchAllTransitStops();

    // Write GeoJSON file
    writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
    console.log(`\n✓ Saved to: ${outputPath}`);
    console.log(`\nNext step: Process with prepare-data.ts`);
    console.log(`  tsx scripts/prepare-data.ts transit_access ${outputPath} 4326`);
  } catch (error) {
    console.error('\n✗ Error fetching transit stops:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
