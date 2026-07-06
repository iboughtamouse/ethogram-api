import { Pool } from 'pg';

/**
 * Publish a new config version (Phase 1 stage B).
 *
 * Freezes the current editing-table state (compose_config(), defined in
 * migration 002) into a new config_versions row. No-ops when nothing changed
 * since the latest published version, so re-runs are safe.
 *
 * Usage: DATABASE_URL=... npm run config:publish -- --notes "why"
 */
async function publishConfig() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const notesFlag = process.argv.indexOf('--notes');
  const notes = notesFlag !== -1 ? process.argv[notesFlag + 1] : null;

  if (!notes) {
    console.error('--notes "<why this publish>" is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query<{ id: number; unchanged: boolean }>(
      `WITH latest AS (
         SELECT config FROM config_versions ORDER BY id DESC LIMIT 1
       ),
       inserted AS (
         INSERT INTO config_versions (notes, config)
         SELECT $1, compose_config()
         WHERE NOT EXISTS (SELECT 1 FROM latest WHERE latest.config = compose_config())
         RETURNING id
       )
       SELECT COALESCE((SELECT id FROM inserted), (SELECT MAX(id) FROM config_versions)) AS id,
              NOT EXISTS (SELECT 1 FROM inserted) AS unchanged`,
      [notes]
    );

    const row = result.rows[0];
    if (!row) {
      console.error('Publish failed: no config_versions row could be resolved');
      process.exit(1);
    }

    if (row.unchanged) {
      console.log(`No changes since version ${row.id} — nothing published`);
    } else {
      console.log(`Published config version ${row.id}`);
    }
  } catch (error) {
    console.error('Publish failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

publishConfig();
