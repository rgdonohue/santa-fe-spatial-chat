import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'duckdb';
import chatRoute, {
  setDatabase,
  setLayerRegistry,
  setLLMClientForTests,
} from '../src/routes/chat';
import { LLMProviderError, type LLMClient } from '../src/lib/llm/types';
import type { LayerRegistry } from '../src/lib/layers/registry';

const registry: LayerRegistry = {
  generatedAt: '2026-04-30T00:00:00.000Z',
  loadedLayerNames: ['parcels'],
  layers: {
    parcels: {
      name: 'parcels',
      geometryType: 'Polygon',
      schemaFields: {
        parcel_id: 'string',
        address: 'string | null',
        acres: 'number',
        assessed_value: 'number | null',
      },
      loadedFields: ['parcel_id', 'address', 'acres', 'assessed_value'],
      queryableFields: ['parcel_id', 'address', 'acres', 'assessed_value'],
      featureCount: 1,
      isLoaded: true,
    },
  },
};

function makeApp(error: Error): Hono {
  const client: LLMClient = {
    providerName: 'test-provider',
    modelName: 'test-model',
    complete: vi.fn().mockRejectedValue(error),
  };
  setDatabase(new Database(':memory:'));
  setLayerRegistry(registry);
  setLLMClientForTests(client);
  const app = new Hono();
  app.route('/api/chat', chatRoute);
  return app;
}

describe('/api/chat LLM provider failures', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('maps provider authentication failures to 502 and logs provider metadata', async () => {
    const app = makeApp(
      new LLMProviderError('bad key', {
        provider: 'test-provider',
        model: 'test-model',
        kind: 'auth',
        statusCode: 401,
      })
    );

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'show parcels' }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('LLM authentication failure');
    expect(consoleSpy.mock.calls.some(([line]) => {
      const entry = JSON.parse(String(line)) as Record<string, unknown>;
      return entry.event === 'llm.failure' &&
        entry.llmProvider === 'test-provider' &&
        entry.llmModel === 'test-model' &&
        entry.statusCode === 401;
    })).toBe(true);
  });

  it('maps provider rate limits to 503 with Retry-After', async () => {
    const app = makeApp(
      new LLMProviderError('rate limited', {
        provider: 'test-provider',
        model: 'test-model',
        kind: 'rate_limit',
        statusCode: 429,
        retryAfter: '30',
      })
    );

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'show parcels' }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('maps network failures to 503', async () => {
    const app = makeApp(
      new LLMProviderError('network down', {
        provider: 'test-provider',
        model: 'test-model',
        kind: 'network',
      })
    );

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'show parcels' }),
    });

    expect(response.status).toBe(503);
  });
});
