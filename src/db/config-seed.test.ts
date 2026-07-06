import { describe, it, expect, afterAll } from 'vitest';
import { pool, query, closePool } from './index.js';
import { behaviorRowsFor, type ExcelConfig } from '../services/excel.js';
import { EXPECTED_BEHAVIOR_ROWS } from '../test-fixtures/config.js';

/**
 * Sanity checks for the config-as-data seed (migrations 002 + 003).
 * These run against the migrated database, so they verify what CI and every
 * fresh clone actually get — not a fixture.
 */

afterAll(async () => {
  await closePool();
});

describe('config seed (migrations 002 + 003)', () => {
  it('seeds the full behavior catalog: 23 rows, 5 retired legacy values', async () => {
    const result = await query<{ total: string; retired: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE retired_at IS NOT NULL)::text AS retired
       FROM behaviors`
    );
    expect(result.rows[0]).toEqual({ total: '23', retired: '5' });
  });

  it('seeds the six behavior groups in BEHAVIOR_GROUP_ORDER', async () => {
    const result = await query<{ name: string }>(
      'SELECT name FROM behavior_groups ORDER BY sort_order'
    );
    expect(result.rows.map((r) => r.name)).toEqual([
      'Feeding',
      'Locomotion',
      'Resting',
      'Maintenance',
      'Social & Environmental',
      'Other',
    ]);
  });

  it('seeds vocab options per kind (placeholders excluded)', async () => {
    const result = await query<{ kind: string; count: string }>(
      'SELECT kind, COUNT(*)::text AS count FROM vocab_options GROUP BY kind ORDER BY kind'
    );
    expect(result.rows).toEqual([
      { kind: 'animal', count: '9' },
      { kind: 'animal_interaction', count: '11' },
      { kind: 'object', count: '10' },
      { kind: 'object_interaction', count: '6' },
    ]);
  });

  it("seeds Sayyida's Cove with 38 perches (VALID_PERCHES ∪ inline dropdown, incl. Ground)", async () => {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM perches p
       JOIN aviaries a ON a.id = p.aviary_id WHERE a.slug = 'sayyidas-cove'`
    );
    expect(result.rows[0]!.count).toBe('38');

    const ground = await query<{ label: string; perch_group: string }>(
      `SELECT label, perch_group FROM perches WHERE value = 'Ground'`
    );
    expect(ground.rows[0]).toEqual({ label: 'Ground', perch_group: 'Common Locations' });
  });

  it('seeds Sayyida + the 2026 juveniles as open episodes (migrations 003 + 005)', async () => {
    const result = await query<{ name: string; species: string; subject_type: string; departed_on: string | null }>(
      `SELECT name, species, subject_type, departed_on::text FROM subjects ORDER BY subject_type, name`
    );
    expect(result.rows).toEqual([
      { name: 'Sayyida', species: 'Barred Owl', subject_type: 'foster_parent', departed_on: null },
      { name: '187(B)', species: 'Barred Owl', subject_type: 'juvenile', departed_on: null },
      { name: '216(O)', species: 'Barred Owl', subject_type: 'juvenile', departed_on: null },
      { name: '253(R)', species: 'Barred Owl', subject_type: 'juvenile', departed_on: null },
    ]);
  });

  it('publishes config v2 with all four subjects (migration 005)', async () => {
    const result = await query<{ id: number; subject_count: number }>(
      `SELECT id, jsonb_array_length(config->'aviaries'->0->'subjects') AS subject_count
       FROM config_versions ORDER BY id DESC LIMIT 1`
    );
    expect(result.rows[0]!.id).toBeGreaterThanOrEqual(2);
    expect(result.rows[0]!.subject_count).toBe(4);
  });

  it("enables the full catalog for Sayyida's Cove", async () => {
    const result = await query<{ behaviors: string; vocab: string }>(
      `SELECT (SELECT COUNT(*) FROM aviary_behaviors)::text AS behaviors,
              (SELECT COUNT(*) FROM aviary_vocab_options)::text AS vocab`
    );
    expect(result.rows[0]).toEqual({ behaviors: '23', vocab: '36' });
  });

  it('rejects overlapping subject episodes (EXCLUDE constraint)', async () => {
    await expect(
      query(
        `INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
         SELECT aviary_id, name, species, 'juvenile', arrived_on + 1 FROM subjects WHERE name = 'Sayyida'`
      )
    ).rejects.toThrow(/no_overlapping_episodes/);
  });

  it('allows a back-to-back episode transition (half-open ranges)', async () => {
    // Close-and-reopen on the same date must NOT trip the overlap guard.
    // Uses one dedicated client (pool.query would spread BEGIN/ROLLBACK across
    // connections) and rolls back so the seed state is untouched.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE subjects SET departed_on = arrived_on + 10 WHERE name = 'Sayyida'`
      );
      await client.query(
        `INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
         SELECT aviary_id, name, species, 'juvenile', arrived_on + 10 FROM subjects WHERE name = 'Sayyida'`
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('publishes config version 1 matching compose_config()', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM config_versions'
    );
    expect(Number(result.rows[0]!.count)).toBeGreaterThanOrEqual(1);

    const doc = await query<{ config: Record<string, unknown> }>(
      'SELECT config FROM config_versions ORDER BY id LIMIT 1'
    );
    const config = doc.rows[0]!.config;
    expect(Object.keys(config).sort()).toEqual([
      'animalInteractionTypes',
      'animals',
      'aviaries',
      'behaviorGroups',
      'behaviors',
      'objectInteractionTypes',
      'objects',
    ]);

    const behaviors = config.behaviors as Array<Record<string, unknown>>;
    expect(behaviors).toHaveLength(23);
    expect(behaviors[0]).toMatchObject({
      value: 'eating',
      label: 'Eating',
      group: 'Feeding',
      requiresLocation: true,
      excelRowLabel: 'Eating (Note Location)',
      excelRowOrder: 1,
      retired: false,
    });

    const aviaries = config.aviaries as Array<Record<string, unknown>>;
    expect(aviaries).toHaveLength(1);
    expect(aviaries[0]).toMatchObject({ slug: 'sayyidas-cove', name: "Sayyida's Cove", isActive: true });
    expect(aviaries[0]!.perchDiagrams).toHaveLength(2);
    const vocabulary = aviaries[0]!.vocabulary as Record<string, string[]>;
    expect(vocabulary.behaviors).toHaveLength(23);
    expect(vocabulary.objects).toHaveLength(10);
  });

  it('derives Excel rows from version 1 identical to the retired hardcoded map (golden parity)', async () => {
    const result = await query<{ config: ExcelConfig }>(
      'SELECT config FROM config_versions ORDER BY id LIMIT 1'
    );

    const rows = behaviorRowsFor(result.rows[0]!.config, "Sayyida's Cove", {});
    expect(rows).toEqual(EXPECTED_BEHAVIOR_ROWS);
  });

  // Note: no steady-state assertion on observations.config_version_id here —
  // observations.test.ts inserts unstamped rows concurrently (stamping arrives
  // in stage B), so that column's backfill is verified manually post-deploy.
});
