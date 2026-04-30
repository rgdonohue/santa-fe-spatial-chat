import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, Database, DuckDbError } from 'duckdb';
import { QueryBuilder } from '../src/lib/orchestrator/builder';
import { query } from '../src/lib/db/init';
import type { StructuredQuery } from '../../shared/types/query';

let db: Database;
let conn: Connection;

function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err: DuckDbError | null) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function runStructuredQuery(structuredQuery: StructuredQuery): Promise<Array<{ id: string }>> {
  const builder = new QueryBuilder(structuredQuery);
  const built = builder.build();
  return query<{ id: string }>(conn, built.sql, ...built.params);
}

describe('spatial relationship execution', () => {
  beforeAll(async () => {
    db = new Database(':memory:');
    conn = db.connect();
    await exec('INSTALL spatial; LOAD spatial;');
    await exec(`
      CREATE TABLE parcels AS
      SELECT
        id,
        parcel_id,
        address,
        acres,
        assessed_value,
        geom_4326,
        ST_Transform(geom_4326, 'EPSG:4326', 'EPSG:32613', true) AS geom_utm13
      FROM (
        VALUES
          ('near', 'near', 'Near target', 1.0, 100000, ST_GeomFromText('POINT(-105.90000 35.68000)')),
          ('far', 'far', 'Far target', 1.0, 100000, ST_GeomFromText('POINT(-105.91000 35.69000)'))
      ) AS t(id, parcel_id, address, acres, assessed_value, geom_4326);

      CREATE TABLE transit_access AS
      SELECT
        stop_id,
        stop_type,
        geom_4326,
        ST_Transform(geom_4326, 'EPSG:4326', 'EPSG:32613', true) AS geom_utm13
      FROM (
        VALUES
          ('stop-near', 'bus', ST_GeomFromText('POINT(-105.90010 35.68000)'))
      ) AS t(stop_id, stop_type, geom_4326);

      CREATE TABLE flood_zones AS
      SELECT
        zone_id,
        zone_code,
        zone_name,
        flood_risk_level,
        base_flood_elevation,
        source,
        geom_4326,
        ST_Transform(geom_4326, 'EPSG:4326', 'EPSG:32613', true) AS geom_utm13
      FROM (
        VALUES
          ('flood-1', 'A', 'Flood one', 'high', NULL, 'fixture', ST_GeomFromText('POLYGON((-105.901 35.679, -105.899 35.679, -105.899 35.681, -105.901 35.681, -105.901 35.679))'))
      ) AS t(zone_id, zone_code, zone_name, flood_risk_level, base_flood_elevation, source, geom_4326);

      CREATE TABLE city_limits AS
      SELECT
        boundary_id,
        name,
        area_sq_mi,
        area_acres,
        geom_4326,
        ST_Transform(geom_4326, 'EPSG:4326', 'EPSG:32613', true) AS geom_utm13
      FROM (
        VALUES
          ('city', 'Fixture city', 1.0, 640.0, ST_GeomFromText('POLYGON((-105.905 35.675, -105.895 35.675, -105.895 35.685, -105.905 35.685, -105.905 35.675))'))
      ) AS t(boundary_id, name, area_sq_mi, area_acres, geom_4326);

      CREATE TABLE zoning_districts AS
      SELECT
        id,
        zone_code,
        zone_name,
        geom_4326,
        ST_Transform(geom_4326, 'EPSG:4326', 'EPSG:32613', true) AS geom_utm13
      FROM (
        VALUES
          ('zone-small', 'R1', 'Small residential', ST_GeomFromText('POLYGON((-105.902 35.678, -105.898 35.678, -105.898 35.682, -105.902 35.682, -105.902 35.678))'))
      ) AS t(id, zone_code, zone_name, geom_4326);
    `);
  });

  afterAll(() => {
    conn.close();
    db.close();
  });

  it('returns features within distance of target geometries', async () => {
    const rows = await runStructuredQuery({
      selectLayer: 'parcels',
      selectFields: ['id'],
      spatialFilters: [{ op: 'within_distance', targetLayer: 'transit_access', distance: 50 }],
    });
    expect(rows.map((row) => row.id)).toEqual(['near']);
  });

  it('returns features that intersect target geometries', async () => {
    const rows = await runStructuredQuery({
      selectLayer: 'parcels',
      selectFields: ['id'],
      spatialFilters: [{ op: 'intersects', targetLayer: 'flood_zones' }],
    });
    expect(rows.map((row) => row.id)).toEqual(['near']);
  });

  it('returns features within target geometries', async () => {
    const rows = await runStructuredQuery({
      selectLayer: 'parcels',
      selectFields: ['id'],
      spatialFilters: [{ op: 'within', targetLayer: 'city_limits' }],
    });
    expect(rows.map((row) => row.id)).toEqual(['near']);
  });

  it('uses per-target contains semantics instead of requiring the target union to fit', async () => {
    const rows = await runStructuredQuery({
      selectLayer: 'zoning_districts',
      selectFields: ['id'],
      spatialFilters: [{ op: 'contains', targetLayer: 'parcels' }],
    });
    expect(rows.map((row) => row.id)).toEqual(['zone-small']);
  });
});
