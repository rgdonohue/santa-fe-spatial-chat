#!/usr/bin/env tsx
/**
 * Fetch City Parks from City of Santa Fe GIS
 *
 * Source: Layer 75 - City Parks
 *
 * Usage:
 *   tsx scripts/fetch-parks.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/75';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'parks');
const OUTPUT_FILE = join(OUTPUT_DIR, 'parks.geojson');

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry: {
    rings: number[][][];
  };
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

interface ParkProperties {
  park_id: string;
  name: string;
  park_type: string;
  owner: string;
  acres: number | null;
  trail_miles: number | null;
  status: string | null;
  council_district: string | null;
}

/**
 * Convert ArcGIS polygon to GeoJSON
 */
function arcGISToGeoJSON(rings: number[][][]): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: rings.map(ring => ring.map(([x, y]) => [x, y])),
  };
}

/**
 * Map ArcGIS attributes to our schema
 */
function mapAttributes(attrs: Record<string, unknown>): ParkProperties {
  // Parse trail miles (may be string)
  let trailMiles: number | null = null;
  if (attrs.TRAIL_MILE) {
    const parsed = parseFloat(String(attrs.TRAIL_MILE));
    if (!isNaN(parsed)) trailMiles = parsed;
  }

  return {
    park_id: String(attrs.PARK_CD || attrs.PARKS_CD || attrs.OBJECTID || ''),
    name: String(attrs.PARK_NAME || attrs.PARKNAM || 'Unknown Park'),
    park_type: String(attrs.PARK_TYPE || 'park'),
    owner: String(attrs.PARK_OWNER || 'City of Santa Fe'),
    acres: typeof attrs.GIS_ACRE === 'number' ? attrs.GIS_ACRE :
           typeof attrs.PARK_SZ === 'number' ? attrs.PARK_SZ : null,
    trail_miles: trailMiles,
    status: attrs.PARK_STATU ? String(attrs.PARK_STATU) : null,
    council_district: attrs.CouncilDis ? String(attrs.CouncilDis) : null,
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching city parks from City GIS...');
  console.log(`URL: ${LAYER_URL}`);

  const allFeatures: GeoJSON.Feature[] = [];
  let offset = 0;
  const batchSize = 2000;

  while (true) {
    const url = new URL(`${LAYER_URL}/query`);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'json');
    url.searchParams.set('resultOffset', String(offset));
    url.searchParams.set('resultRecordCount', String(batchSize));

    console.log(`  Fetching offset ${offset}...`);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as ArcGISResponse;

    if (!data.features || data.features.length === 0) {
      break;
    }

    for (const feature of data.features) {
      if (!feature.geometry?.rings) continue;

      allFeatures.push({
        type: 'Feature',
        properties: mapAttributes(feature.attributes),
        geometry: arcGISToGeoJSON(feature.geometry.rings),
      });
    }

    console.log(`  Fetched ${data.features.length} features (total: ${allFeatures.length})`);

    if (!data.exceededTransferLimit || data.features.length < batchSize) {
      break;
    }

    offset += batchSize;
  }

  const featureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: allFeatures,
  };

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(featureCollection, null, 2));
  console.log(`\nWrote ${allFeatures.length} park features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
