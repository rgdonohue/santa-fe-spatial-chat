#!/usr/bin/env tsx
/**
 * Fetch FEMA Flood Zones from City of Santa Fe GIS
 *
 * Source: Layer 32 - FEMA Flood Plain 100yr Dec 4, 2012
 *
 * Usage:
 *   tsx scripts/fetch-flood-zones-city.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LAYER_URL = 'https://gis.santafenm.gov/server/rest/services/Public_Viewer/MapServer/32';
const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'flood_zones');
const OUTPUT_FILE = join(OUTPUT_DIR, 'flood_zones.geojson');

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

interface FloodZoneProperties {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  flood_risk_level: 'high' | 'moderate' | 'low' | 'minimal';
  base_flood_elevation: number | null;
  source: string;
}

/**
 * Map FEMA zone codes to readable names and risk levels
 */
function mapFloodZone(zoneCode: string): { name: string; risk: 'high' | 'moderate' | 'low' | 'minimal' } {
  const code = (zoneCode || '').toUpperCase().trim();

  // High risk zones (Special Flood Hazard Areas)
  if (code.startsWith('A') || code.startsWith('V')) {
    if (code === 'AE') return { name: '1% Annual Chance Flood Hazard (AE)', risk: 'high' };
    if (code === 'AO') return { name: 'River or Stream Flood Hazard (AO)', risk: 'high' };
    if (code === 'AH') return { name: 'Shallow Flooding (AH)', risk: 'high' };
    if (code === 'A') return { name: '1% Annual Chance Flood Hazard (A)', risk: 'high' };
    if (code === 'VE') return { name: 'Coastal High Hazard (VE)', risk: 'high' };
    return { name: `High Risk Flood Zone (${code})`, risk: 'high' };
  }

  // Moderate risk
  if (code === 'X' || code.includes('SHADED')) {
    return { name: '0.2% Annual Chance Flood Hazard (X Shaded)', risk: 'moderate' };
  }

  // Low/minimal risk
  if (code === 'X' || code === 'C' || code === 'B') {
    return { name: 'Minimal Flood Hazard (X)', risk: 'minimal' };
  }

  return { name: `Flood Zone ${code}`, risk: 'low' };
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
function mapAttributes(attrs: Record<string, unknown>): FloodZoneProperties {
  const zoneCode = String(attrs.FLD_ZONE || 'UNKNOWN');
  const { name, risk } = mapFloodZone(zoneCode);
  const sfha = String(attrs.SFHA_TF || '').toUpperCase();

  // Override risk level based on SFHA_TF (Special Flood Hazard Area True/False)
  let riskLevel = risk;
  if (sfha === 'T') riskLevel = 'high';
  else if (sfha === 'F' && risk === 'high') riskLevel = 'moderate';

  return {
    zone_id: String(attrs.FLD_AR_ID || attrs.OBJECTID || ''),
    zone_code: zoneCode,
    zone_name: name,
    flood_risk_level: riskLevel,
    base_flood_elevation: typeof attrs.STATIC_BFE === 'number' ? attrs.STATIC_BFE : null,
    source: 'FEMA NFHL via City of Santa Fe GIS (Dec 2012)',
  };
}

async function fetchLayer(): Promise<void> {
  console.log('Fetching flood zones from City GIS...');
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
  console.log(`\nWrote ${allFeatures.length} flood zone features to ${OUTPUT_FILE}`);
}

fetchLayer().catch(console.error);
