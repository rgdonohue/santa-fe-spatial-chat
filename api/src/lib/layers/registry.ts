import { existsSync, readFileSync } from 'fs';
import type { Database } from 'duckdb';
import type { FieldType } from '../../../../shared/types/geo';
import { LAYER_SCHEMAS } from '../../../../shared/types/geo';
import { getConnection, query } from '../db/init';

interface ManifestLayerEntry {
  featureCount?: number;
  fields?: Record<string, string>;
  source?: string;
}

interface ManifestShape {
  layers?: Record<string, ManifestLayerEntry>;
  generatedAt?: string;
}

const INTERNAL_FIELDS = new Set(['geom_4326', 'geom_utm13', 'geometry']);

const VIRTUAL_FIELDS: Record<string, string[]> = {
  zoning_districts: ['allows_residential', 'allows_commercial'],
};

export interface RuntimeLayerInfo {
  name: string;
  geometryType: string;
  description?: string;
  schemaFields: Record<string, FieldType>;
  loadedFields: string[];
  queryableFields: string[];
  featureCount: number | null;
  isLoaded: boolean;
  source?: string;
}

export interface LayerSummary {
  name: string;
  geometryType: string;
  schemaFields: string[];
  isLoaded: boolean;
  loadedFields: string[];
  featureCount: number | null;
  description?: string;
}

export interface LayerRegistry {
  layers: Record<string, RuntimeLayerInfo>;
  loadedLayerNames: string[];
  generatedAt: string;
}

function readManifest(manifestPath: string): ManifestShape {
  if (!existsSync(manifestPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestShape;
  } catch (error) {
    console.warn('Could not parse manifest.json for layer registry:', error);
    return {};
  }
}

async function describeLoadedFields(
  db: Database,
  tableName: string
): Promise<string[]> {
  const conn = getConnection(db);
  try {
    const rows = await query<{ column_name: string }>(
      conn,
      `DESCRIBE "${tableName}"`
    );

    return rows
      .map((row) => row.column_name)
      .filter((name) => !INTERNAL_FIELDS.has(name));
  } catch {
    return [];
  } finally {
    const closable = conn as unknown as { close?: () => void };
    closable.close?.();
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export async function buildLayerRegistry(
  db: Database,
  manifestPath: string
): Promise<LayerRegistry> {
  const manifest = readManifest(manifestPath);
  const manifestLayers = manifest.layers ?? {};
  const layers: Record<string, RuntimeLayerInfo> = {};
  const layerNames = Object.keys(LAYER_SCHEMAS);

  for (const layerName of layerNames) {
    const schema = LAYER_SCHEMAS[layerName];
    if (!schema) {
      continue;
    }
    const manifestEntry = manifestLayers[layerName];
    const isLoaded = Boolean(manifestEntry);
    const describedFields = isLoaded
      ? await describeLoadedFields(db, layerName)
      : [];
    const manifestFields = Object.keys(manifestEntry?.fields ?? {}).filter(
      (name) => !INTERNAL_FIELDS.has(name)
    );
    const loadedFields = unique([...manifestFields, ...describedFields]);
    const virtualFields = VIRTUAL_FIELDS[layerName] ?? [];
    const queryableFields = unique([...loadedFields, ...virtualFields]);

    layers[layerName] = {
      name: layerName,
      geometryType: schema.geometryType,
      description: schema.description,
      schemaFields: schema.fields,
      loadedFields,
      queryableFields,
      featureCount:
        typeof manifestEntry?.featureCount === 'number'
          ? manifestEntry.featureCount
          : null,
      isLoaded,
      source: manifestEntry?.source,
    };
  }

  const loadedLayerNames = Object.values(layers)
    .filter((layer) => layer.isLoaded)
    .map((layer) => layer.name)
    .sort();

  return {
    layers,
    loadedLayerNames,
    generatedAt: manifest.generatedAt ?? new Date().toISOString(),
  };
}

export function getLayerSummaries(registry: LayerRegistry): LayerSummary[] {
  return Object.values(registry.layers)
    .map((layer) => ({
      name: layer.name,
      geometryType: layer.geometryType,
      schemaFields: Object.keys(layer.schemaFields),
      isLoaded: layer.isLoaded,
      loadedFields: layer.loadedFields,
      featureCount: layer.featureCount,
      description: layer.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
