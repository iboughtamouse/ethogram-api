import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-config-test@example.com';
const CSRF = { 'x-ethogram-admin': '1' };

let app: FastifyInstance;
let testUserId: string;
let session: string;
let baselineVersion: number;

function getDiff() {
  return app.inject({
    method: 'GET',
    url: '/api/admin/config/diff',
    cookies: { [SESSION_COOKIE]: session },
  });
}

function publish(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/admin/config/publish',
    headers: CSRF,
    cookies: { [SESSION_COOKIE]: session },
    payload,
  });
}

/** Delete any versions this file published and any draft rows it created. */
async function restore(): Promise<void> {
  await query(`DELETE FROM config_versions WHERE id > $1`, [baselineVersion]);
  await query(`DELETE FROM behaviors WHERE value LIKE 'ctest_%'`);
}

beforeAll(async () => {
  app = await buildApp();

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Config Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true RETURNING id`,
    [TEST_EMAIL]
  );
  testUserId = user.rows[0]!.id;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);

  session = generateToken();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '1 day')`,
    [testUserId, hashToken(session)]
  );

  // A previous SIGKILLed run may have left extra versions/draft rows: measure
  // the baseline as the highest version whose publisher was an engineering
  // script (NULL) — dashboard-published leftovers above it get swept
  const base = await query<{ id: number }>(
    `SELECT MAX(id) AS id FROM config_versions WHERE published_by IS NULL`
  );
  baselineVersion = base.rows[0]!.id;
  await restore();
});

afterAll(async () => {
  await restore();
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe('GET /api/admin/config/diff', () => {
  it('reports a clean state as identical with no changes or violations', async () => {
    const response = await getDiff();
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.identical).toBe(true);
    expect(data.latestVersion).toBe(baselineVersion);
    expect(data.changes).toEqual([]);
    expect(data.violations).toEqual([]);
  });
});

describe('POST /api/admin/config/publish', () => {
  it('refuses to publish when nothing changed', async () => {
    const response = await publish();
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/Nothing to publish/);
  });

  it('publishes a draft change end to end: diff → publish → attributed version', async () => {
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/admin/behaviors',
        headers: CSRF,
        cookies: { [SESSION_COOKIE]: session },
        payload: {
          value: 'ctest_stretching',
          label: 'CTest Stretching',
          group: 'Other',
          requiresLocation: false,
          requiresObject: false,
          requiresObjectInteraction: false,
          requiresAnimal: false,
          requiresAnimalInteraction: false,
          requiresDescription: false,
          excelRowLabel: 'CTest Stretching',
        },
      });
      expect(created.statusCode).toBe(201);

      const diff = await getDiff();
      const diffData = diff.json().data;
      expect(diffData.identical).toBe(false);
      expect(diffData.violations).toEqual([]);
      expect(diffData.changes.join('\n')).toMatch(/Behavior added.*ctest_stretching/);

      const published = await publish({ notes: 'ctest publish' });
      expect(published.statusCode).toBe(201);
      const { version, changes } = published.json().data;
      expect(version).toBe(baselineVersion + 1);
      expect(changes.join('\n')).toMatch(/ctest_stretching/);

      const row = await query<{ published_by: string; notes: string }>(
        `SELECT published_by, notes FROM config_versions WHERE id = $1`,
        [version]
      );
      expect(row.rows[0]).toEqual({ published_by: testUserId, notes: 'ctest publish' });

      const audit = await query(
        `SELECT id FROM audit_log WHERE admin_user_id = $1 AND action = 'publish' AND entity_id = $2`,
        [testUserId, String(version)]
      );
      expect(audit.rows).toHaveLength(1);

      // The new version is now the published state: diff is identical again,
      // and a re-publish has nothing to do
      expect((await getDiff()).json().data.identical).toBe(true);
      expect((await publish()).statusCode).toBe(409);

      // The public config endpoint serves the new version
      const publicConfig = await app.inject({ method: 'GET', url: '/api/config' });
      expect(publicConfig.json().version).toBe(version);
    } finally {
      await restore();
    }
  });

  it('blocks publishes that would remove or rename published values (422 + messages)', async () => {
    try {
      // No rename endpoint exists, so simulate drift the only way it could
      // happen — directly in SQL
      await query(`UPDATE behaviors SET value = 'ctest_renamed' WHERE value = 'flying'`);

      const diff = await getDiff();
      expect(diff.json().data.violations.join('\n')).toMatch(/"flying".*retire it instead/);

      const response = await publish();
      expect(response.statusCode).toBe(422);
      expect(response.json().violations.join('\n')).toMatch(/"flying"/);
    } finally {
      await query(`UPDATE behaviors SET value = 'flying' WHERE value = 'ctest_renamed'`);
      await restore();
    }
  });

  it('requires explicit confirmation for requires-flag changes', async () => {
    try {
      await app.inject({
        method: 'PATCH',
        url: '/api/admin/behaviors/flying',
        headers: CSRF,
        cookies: { [SESSION_COOKIE]: session },
        payload: { requiresDescription: true },
      });

      const unconfirmed = await publish();
      expect(unconfirmed.statusCode).toBe(409);
      expect(unconfirmed.json().flagChanges).toEqual(['flying']);

      const confirmed = await publish({ confirmFlagChanges: true });
      expect(confirmed.statusCode).toBe(201);
    } finally {
      await query(`UPDATE behaviors SET requires_description = false WHERE value = 'flying'`);
      await restore();
    }
  });

  it('requires explicit confirmation for Excel row-map changes', async () => {
    const original = (
      await query<{ excel_row_label: string }>(
        `SELECT excel_row_label FROM behaviors WHERE value = 'flying'`
      )
    ).rows[0]!.excel_row_label;
    try {
      await app.inject({
        method: 'PATCH',
        url: '/api/admin/behaviors/flying',
        headers: CSRF,
        cookies: { [SESSION_COOKIE]: session },
        payload: { excelRowLabel: 'CTest Row' },
      });

      const unconfirmed = await publish();
      expect(unconfirmed.statusCode).toBe(409);
      expect(unconfirmed.json().rowMapChanges).toEqual(['flying']);

      const confirmed = await publish({ confirmRowMapChanges: true });
      expect(confirmed.statusCode).toBe(201);
    } finally {
      await query(`UPDATE behaviors SET excel_row_label = $1 WHERE value = 'flying'`, [original]);
      await restore();
    }
  });
});
