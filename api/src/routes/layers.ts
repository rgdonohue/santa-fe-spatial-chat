import { Hono } from 'hono';
import { LAYER_SCHEMAS } from '../../../shared/types/geo';
import {
  getLayerSummaries,
  type LayerRegistry,
} from '../lib/layers/registry';

const layers = new Hono();
let layerRegistry: LayerRegistry | null = null;

export function setLayerRegistry(registry: LayerRegistry): void {
  layerRegistry = registry;
}

/**
 * GET /api/layers
 * Returns available layers and their schemas
 */
layers.get('/', (c) => {
  if (layerRegistry) {
    const summaries = getLayerSummaries(layerRegistry);
    return c.json({
      layers: summaries,
      count: summaries.length,
      loadedCount: summaries.filter((layer) => layer.isLoaded).length,
      generatedAt: layerRegistry.generatedAt,
    });
  }

  return c.json({
    layers: Object.values(LAYER_SCHEMAS).map((layer) => ({
      name: layer.name,
      geometryType: layer.geometryType,
      schemaFields: Object.keys(layer.fields),
      isLoaded: false,
      loadedFields: [],
      featureCount: null,
      description: layer.description,
    })),
    count: Object.keys(LAYER_SCHEMAS).length,
    loadedCount: 0,
  });
});

export default layers;
