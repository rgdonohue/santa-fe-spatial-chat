#!/usr/bin/env tsx
/**
 * Fetch Neighborhood Associations from City of Santa Fe GIS
 *
 * Source: Layer 101 - Neighborhood Associations
 *
 * Usage:
 *   tsx scripts/fetch-neighborhoods.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/101';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'neighborhoods');
const OUTPUT_FILE = join(OUTPUT_DIR, 'neighborhoods.geojson');

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

interface NeighborhoodProperties {
  neighborhood_id: string;
  name: string;
  type: string;
  established_date: string | null;
  notes: string | null;
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
function mapAttributes(attrs: Record<string, unknown>): NeighborhoodProperties {
  // Parse date if available
  let establishedDate: string | null = null;
  if (attrs.Date_) {
    const timestamp = attrs.Date_ as number;
    if (timestamp) {
      establishedDate = new Date(timestamp).toISOString().split('T')[0];
    }
  }

  return {
    neighborhood_id: String(attrs.OBJECTID || attrs.OBJECTID_1 || ''),
    name: String(attrs.NEIASSCO || 'Unknown Neighborhood'),
    type: String(attrs.Type || 'neighborhood'),
    established_date: establishedDate,
    notes: attrs.Notes ? String(attrs.Notes) : null,
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching neighborhood associations from City GIS...');
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
  console.log(`\nWrote ${allFeatures.length} neighborhood features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
