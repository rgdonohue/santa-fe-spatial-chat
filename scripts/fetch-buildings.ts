#!/usr/bin/env tsx
/**
 * Fetch Building Footprints from Santa Fe GIS ArcGIS REST Service
 * 
 * Harvests building footprint data from the public ArcGIS REST endpoint:
 * https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/3
 * 
 * Handles pagination (max 2000 records per request) and field mapping.
 * 
 * Usage:
 *   tsx scripts/fetch-buildings.ts [--output <path>]
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
 * Map ArcGIS fields to our BuildingFootprintProperties schema
 */
function mapArcGISFields(attributes: Record<string, unknown>): {
  building_id: string;
  address: string | null;
  building_type: string | null;
  height: number | null;
  year_built: number | null;
  source: string | null;
  source_year: number | null;
} {
  // Extract building ID (use SFBLDG_ID if available, otherwise OBJECTID)
  const buildingId = attributes.SFBLDG_ID || attributes.OBJECTID || attributes.OBJECTID_1;
  const building_id = buildingId ? String(buildingId) : `building_${attributes.OBJECTID || 'unknown'}`;

  // Extract address
  const address =
    typeof attributes.HBADDR === 'string' && attributes.HBADDR.trim()
      ? attributes.HBADDR.trim()
      : null;

  // Extract building type
  const building_type =
    typeof attributes.TYPE_ === 'string' && attributes.TYPE_.trim()
      ? attributes.TYPE_.trim()
      : null;

  // Extract height (prefer HEIGHT, fallback to BDGWHGT or MAXHGTSVY)
  let height: number | null = null;
  if (attributes.HEIGHT && typeof attributes.HEIGHT === 'number') {
    height = attributes.HEIGHT;
  } else if (attributes.BDGWHGT && typeof attributes.BDGWHGT === 'number') {
    height = attributes.BDGWHGT;
  } else if (attributes.MAXHGTSVY && typeof attributes.MAXHGTSVY === 'number') {
    height = attributes.MAXHGTSVY;
  }

  // Extract year built (HBLTYR might be string, BDSRCYR might be number)
  let year_built: number | null = null;
  if (attributes.BDSRCYR && typeof attributes.BDSRCYR === 'number') {
    year_built = attributes.BDSRCYR;
  } else if (attributes.HBLTYR) {
    const yearStr = String(attributes.HBLTYR);
    const yearMatch = yearStr.match(/\d{4}/);
    if (yearMatch) {
      const parsed = parseInt(yearMatch[0], 10);
      if (parsed > 1800 && parsed <= new Date().getFullYear()) {
        year_built = parsed;
      }
    }
  }

  // Extract source
  const source =
    typeof attributes.BDSRC === 'string' && attributes.BDSRC.trim()
      ? attributes.BDSRC.trim()
      : null;

  // Extract source year
  const source_year =
    attributes.BDSRCYR && typeof attributes.BDSRCYR === 'number'
      ? attributes.BDSRCYR
      : null;

  return {
    building_id,
    address,
    building_type,
    height,
    year_built,
    source,
    source_year,
  };
}

/**
 * Fetch a page of features from ArcGIS REST service
 */
async function fetchBuildingsPage(
  offset: number = 0,
  maxRecords: number = 2000
): Promise<ArcGISResponse> {
  const baseUrl =
    'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/3/query';
  
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
 * Fetch all building footprints with pagination
 */
async function fetchAllBuildings(): Promise<FeatureCollection<Polygon>> {
  const features: Feature<Polygon>[] = [];
  let offset = 0;
  const maxRecords = 2000;
  let hasMore = true;
  let totalFetched = 0;

  console.log('Fetching building footprints from Santa Fe GIS...\n');

  while (hasMore) {
    const response = await fetchBuildingsPage(offset, maxRecords);
    
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
          `  Warning: Skipped feature with building_id ${arcFeature.attributes.SFBLDG_ID || arcFeature.attributes.OBJECTID || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`
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
      : join(process.cwd(), 'data', 'raw', 'buildings', 'buildings.geojson');

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const featureCollection = await fetchAllBuildings();

    // Write GeoJSON file
    writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
    console.log(`\n✓ Saved to: ${outputPath}`);
    console.log(`\nNext step: Process with prepare-data.ts`);
    console.log(`  tsx scripts/prepare-data.ts building_footprints ${outputPath} 4326`);
  } catch (error) {
    console.error('\n✗ Error fetching building footprints:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
