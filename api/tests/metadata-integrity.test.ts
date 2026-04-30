import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from 'duckdb';
import { LAYER_SCHEMAS } from '../../shared/types/geo';
import fieldLabels from '../../shared/locales/field-labels.json';
import { buildLayerRegistry, getLayerSummaries } from '../src/lib/layers/registry';

describe('metadata integrity', () => {
  it('does not leak absolute local paths in the data manifest', () => {
    const manifest = readFileSync(join(process.cwd(), 'data', 'manifest.json'), 'utf-8');
    expect(manifest).not.toMatch(/\/Users\//);
    expect(manifest).not.toMatch(/\/home\//);
  });

  it('has field-label entries for every registered layer', () => {
    const labels = fieldLabels as Record<string, unknown>;
    for (const layerName of Object.keys(LAYER_SCHEMAS)) {
      expect(labels[layerName], `${layerName} missing from field-labels.json`).toBeDefined();
    }
  });

  it('excludes manifest layers that do not exist as DuckDB tables', async () => {
    const db = new Database(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'parcela-manifest-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        layers: {
          parcels: {
            featureCount: 1,
            fields: { parcel_id: 'VARCHAR' },
          },
        },
      })
    );

    const registry = await buildLayerRegistry(db, manifestPath);
    const summaries = getLayerSummaries(registry);

    expect(registry.loadedLayerNames).not.toContain('parcels');
    expect(summaries.map((layer) => layer.name)).not.toContain('parcels');
    db.close();
  });
});
