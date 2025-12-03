import { Hono } from 'hono';
import { LAYER_SCHEMAS } from '../../../shared/types/geo';

const layers = new Hono();

/**
 * GET /api/layers
 * Returns available layers and their schemas
 */
layers.get('/', (c) => {
  return c.json({
    layers: Object.values(LAYER_SCHEMAS),
  });
});

export default layers;

