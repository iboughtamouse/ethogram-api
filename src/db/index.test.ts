import { describe, it, expect, afterAll } from 'vitest';
import { pool, query, closePool } from './index.js';

describe('db', () => {
  afterAll(async () => {
    await closePool();
  });

  it('exports a connection pool', () => {
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });

  it('exports a query function', () => {
    expect(typeof query).toBe('function');
  });

  it('can execute a simple query', async () => {
    const result = await query<{ num: number }>('SELECT 1 as num');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.num).toBe(1);
  });

  it('can execute a parameterized query', async () => {
    const result = await query<{ greeting: string }>('SELECT $1::text as greeting', ['hello']);
    expect(result.rows[0]?.greeting).toBe('hello');
  });
});
