import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import layers from './routes/layers';

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount layers route
app.route('/api', layers);

const port = Number(process.env.PORT) || 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
