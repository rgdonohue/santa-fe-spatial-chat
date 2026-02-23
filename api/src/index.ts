import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import layers, { setLayerRegistry as setLayersRegistry } from './routes/layers';
import queryRoute, {
  setDatabase as setQueryDatabase,
  setLayerRegistry as setQueryLayerRegistry,
} from './routes/query';
import chatRoute, {
  setDatabase as setChatDatabase,
  setLayerRegistry as setChatLayerRegistry,
} from './routes/chat';
import templatesRoute, {
  setAvailableLayers as setTemplateAvailableLayers,
} from './routes/templates';
import { initDatabase } from './lib/db/init';
import { join } from 'path';
import { buildLayerRegistry } from './lib/layers/registry';

const app = new Hono();

// Enable CORS for development
app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
);

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount routes
app.route('/api/layers', layers);
app.route('/api/query', queryRoute);
app.route('/api/chat', chatRoute);
app.route('/api/templates', templatesRoute);

const port = Number(process.env.PORT) || 3000;

// Initialize DuckDB on startup
async function startServer() {
  try {
    console.log('Initializing DuckDB...');
    const dataDir = join(process.cwd(), 'data');
    const db = await initDatabase(':memory:', dataDir);
    setQueryDatabase(db);
    setChatDatabase(db);
    console.log('✓ DuckDB initialized with spatial extension');

    const manifestPath = join(dataDir, 'manifest.json');
    const layerRegistry = await buildLayerRegistry(db, manifestPath);
    setLayersRegistry(layerRegistry);
    setQueryLayerRegistry(layerRegistry);
    setChatLayerRegistry(layerRegistry);
    setTemplateAvailableLayers(layerRegistry.loadedLayerNames);
    console.log(
      `✓ Layer registry initialized (${layerRegistry.loadedLayerNames.length} loaded layers)`
    );

    console.log(`Server is running on port ${port}`);
    serve({
      fetch: app.fetch,
      port,
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
