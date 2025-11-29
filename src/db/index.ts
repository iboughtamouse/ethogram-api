import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config.js';

// Create a connection pool
export const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Simple query helper - returns the full QueryResult
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

// Graceful shutdown helper
export async function closePool(): Promise<void> {
  await pool.end();
}
