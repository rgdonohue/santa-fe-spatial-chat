import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import layers from './routes/layers';
import queryRoute, { setDatabase } from './routes/query';
import { initDatabase } from './lib/db/init';
import { join } from 'path';

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount routes
app.route('/api', layers);
app.route('/api', queryRoute);

const port = Number(process.env.PORT) || 3000;

// Initialize DuckDB on startup
async function startServer() {
  try {
    console.log('Initializing DuckDB...');
    const dataDir = join(process.cwd(), 'data');
    const db = await initDatabase(':memory:', dataDir);
    setDatabase(db);
    console.log('✓ DuckDB initialized with spatial extension');

    // Note: Data loading will happen when data files are available
    // For now, the database is ready but empty

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
