import { Database, Connection, DuckDbError } from 'duckdb';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import type { LayerName } from '../../../../shared/types/geo';
import { LAYER_SCHEMAS } from '../../../../shared/types/geo';

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

          // Auto-load all available parquet files
          loadAllLayers(conn, dataDir)
            .then(() => resolve(db))
            .catch((loadErr) => {
              console.warn('Warning: Some layers failed to load:', loadErr);
              // Still resolve - partial data is better than none
              resolve(db);
            });
        });
      });
    });
  });
}

/**
 * Auto-load all parquet files from data directory
 */
async function loadAllLayers(
  conn: Connection,
  dataDir: string
): Promise<void> {
  if (!existsSync(dataDir)) {
    console.log('Data directory does not exist:', dataDir);
    return;
  }

  // Find all .parquet files
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.parquet'));

  if (files.length === 0) {
    console.log('No parquet files found in:', dataDir);
    return;
  }

  console.log(`Found ${files.length} parquet files to load`);

  for (const file of files) {
    const layerName = file.replace('.parquet', '');
    const filePath = join(dataDir, file);

    // Check if this is a known layer
    if (!(layerName in LAYER_SCHEMAS)) {
      console.warn(`  Skipping unknown layer: ${layerName}`);
      continue;
    }

    try {
      await loadParquetLayer(conn, layerName as LayerName, filePath);
      console.log(`  ✓ Loaded: ${layerName}`);
    } catch (err) {
      console.error(`  ✗ Failed to load ${layerName}:`, err);
    }
  }
}

/**
 * Load a parquet file and create dual geometry columns
 * The parquet files have geometry stored as GEOMETRY type (via ST_Read export).
 */
async function loadParquetLayer(
  conn: Connection,
  layerName: LayerName,
  parquetPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // The parquet files have geometry column - create dual CRS columns
    const sql = `
      CREATE TABLE "${layerName}" AS
      SELECT
        * EXCLUDE (geometry),
        geometry AS geom_4326,
        ST_Transform(geometry, 'EPSG:4326', 'EPSG:32613') AS geom_utm13
      FROM read_parquet('${parquetPath}');
    `;

    conn.exec(sql, (err: DuckDbError | null) => {
      if (err) {
        reject(new Error(`Failed to load ${layerName}: ${err.message}`));
        return;
      }

      // Get row count
      conn.all(
        `SELECT COUNT(*) as count FROM "${layerName}"`,
        (countErr: DuckDbError | null, rows: unknown[]) => {
          if (countErr) {
            resolve(); // Still consider it loaded
            return;
          }
          const count = (rows[0] as { count: number }).count;
          console.log(`    ${count} features`);
          resolve();
        }
      );
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

