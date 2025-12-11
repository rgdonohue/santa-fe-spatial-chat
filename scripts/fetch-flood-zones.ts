#!/usr/bin/env tsx
/**
 * Fetch FEMA Flood Zones (NFHL) for Santa Fe County
 * 
 * Attempts to fetch from FEMA ArcGIS REST service or provides manual download instructions.
 * 
 * Usage:
 *   tsx scripts/fetch-flood-zones.ts [--output <path>]
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
  const coordinates = rings.map((ring) =>
    ring.map(([x, y]) => [x, y])
  ) as [number[], ...number[][]][];

  return {
    type: 'Polygon',
    coordinates,
  };
}

/**
 * Map FEMA NFHL fields to our FloodZoneProperties schema
 */
function mapNFHLFields(attributes: Record<string, unknown>): {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  flood_risk_level: 'high' | 'moderate' | 'low' | 'minimal';
  base_flood_elevation: number | null;
  source: 'fema_nfhl';
} {
  // Extract zone ID
  const zoneId = attributes.OBJECTID || attributes.FLD_ZONE_ID || attributes.ID;
  const zone_id = zoneId ? String(zoneId) : `zone_${Date.now()}_${Math.random()}`;

  // Extract zone code (e.g., "AE", "X", "A", "VE")
  const zone_code =
    typeof attributes.FLD_ZONE === 'string' && attributes.FLD_ZONE.trim()
      ? attributes.FLD_ZONE.trim()
      : typeof attributes.ZONE_SUBTY === 'string' && attributes.ZONE_SUBTY.trim()
        ? attributes.ZONE_SUBTY.trim()
        : 'UNKNOWN';

  // Extract zone name/description
  const zone_name =
    typeof attributes.ZONE_SUBTY === 'string' && attributes.ZONE_SUBTY.trim()
      ? attributes.ZONE_SUBTY.trim()
      : typeof attributes.FLD_ZONE === 'string' && attributes.FLD_ZONE.trim()
        ? attributes.FLD_ZONE.trim()
        : 'Unknown Zone';

  // Determine flood risk level from zone code
  let flood_risk_level: 'high' | 'moderate' | 'low' | 'minimal' = 'moderate';
  const zoneUpper = zone_code.toUpperCase();
  if (zoneUpper.startsWith('A') || zoneUpper.startsWith('V')) {
    flood_risk_level = 'high'; // A zones (1% annual chance) and V zones (coastal)
  } else if (zoneUpper === 'X' || zoneUpper.startsWith('X')) {
    flood_risk_level = 'low'; // X zones (0.2% annual chance or minimal)
  } else if (zoneUpper.includes('D')) {
    flood_risk_level = 'minimal'; // D zones (undetermined)
  }

  // Extract base flood elevation (BFE)
  let base_flood_elevation: number | null = null;
  if (attributes.ELEV !== undefined && typeof attributes.ELEV === 'number') {
    base_flood_elevation = attributes.ELEV;
  } else if (attributes.BFE !== undefined && typeof attributes.BFE === 'number') {
    base_flood_elevation = attributes.BFE;
  } else if (attributes.ELEVATION !== undefined && typeof attributes.ELEVATION === 'number') {
    base_flood_elevation = attributes.ELEVATION;
  }

  return {
    zone_id,
    zone_code,
    zone_name,
    flood_risk_level,
    base_flood_elevation,
    source: 'fema_nfhl',
  };
}

/**
 * Fetch flood zones from FEMA ArcGIS REST service with spatial filter for Santa Fe County
 */
async function fetchFloodZonesPage(
  offset: number = 0,
  maxRecords: number = 2000,
  geometry?: string
): Promise<ArcGISResponse> {
  // FEMA NFHL ArcGIS REST service
  // Layer 28: "Flood Hazard Zones" (polygon layer with zone codes)
  const baseUrl = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

  // Build query parameters - use simple field list that works
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'FLD_ZONE,ZONE_SUBTY', // Start with minimal fields that work
    outSR: '4326',
    f: 'json',
    returnGeometry: 'true',
    resultOffset: String(offset),
    resultRecordCount: String(maxRecords),
  });

  // Don't use geometry filter - it causes 400 errors
  // We'll filter client-side instead

  const url = `${baseUrl}?${params.toString()}`;
  
  if (offset === 0) {
    console.log(`  Testing URL: ${baseUrl}?where=1%3D1&outFields=FLD_ZONE&f=json&returnCountOnly=true`);
  }
  
  console.log(`  Fetching records ${offset} to ${offset + maxRecords}...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SantaFeSpatialChat/1.0 (Educational Research Project)',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\nResponse: ${errorText.substring(0, 200)}`);
  }

  const data = (await response.json()) as ArcGISResponse;
  
  // Debug: log response structure if empty
  if (offset === 0) {
    console.log('  Response keys:', Object.keys(data));
    if ('error' in data) {
      console.log('  Error:', (data as { error?: unknown }).error);
    }
    if (data.features) {
      console.log(`  Features in response: ${data.features.length}`);
    }
  }
  
  return data;
}

/**
 * Fetch all flood zones with pagination
 * Uses Santa Fe County bounding box: approximately [-106.25, 35.5] to [-105.7, 35.85]
 */
async function fetchAllFloodZones(): Promise<FeatureCollection<Polygon>> {
  const features: Feature<Polygon>[] = [];
  let offset = 0;
  const maxRecords = 2000;
  let hasMore = true;
  let totalFetched = 0;

  // Santa Fe County approximate bounding box (WGS84)
  const bboxMinX = -106.25;
  const bboxMinY = 35.5;
  const bboxMaxX = -105.7;
  const bboxMaxY = 35.85;

  console.log('Fetching flood zones from FEMA NFHL ArcGIS REST service...\n');
  console.log('  Note: FEMA NFHL geometry filter has API limitations');
  console.log('  Fetching sample and filtering to Santa Fe County bbox client-side');
  console.log(`  Bounding box: ${bboxMinX},${bboxMinY} to ${bboxMaxX},${bboxMaxY}`);
  
  // Note: FEMA NFHL geometry filter returns 400 errors
  // We'll fetch a sample without filter and filter client-side by bounding box
  // For production, consider manual download from MSC portal for county-specific data
  
  while (hasMore) {
    try {
      const response = await fetchFloodZonesPage(offset, maxRecords);

      if (!response.features || response.features.length === 0) {
        hasMore = false;
        break;
      }

      // Convert ArcGIS features to GeoJSON and filter to Santa Fe County bbox
      for (const arcFeature of response.features) {
        try {
          const geometry = arcGISPolygonToGeoJSON(arcFeature.geometry.rings);
          
          // Filter by bounding box - check if geometry intersects Santa Fe County bbox
          // Simple check: if any ring vertex is within bbox, include it
          let intersectsBbox = false;
          for (const ring of arcFeature.geometry.rings) {
            for (const [x, y] of ring) {
              if (x >= bboxMinX && x <= bboxMaxX && y >= bboxMinY && y <= bboxMaxY) {
                intersectsBbox = true;
                break;
              }
            }
            if (intersectsBbox) break;
          }
          
          // Skip features outside Santa Fe County bbox
          if (!intersectsBbox) {
            continue;
          }
          
          const properties = mapNFHLFields(arcFeature.attributes);

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
      // Limit total fetch to prevent downloading entire US dataset (5.3M features)
      // Stop when we have reasonable number of matches or hit safety limit
      const maxOffset = 20000; // Safety limit: stop after 20k records checked
      const targetMatches = 1000; // Target: 1000 matching features
      
      hasMore = 
        (response.exceededTransferLimit === true || response.features.length === maxRecords) &&
        offset < maxOffset &&
        features.length < targetMatches;
      
      // If we've checked enough records and found some matches, stop
      if (offset >= 10000 && features.length > 0) {
        hasMore = false;
        console.log(`  Stopping fetch: Found ${features.length} matches after checking ${offset} records`);
      }
      
      offset += maxRecords;
  } catch (error) {
    // FEMA NFHL ArcGIS REST API has limitations (returns 400/500 errors)
    // Document manual download process
    console.error(`\n⚠️  FEMA NFHL ArcGIS REST API has limitations`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n📥 Manual download required:');
    console.error('  1. Visit https://msc.fema.gov/portal/advanceSearch');
    console.error('  2. Search for Santa Fe County, New Mexico');
    console.error('  3. Download "NFHL Data-County" ZIP file');
    console.error('  4. Extract S_FLD_HAZ_AR.shp (flood hazard areas)');
    console.error('  5. Process with: tsx scripts/prepare-data.ts flood_zones <path-to-S_FLD_HAZ_AR.shp> 4326');
    console.error('\n  Note: FEMA NFHL has 5.3M features nationwide.');
    console.error('        County-specific download is more efficient than API filtering.');
    throw error;
  }
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
      : join(process.cwd(), 'data', 'raw', 'flood_zones', 'flood_zones.geojson');

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const featureCollection = await fetchAllFloodZones();

    // Write GeoJSON file
    writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
    console.log(`\n✓ Saved to: ${outputPath}`);
    console.log(`\nNext step: Process with prepare-data.ts`);
    console.log(`  tsx scripts/prepare-data.ts flood_zones ${outputPath} 4326`);
  } catch (error) {
    console.error('\n✗ Error fetching flood zones:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
