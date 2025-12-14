#!/usr/bin/env tsx
/**
 * Fetch City Limits from City of Santa Fe GIS
 *
 * Source: Layer 99 - City Limits (Polygon)
 *
 * Usage:
 *   tsx scripts/fetch-city-limits.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/99';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'city_limits');
const OUTPUT_FILE = join(OUTPUT_DIR, 'city_limits.geojson');

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

interface CityLimitsProperties {
  boundary_id: string;
  name: string;
  area_sq_mi: number | null;
  area_acres: number | null;
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
function mapAttributes(attrs: Record<string, unknown>): CityLimitsProperties {
  return {
    boundary_id: String(attrs.OBJECTID || attrs.OBJECTID_1 || attrs.Id || '1'),
    name: 'City of Santa Fe',
    area_sq_mi: typeof attrs.SqMi === 'number' ? attrs.SqMi : null,
    area_acres: typeof attrs.Ac === 'number' ? attrs.Ac : null,
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching city limits from City GIS...');
  console.log(`URL: ${LAYER_URL}`);

  const allFeatures: GeoJSON.Feature[] = [];

  const url = new URL(`${LAYER_URL}/query`);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'json');

  console.log('  Fetching...');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as ArcGISResponse;

  if (!data.features) {
    throw new Error('No features returned');
  }

  for (const feature of data.features) {
    if (!feature.geometry?.rings) continue;

    allFeatures.push({
      type: 'Feature',
      properties: mapAttributes(feature.attributes),
      geometry: arcGISToGeoJSON(feature.geometry.rings),
    });
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
  console.log(`\nWrote ${allFeatures.length} city limits features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
