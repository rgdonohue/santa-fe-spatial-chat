#!/usr/bin/env tsx
/**
 * Fetch Historic Districts from City of Santa Fe GIS
 *
 * Source: Layer 118 - Historic Districts
 *
 * Usage:
 *   tsx scripts/fetch-historic-districts.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/118';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'historic_districts');
const OUTPUT_FILE = join(OUTPUT_DIR, 'historic_districts.geojson');

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

interface HistoricDistrictProperties {
  district_id: string;
  district_name: string;
  designation_type: 'national' | 'state' | 'local';
  designation_date: string | null;
  restrictions: string[];
}

/**
 * Parse HTE field to determine designation type
 */
function parseDesignationType(hte: string | null): 'national' | 'state' | 'local' {
  if (!hte) return 'local';
  const val = hte.toUpperCase();
  if (val.includes('NATIONAL') || val.includes('NHL') || val.includes('NR')) return 'national';
  if (val.includes('STATE') || val.includes('SR')) return 'state';
  return 'local';
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
function mapAttributes(attrs: Record<string, unknown>): HistoricDistrictProperties {
  const hte = attrs.HTE as string | null;

  return {
    district_id: String(attrs.HDIST_CD || attrs.OBJECTID || ''),
    district_name: String(attrs.HDSTNAM || 'Unknown District'),
    designation_type: parseDesignationType(hte),
    designation_date: null, // Not available in source data
    restrictions: [], // Would need to be populated from zoning code
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching historic districts from City GIS...');
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
  console.log(`\nWrote ${allFeatures.length} historic district features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
