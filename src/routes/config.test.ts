import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { closePool } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/config', () => {
  it('serves the latest published config with version envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBeGreaterThanOrEqual(1);
    expect(body.publishedAt).toBeTruthy();
    expect(body.behaviors).toHaveLength(23);
    expect(body.behaviorGroups).toHaveLength(6);
    expect(body.aviaries).toHaveLength(1);
    expect(body.aviaries[0].slug).toBe('sayyidas-cove');
    expect(body.aviaries[0].vocabulary.behaviors).toHaveLength(23);
  });

  it('sets ETag and short-cache headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });

    expect(response.headers.etag).toMatch(/^"\d+"$/);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=300, stale-while-revalidate=86400'
    );
  });

  it('returns 304 on a matching If-None-Match', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/config' });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { 'if-none-match': etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    expect(second.headers.etag).toBe(etag);
  });

  it('returns 304 for a weak-prefixed If-None-Match (proxy behavior)', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/config' });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { 'if-none-match': `W/${etag}` },
    });

    expect(second.statusCode).toBe(304);
  });

  it('returns 200 on a stale If-None-Match', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { 'if-none-match': '"0"' },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/config/versions/:id', () => {
  it('serves version 1 with immutable cache headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config/versions/1' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe(1);
    expect(body.behaviors).toHaveLength(23);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers.etag).toBe('"1"');
  });

  it('returns 404 for a version that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/config/versions/999999',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a non-numeric version id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config/versions/abc' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 (not a Postgres 500) for an id beyond int4 range', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/config/versions/9999999999',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
