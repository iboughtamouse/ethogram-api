import { Pool } from 'pg';

/**
 * Print the latest published config — the exact GET /api/config response body —
 * to stdout. Used to (re)generate the frontend's bundled snapshot:
 *
 *   DATABASE_URL=... npm run config:export > ../wbs-ethogram-form/src/config/defaultConfig.json
 */
async function exportConfig() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query<{
      id: number;
      published_at: string;
      config: Record<string, unknown>;
    }>('SELECT id, published_at, config FROM config_versions ORDER BY id DESC LIMIT 1');

    const row = result.rows[0];
    if (!row) {
      console.error('No published config version exists — run migrations first');
      process.exit(1);
    }

    const body = {
      version: row.id,
      publishedAt: row.published_at,
      ...row.config,
    };

    console.log(JSON.stringify(body, null, 2));
  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

exportConfig();
