import { Database, Connection, DuckDbError } from 'duckdb';
import { join } from 'path';
import type { LayerName } from '../../../../shared/types/geo';

/**
 * Initialize DuckDB database with spatial extension and load layers
 * 
 * @param dbPath - Path to DuckDB database file (use ':memory:' for in-memory)
 * @param dataDir - Directory containing GeoParquet files
 * @returns Initialized DuckDB database instance
 */
export async function initDatabase(
  dbPath: string = ':memory:',
  dataDir: string = join(process.cwd(), 'data')
): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(dbPath, (err: DuckDbError | null) => {
      if (err) {
        reject(err);
        return;
      }

      // Get connection (connect() doesn't take a callback)
      const conn = db.connect();

      // Install and load spatial extension
      conn.exec('INSTALL spatial;', (err: DuckDbError | null) => {
        if (err) {
          reject(err);
          return;
        }

        conn.exec('LOAD spatial;', (err: DuckDbError | null) => {
          if (err) {
            reject(err);
            return;
          }

          // Load layers (will be called after data files exist)
          // For now, just resolve with the database
          // Layers will be loaded when data files are available
          resolve(db);
        });
      });
    });
  });
}

/**
 * Load a layer from GeoParquet file into DuckDB with dual geometry columns
 * 
 * @param conn - DuckDB connection
 * @param layerName - Name of the layer (must match a table name)
 * @param parquetPath - Path to GeoParquet file
 * @param sourceSrid - Source SRID of the geometry (will be validated)
 */
export async function loadLayer(
  conn: Connection,
  layerName: LayerName,
  parquetPath: string,
  sourceSrid: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Validate SRID - only allow known CRSs
    const allowedSrids = [4326, 32613, 3857]; // WGS84, UTM 13N, Web Mercator
    if (!allowedSrids.includes(sourceSrid)) {
      reject(
        new Error(
          `Invalid SRID: ${sourceSrid}. Allowed SRIDs: ${allowedSrids.join(', ')}`
        )
      );
      return;
    }

    // Create table with dual geometries
    // Note: DuckDB spatial extension uses ST_Read to read GeoParquet
    // The geometry column will be named 'geometry' or 'geom' depending on the file
    const sql = `
      CREATE TABLE ${layerName} AS 
      SELECT
        *,
        ST_Transform(geometry, 4326) AS geom_4326,
        ST_Transform(geometry, 32613) AS geom_utm13
      FROM ST_Read('${parquetPath}');
    `;

    conn.exec(sql, (err: DuckDbError | null) => {
      if (err) {
        reject(
          new Error(`Failed to load layer ${layerName}: ${err.message}`)
        );
        return;
      }

      // Verify the table was created
      conn.all(`DESCRIBE ${layerName}`, (err: DuckDbError | null, rows: unknown[]) => {
        if (err) {
          reject(err);
          return;
        }

        console.log(`Loaded layer: ${layerName}`);
        console.log(`Schema:`, rows);
        resolve();
      });
    });
  });
}

/**
 * Get database connection (helper for query execution)
 */
export function getConnection(db: Database): Connection {
  return db.connect();
}

/**
 * Execute a query and return results
 */
export function query<T = unknown>(
  conn: Connection,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(
      sql,
      ...params,
      (err: DuckDbError | null, rows: unknown[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows as T[]);
      }
    );
  });
}

