#!/usr/bin/env node
/**
 * Re-cast VARCHAR numeric fields in existing parquets to DOUBLE.
 *
 * Run from api/ directory:
 *   npx tsx scripts/recast-parquets.ts
 *
 * This is a one-time migration for layers whose raw source files are no
 * longer on disk. Future layers should be regenerated via prepare-data.ts,
 * which applies TRY_CAST at ingest. Once this script has run, the
 * VARCHAR_NUMERIC_FIELDS workaround in builder.ts can be removed.
 */

import { Database, type DuckDbError } from 'duckdb';
import { join } from 'path';
import { existsSync, renameSync } from 'fs';

/** Fields to cast per layer — mirrors VARCHAR_NUMERIC_FIELDS in builder.ts */
const CASTS: Record<string, string[]> = {
  parcels: ['year_built'],
  short_term_rentals: ['accommodates', 'price_per_night', 'availability_365'],
  transit_access: ['avg_headway_minutes'],
  parks: ['trail_miles'],
  bikeways: ['length_miles'],
};

const DATA_DIR = join(process.cwd(), 'data');

async function recastLayer(
  db: Database,
  layerName: string,
  fields: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parquetPath = join(DATA_DIR, `${layerName}.parquet`);
    const tempPath = join(DATA_DIR, `${layerName}_recast.parquet`);

    if (!existsSync(parquetPath)) {
      console.log(`  Skipping ${layerName}: parquet not found`);
      resolve();
      return;
    }

    const conn = db.connect();

    // Check how many values will fail TRY_CAST
    const failureChecks = fields
      .map(
        (f) =>
          `COUNT(*) FILTER (WHERE "${f}" IS NOT NULL AND TRY_CAST("${f}" AS DOUBLE) IS NULL) AS "${f}__failures",` +
          `COUNT(*) FILTER (WHERE "${f}" IS NOT NULL) AS "${f}__non_null"`
      )
      .join(', ');

    const checkSql = `SELECT ${failureChecks} FROM read_parquet('${parquetPath}')`;

    conn.all(checkSql, (err: DuckDbError | null, rows: unknown[]) => {
      if (err) {
        reject(new Error(`Failed to check cast failures for ${layerName}: ${err.message}`));
        return;
      }

      const row = (rows[0] ?? {}) as Record<string, number>;
      for (const field of fields) {
        const failures = Number(row[`${field}__failures`] ?? 0);
        const nonNull = Number(row[`${field}__non_null`] ?? 0);
        if (failures > 0) {
          console.warn(
            `  Warning: ${layerName}.${field}: ${failures}/${nonNull} non-null values fail TRY_CAST → will be NULL`
          );
        } else {
          console.log(
            `  ✓ ${layerName}.${field}: ${nonNull} non-null values cast cleanly to DOUBLE`
          );
        }
      }

      // Build COPY with casts — exclude then append cast versions
      const excludeList = fields.map((f) => `"${f}"`).join(', ');
      const castList = fields.map((f) => `TRY_CAST("${f}" AS DOUBLE) AS "${f}"`).join(', ');

      const copySql = `
        COPY (
          SELECT * EXCLUDE (${excludeList}), ${castList}
          FROM read_parquet('${parquetPath}')
        ) TO '${tempPath}' (FORMAT PARQUET)
      `;

      conn.exec(copySql, (err: DuckDbError | null) => {
        if (err) {
          reject(new Error(`Failed to write recast parquet for ${layerName}: ${err.message}`));
          return;
        }

        renameSync(tempPath, parquetPath);
        console.log(`  ✓ ${layerName}: parquet replaced with DOUBLE-typed fields`);
        resolve();
      });
    });
  });
}

async function main() {
  const db = new Database(':memory:');

  for (const [layerName, fields] of Object.entries(CASTS)) {
    console.log(`\nProcessing: ${layerName} (casting: ${fields.join(', ')})`);
    try {
      await recastLayer(db, layerName, fields);
    } catch (err) {
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  db.close();
  console.log('\n✓ Recast complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
