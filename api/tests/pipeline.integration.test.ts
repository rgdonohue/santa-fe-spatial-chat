/**
 * Integration tests for the full query pipeline.
 *
 * Uses a self-contained DuckDB fixture with synthetic data —
 * no parquet files or external data required.
 *
 * Pipeline under test:
 *   StructuredQuery → prepareQuery → executeQuery → GeoJSON FeatureCollection
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, Connection, type DuckDbError } from 'duckdb';
import type { StructuredQuery } from '../../shared/types/query';
import type { FeatureCollection } from 'geojson';
import { prepareQuery, executeQuery, type PreparedQuery } from '../src/lib/utils/query-executor';
import type { LayerRegistry } from '../src/lib/layers/registry';

// ─── Helpers ────────────────────────────────────────────────────────

function exec(conn: Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err: DuckDbError | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function queryRows<T = Record<string, unknown>>(
  conn: Connection,
  sql: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err: DuckDbError | null, rows: unknown[]) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

// ─── Fixture Setup ──────────────────────────────────────────────────

let db: Database;
let conn: Connection;
let registry: LayerRegistry;

/**
 * Build a minimal LayerRegistry from the fixture tables.
 * We only need the fields that prepareQuery / executeQuery inspect.
 */
async function buildFixtureRegistry(connection: Connection): Promise<LayerRegistry> {
  const layers: LayerRegistry['layers'] = {};

  const tables = [
    {
      name: 'parcels',
      geometryType: 'Polygon',
      description: 'Property parcels',
    },
    {
      name: 'transit_access',
      geometryType: 'Point',
      description: 'Transit stops',
    },
    {
      name: 'zoning_districts',
      geometryType: 'Polygon',
      description: 'Zoning districts',
    },
    {
      name: 'flood_zones',
      geometryType: 'Polygon',
      description: 'Flood hazard zones',
    },
    {
      name: 'short_term_rentals',
      geometryType: 'Point',
      description: 'STR permits',
    },
  ];

  for (const table of tables) {
    const descRows = await queryRows<{ column_name: string; column_type: string }>(
      connection,
      `DESCRIBE "${table.name}"`
    );

    const internal = new Set(['geom_4326', 'geom_utm13', 'geometry']);
    const loadedFields = descRows
      .map((r) => r.column_name)
      .filter((n) => !internal.has(n));

    const schemaFields: Record<string, string> = {};
    for (const row of descRows) {
      if (internal.has(row.column_name)) continue;
      const isNumeric = row.column_type.includes('INT') || row.column_type.includes('DOUBLE');
      schemaFields[row.column_name] = isNumeric ? 'number | null' : 'string | null';
    }

    // Add virtual fields for zoning
    const queryableFields = [...loadedFields];
    if (table.name === 'zoning_districts') {
      queryableFields.push('allows_residential', 'allows_commercial');
    }

    layers[table.name] = {
      name: table.name,
      geometryType: table.geometryType,
      description: table.description,
      schemaFields,
      loadedFields,
      queryableFields,
      featureCount: null,
      isLoaded: true,
      source: 'fixture',
    };
  }

  return {
    layers,
    loadedLayerNames: Object.keys(layers).sort(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Create fixture tables with synthetic Santa Fe geometry.
 * Coordinates are in the downtown Santa Fe area (~35.687°N, -105.938°W).
 */
async function createFixtureTables(connection: Connection): Promise<void> {
  await exec(connection, 'INSTALL spatial;');
  await exec(connection, 'LOAD spatial;');

  // ── parcels (polygons) ──
  await exec(connection, `
    CREATE TABLE parcels AS
    SELECT
      * EXCLUDE (geom),
      geom AS geom_4326,
      ST_Transform(geom, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
    FROM (
      SELECT
        'P001' AS parcel_id, '100 Main St' AS address, 'R-1' AS zoning,
        'residential' AS land_use, 0.25 AS acres, 1985 AS year_built,
        350000 AS assessed_value,
        ST_GeomFromText('POLYGON((-105.940 35.688, -105.939 35.688, -105.939 35.687, -105.940 35.687, -105.940 35.688))') AS geom
      UNION ALL SELECT
        'P002', '200 Palace Ave', 'R-1', 'residential', 0.30, 2005,
        475000,
        ST_GeomFromText('POLYGON((-105.938 35.688, -105.937 35.688, -105.937 35.687, -105.938 35.687, -105.938 35.688))')
      UNION ALL SELECT
        'P003', '300 Cerrillos Rd', 'C-2', 'commercial', 1.20, 1972,
        890000,
        ST_GeomFromText('POLYGON((-105.942 35.685, -105.941 35.685, -105.941 35.684, -105.942 35.684, -105.942 35.685))')
      UNION ALL SELECT
        'P004', '400 Agua Fria St', 'R-2', 'residential', 0.15, 2018,
        285000,
        ST_GeomFromText('POLYGON((-105.945 35.686, -105.944 35.686, -105.944 35.685, -105.945 35.685, -105.945 35.686))')
      UNION ALL SELECT
        'P005', '500 Canyon Rd', 'R-1', 'residential', 0.40, 1948,
        620000,
        ST_GeomFromText('POLYGON((-105.936 35.686, -105.935 35.686, -105.935 35.685, -105.936 35.685, -105.936 35.686))')
    ) sub
  `);

  // ── transit_access (points) ──
  await exec(connection, `
    CREATE TABLE transit_access AS
    SELECT
      * EXCLUDE (geom),
      geom AS geom_4326,
      ST_Transform(geom, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
    FROM (
      SELECT
        'S001' AS stop_id, 'Downtown Plaza' AS stop_name, 'bus' AS stop_type,
        '["1","2"]' AS route_ids, '["Blue","Red"]' AS route_names,
        'true' AS wheelchair_accessible,
        ST_Point(-105.939, 35.687) AS geom
      UNION ALL SELECT
        'S002', 'Cerrillos & St Francis', 'bus', '["3"]', '["Green"]',
        'false',
        ST_Point(-105.942, 35.685)
      UNION ALL SELECT
        'S003', 'Agua Fria', 'bus', '["1"]', '["Blue"]',
        'true',
        ST_Point(-105.945, 35.686)
    ) sub
  `);

  // ── zoning_districts (polygons) ──
  await exec(connection, `
    CREATE TABLE zoning_districts AS
    SELECT
      * EXCLUDE (geom),
      geom AS geom_4326,
      ST_Transform(geom, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
    FROM (
      SELECT
        'R-1' AS zone_code, 'Single Family Residential' AS zone_name,
        0.5 AS min_lot_size, 8 AS max_density,
        ST_GeomFromText('POLYGON((-105.941 35.689, -105.935 35.689, -105.935 35.686, -105.941 35.686, -105.941 35.689))') AS geom
      UNION ALL SELECT
        'R-2', 'Multi-Family Residential', 0.25, 24,
        ST_GeomFromText('POLYGON((-105.946 35.687, -105.943 35.687, -105.943 35.684, -105.946 35.684, -105.946 35.687))')
      UNION ALL SELECT
        'C-2', 'General Commercial', 0.0, 0,
        ST_GeomFromText('POLYGON((-105.943 35.686, -105.940 35.686, -105.940 35.683, -105.943 35.683, -105.943 35.686))')
    ) sub
  `);

  // ── flood_zones (polygons) ──
  await exec(connection, `
    CREATE TABLE flood_zones AS
    SELECT
      * EXCLUDE (geom),
      geom AS geom_4326,
      ST_Transform(geom, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
    FROM (
      SELECT
        'FZ001' AS zone_id, 'AE' AS zone_code, 'Special Flood Hazard Area' AS zone_name,
        'high' AS flood_risk_level, 7050.0 AS base_flood_elevation,
        ST_GeomFromText('POLYGON((-105.943 35.687, -105.940 35.687, -105.940 35.685, -105.943 35.685, -105.943 35.687))') AS geom
      UNION ALL SELECT
        'FZ002', 'X', 'Minimal Flood Hazard', 'low', NULL,
        ST_GeomFromText('POLYGON((-105.940 35.689, -105.936 35.689, -105.936 35.686, -105.940 35.686, -105.940 35.689))')
    ) sub
  `);

  // ── short_term_rentals (points) ──
  await exec(connection, `
    CREATE TABLE short_term_rentals AS
    SELECT
      * EXCLUDE (geom),
      geom AS geom_4326,
      ST_Transform(geom, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
    FROM (
      SELECT
        'STR001' AS listing_id, 'Entire home' AS property_type,
        'Entire home/apt' AS room_type, 185 AS price_per_night,
        2 AS accommodates, 200 AS availability_365,
        ST_Point(-105.939, 35.688) AS geom
      UNION ALL SELECT
        'STR002', 'Private room', 'Private room', 75,
        1, 340,
        ST_Point(-105.937, 35.687)
      UNION ALL SELECT
        'STR003', 'Entire home', 'Entire home/apt', 250,
        4, 150,
        ST_Point(-105.936, 35.686)
    ) sub
  `);
}

// ─── Test Lifecycle ─────────────────────────────────────────────────

beforeAll(async () => {
  db = await new Promise<Database>((resolve, reject) => {
    const instance = new Database(':memory:', (err: DuckDbError | null) => {
      if (err) reject(err);
      else resolve(instance);
    });
  });
  conn = db.connect();
  await createFixtureTables(conn);
  registry = await buildFixtureRegistry(conn);
}, 30_000);

afterAll(() => {
  const closable = db as unknown as { close?: () => void };
  closable?.close?.();
});

// ─── Helper to run a full pipeline query ────────────────────────────

async function runPipeline(query: StructuredQuery): Promise<{
  result: FeatureCollection;
  prepared: PreparedQuery;
}> {
  const prepared = prepareQuery(query, registry);
  const execution = await executeQuery(prepared, db, { skipCache: true });
  return { result: execution.result, prepared: execution.prepared };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Pipeline integration: attribute queries', () => {
  it('returns all parcels with no filters', async () => {
    const { result } = await runPipeline({ selectLayer: 'parcels' });

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBe(5);
    for (const feature of result.features) {
      expect(feature.type).toBe('Feature');
      expect(feature.geometry).toBeDefined();
      expect(feature.properties).toBeDefined();
      expect(feature.properties!.parcel_id).toBeDefined();
    }
  });

  it('filters parcels by zoning = R-1', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [{ field: 'zoning', op: 'eq', value: 'R-1' }],
    });

    expect(result.features.length).toBe(3);
    for (const feature of result.features) {
      expect(feature.properties!.zoning).toBe('R-1');
    }
  });

  it('filters parcels by assessed_value > 400000', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [{ field: 'assessed_value', op: 'gt', value: 400000 }],
    });

    expect(result.features.length).toBe(3); // P002=475k, P003=890k, P005=620k
    for (const feature of result.features) {
      expect(Number(feature.properties!.assessed_value)).toBeGreaterThan(400000);
    }
  });

  it('supports OR logic across attribute filters', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'zoning', op: 'eq', value: 'R-2' },
        { field: 'zoning', op: 'eq', value: 'C-2' },
      ],
      attributeLogic: 'or',
    });

    expect(result.features.length).toBe(2);
    const zonings = result.features.map((f) => f.properties!.zoning);
    expect(zonings).toContain('R-2');
    expect(zonings).toContain('C-2');
  });

  it('supports IN operator', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'zoning', op: 'in', value: ['R-1', 'R-2'] },
      ],
    });

    expect(result.features.length).toBe(4); // 3 R-1 + 1 R-2
    for (const feature of result.features) {
      expect(['R-1', 'R-2']).toContain(feature.properties!.zoning);
    }
  });

  it('supports LIKE operator', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [
        { field: 'address', op: 'like', value: '%Cerrillos%' },
      ],
    });

    expect(result.features.length).toBe(1);
    expect(result.features[0]!.properties!.address).toContain('Cerrillos');
  });
});

describe('Pipeline integration: numeric field comparisons', () => {
  it('filters parcels by year_built (numeric DOUBLE)', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [{ field: 'year_built', op: 'gt', value: 2000 }],
    });

    // P002 year_built=2005.0, P004 year_built=2018.0
    expect(result.features.length).toBe(2);
    for (const feature of result.features) {
      expect(feature.properties!.year_built).toBeGreaterThan(2000);
    }
  });

  it('filters STRs by price_per_night (numeric DOUBLE)', async () => {
    const { result } = await runPipeline({
      selectLayer: 'short_term_rentals',
      attributeFilters: [{ field: 'price_per_night', op: 'lte', value: 100 }],
    });

    // STR002 price_per_night=75.0
    expect(result.features.length).toBe(1);
    expect(result.features[0]!.properties!.price_per_night).toBeLessThanOrEqual(100);
  });
});

describe('Pipeline integration: spatial queries', () => {
  it('finds parcels intersecting flood zones', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      spatialFilters: [
        { op: 'intersects', targetLayer: 'flood_zones' },
      ],
    });

    // At least some parcels overlap with the flood zone polygons
    expect(result.features.length).toBeGreaterThan(0);
    expect(result.features.length).toBeLessThanOrEqual(5);
  });

  it('finds parcels within distance of transit', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'transit_access',
          distance: 500,
        },
      ],
    });

    // At least one parcel should be within 500m of a transit stop
    expect(result.features.length).toBeGreaterThan(0);
  });

  it('finds parcels near a specific transit stop type', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'transit_access',
          targetFilter: [{ field: 'stop_type', op: 'eq', value: 'bus' }],
          distance: 300,
        },
      ],
    });

    expect(result.features.length).toBeGreaterThan(0);
  });

  it('combines attribute and spatial filters', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [{ field: 'land_use', op: 'eq', value: 'residential' }],
      spatialFilters: [
        {
          op: 'within_distance',
          targetLayer: 'transit_access',
          distance: 500,
        },
      ],
    });

    expect(result.features.length).toBeGreaterThan(0);
    for (const feature of result.features) {
      expect(feature.properties!.land_use).toBe('residential');
    }
  });
});

describe('Pipeline integration: k-NN nearest neighbor', () => {
  it('finds 2 nearest parcels to transit stops', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      spatialFilters: [
        {
          op: 'nearest',
          targetLayer: 'transit_access',
          limit: 2,
        },
      ],
    });

    expect(result.features.length).toBe(2);
    // Features should have a distance property
    const distances = result.features.map((f) => Number(f.properties!.distance));
    expect(distances[0]).toBeLessThanOrEqual(distances[1]!);
  });

  it('finds nearest parcels with attribute filter', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      attributeFilters: [{ field: 'land_use', op: 'eq', value: 'residential' }],
      spatialFilters: [
        {
          op: 'nearest',
          targetLayer: 'transit_access',
          limit: 3,
        },
      ],
    });

    expect(result.features.length).toBeLessThanOrEqual(3);
    for (const feature of result.features) {
      expect(feature.properties!.land_use).toBe('residential');
    }
  });
});

describe('Pipeline integration: aggregation', () => {
  it('counts parcels grouped by zoning', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      aggregate: {
        groupBy: ['zoning'],
        metrics: [{ field: '*', op: 'count', alias: 'count' }],
      },
    });

    // Should have 3 groups: R-1 (3), R-2 (1), C-2 (1)
    expect(result.features.length).toBe(3);
  });

  it('calculates median assessed value by zoning', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      aggregate: {
        groupBy: ['zoning'],
        metrics: [
          { field: 'assessed_value', op: 'median', alias: 'median_value' },
          { field: '*', op: 'count', alias: 'count' },
        ],
      },
    });

    expect(result.features.length).toBe(3);
    // Aggregate results have null geometry and aggregate fields in properties
    for (const feature of result.features) {
      expect(feature.geometry).toBeNull();
      expect(feature.properties!.zoning).toBeDefined();
      expect(feature.properties!.median_value).toBeDefined();
      expect(feature.properties!.count).toBeDefined();
    }
  });
});

describe('Pipeline integration: normalization', () => {
  it('rewrites allows_residential=true to zone_code LIKE R%', async () => {
    const { result, prepared } = await runPipeline({
      selectLayer: 'zoning_districts',
      attributeFilters: [{ field: 'allows_residential', op: 'eq', value: true }],
    });

    expect(prepared.normalizationNotes).toContain(
      'Mapped allows_residential=true to zone_code LIKE R%'
    );
    // Should match R-1 and R-2
    expect(result.features.length).toBe(2);
    for (const feature of result.features) {
      expect((feature.properties!.zone_code as string).startsWith('R')).toBe(true);
    }
  });
});

describe('Pipeline integration: limit enforcement', () => {
  it('applies default limit and records metadata', async () => {
    const { prepared } = await runPipeline({
      selectLayer: 'parcels',
    });

    expect(prepared.defaultLimitApplied).toBe(true);
    expect(prepared.maxFeaturesApplied).toBeGreaterThan(0);
    expect(prepared.queryHash).toBeDefined();
    expect(prepared.sourceLayers).toContain('parcels');
  });

  it('includes spatial target layers in sourceLayers', async () => {
    const { prepared } = await runPipeline({
      selectLayer: 'parcels',
      spatialFilters: [
        { op: 'intersects', targetLayer: 'flood_zones' },
      ],
    });

    expect(prepared.sourceLayers).toContain('parcels');
    expect(prepared.sourceLayers).toContain('flood_zones');
  });
});

describe('Pipeline integration: orderBy and limit', () => {
  it('orders parcels by assessed_value descending', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      orderBy: { field: 'assessed_value', direction: 'desc' },
      limit: 3,
    });

    expect(result.features.length).toBe(3);
    const values = result.features.map((f) => Number(f.properties!.assessed_value));
    expect(values[0]).toBeGreaterThanOrEqual(values[1]!);
    expect(values[1]).toBeGreaterThanOrEqual(values[2]!);
  });
});

describe('Pipeline integration: GeoJSON output format', () => {
  it('produces valid GeoJSON Features with parsed geometry', async () => {
    const { result } = await runPipeline({
      selectLayer: 'parcels',
      limit: 1,
    });

    const feature = result.features[0]!;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    expect(Array.isArray((feature.geometry as GeoJSON.Polygon).coordinates)).toBe(true);
    // Should not leak internal geometry columns
    expect(feature.properties!.geom_4326).toBeUndefined();
    expect(feature.properties!.geom_utm13).toBeUndefined();
  });

  it('produces Point geometry for transit stops', async () => {
    const { result } = await runPipeline({
      selectLayer: 'transit_access',
      limit: 1,
    });

    const feature = result.features[0]!;
    expect(feature.geometry.type).toBe('Point');
  });
});

describe('Pipeline integration: error handling', () => {
  it('rejects queries against unloaded layers', () => {
    expect(() =>
      prepareQuery(
        { selectLayer: 'affordable_housing_units' },
        registry
      )
    ).toThrow();
  });

  it('rejects queries with non-existent fields', () => {
    expect(() =>
      prepareQuery(
        {
          selectLayer: 'parcels',
          attributeFilters: [{ field: 'nonexistent_field', op: 'eq', value: 'x' }],
        },
        registry
      )
    ).toThrow();
  });
});
