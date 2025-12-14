#!/usr/bin/env tsx
/**
 * Fetch Bikeways from City of Santa Fe GIS
 *
 * Source: Layer 72 - Bikeways
 *
 * Usage:
 *   tsx scripts/fetch-bikeways.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/72';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'bikeways');
const OUTPUT_FILE = join(OUTPUT_DIR, 'bikeways.geojson');

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry: {
    paths: number[][][];
  };
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

interface BikewayProperties {
  bikeway_id: string;
  name: string | null;
  bikeway_type: string;
  surface: string | null;
  length_miles: number | null;
}

/**
 * Convert ArcGIS polyline to GeoJSON LineString or MultiLineString
 */
function arcGISToGeoJSON(paths: number[][][]): GeoJSON.LineString | GeoJSON.MultiLineString {
  if (paths.length === 1) {
    return {
      type: 'LineString',
      coordinates: paths[0].map(([x, y]) => [x, y]),
    };
  }
  return {
    type: 'MultiLineString',
    coordinates: paths.map(path => path.map(([x, y]) => [x, y])),
  };
}

/**
 * Map ArcGIS attributes to our schema
 */
function mapAttributes(attrs: Record<string, unknown>): BikewayProperties {
  return {
    bikeway_id: String(attrs.OBJECTID || ''),
    name: attrs.NAME ? String(attrs.NAME) : attrs.STREET ? String(attrs.STREET) : null,
    bikeway_type: String(attrs.TYPE || attrs.FACILITY || 'bikeway'),
    surface: attrs.SURFACE ? String(attrs.SURFACE) : null,
    length_miles: typeof attrs.LENGTH_MI === 'number' ? attrs.LENGTH_MI :
                  typeof attrs.Shape_Length === 'number' ? attrs.Shape_Length / 5280 : null,
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching bikeways from City GIS...');
  console.log(`URL: ${LAYER_URL}`);

  // First, get layer metadata to understand fields
  const metaResponse = await fetch(`${LAYER_URL}?f=json`);
  const metadata = await metaResponse.json();
  console.log('Layer fields:', metadata.fields?.map((f: { name: string }) => f.name).join(', '));

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
      if (!feature.geometry?.paths) continue;

      allFeatures.push({
        type: 'Feature',
        properties: mapAttributes(feature.attributes),
        geometry: arcGISToGeoJSON(feature.geometry.paths),
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
  console.log(`\nWrote ${allFeatures.length} bikeway features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
