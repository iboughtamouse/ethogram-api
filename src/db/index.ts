import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config.js';

// Create a connection pool
export const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Handle unexpected errors on idle clients to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

// Simple query helper - returns the full QueryResult
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Run `fn` inside one transaction: BEGIN → fn → COMMIT, with ROLLBACK on any
 * throw. Used by the admin mutations so a data change and its audit row
 * commit together (P3-D5) — neither can land without the other.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Graceful shutdown helper
export async function closePool(): Promise<void> {
  await pool.end();
}
