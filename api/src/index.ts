import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import layers from './routes/layers';
import queryRoute, { setDatabase as setQueryDatabase } from './routes/query';
import chatRoute, { setDatabase as setChatDatabase } from './routes/chat';
import templatesRoute from './routes/templates';
import { initDatabase } from './lib/db/init';
import { join } from 'path';

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
