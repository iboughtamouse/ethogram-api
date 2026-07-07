import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-write-test@example.com';
const CSRF = { 'x-ethogram-admin': '1' };
const AVIARY = 'wtest-aviary';

let app: FastifyInstance;
let testUserId: string;
let session: string;

function authed(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: CSRF,
    cookies: { [SESSION_COOKIE]: session },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });
}

/** Remove everything this file may have created (also swept in beforeAll). */
async function sweep(): Promise<void> {
  await query(
    `DELETE FROM aviary_behaviors WHERE aviary_id IN (SELECT id FROM aviaries WHERE slug = $1)`,
    [AVIARY]
  );
  await query(
    `DELETE FROM aviary_vocab_options WHERE aviary_id IN (SELECT id FROM aviaries WHERE slug = $1)`,
    [AVIARY]
  );
  await query(`DELETE FROM subjects WHERE aviary_id IN (SELECT id FROM aviaries WHERE slug = $1)`, [
    AVIARY,
  ]);
  await query(`DELETE FROM perches WHERE aviary_id IN (SELECT id FROM aviaries WHERE slug = $1)`, [
    AVIARY,
  ]);
  await query(`DELETE FROM aviaries WHERE slug = $1`, [AVIARY]);
  await query(`DELETE FROM behaviors WHERE value LIKE 'wtest_%'`);
  await query(`DELETE FROM behavior_groups WHERE name LIKE 'WTest%'`);
  await query(`DELETE FROM vocab_options WHERE value LIKE 'wtest_%'`);
}

beforeAll(async () => {
  app = await buildApp();
  await sweep();

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Write Test Admin')
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
});

afterAll(async () => {
  await sweep();
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe('guard', () => {
  it('rejects mutations without a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/aviaries',
      headers: CSRF,
      payload: { slug: 'nope', name: 'Nope' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('aviaries', () => {
  it('creates, rejects duplicates, and audits', async () => {
    const created = await authed('POST', '/api/admin/aviaries', {
      slug: AVIARY,
      name: 'WTest Aviary',
    });
    expect(created.statusCode).toBe(201);

    const duplicate = await authed('POST', '/api/admin/aviaries', {
      slug: AVIARY,
      name: 'Other Name',
    });
    expect(duplicate.statusCode).toBe(409);

    const audit = await query(
      `SELECT id FROM audit_log WHERE admin_user_id = $1 AND entity = 'aviary' AND entity_id = $2 AND action = 'create'`,
      [testUserId, AVIARY]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('rejects malformed slugs', async () => {
    const response = await authed('POST', '/api/admin/aviaries', {
      slug: 'Bad Slug!',
      name: 'X',
    });
    expect(response.statusCode).toBe(400);
  });

  it('updates name and active flag; 404s unknown slugs', async () => {
    const updated = await authed('PATCH', `/api/admin/aviaries/${AVIARY}`, {
      name: 'WTest Aviary Renamed',
      isActive: false,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ name: 'WTest Aviary Renamed', isActive: false });

    expect((await authed('PATCH', '/api/admin/aviaries/nowhere', { name: 'X' })).statusCode).toBe(
      404
    );
  });
});

describe('perches', () => {
  it('creates with a default sort order after the current max', async () => {
    const first = await authed('POST', `/api/admin/aviaries/${AVIARY}/perches`, {
      value: 'W1',
      label: 'WTest Perch 1',
    });
    expect(first.statusCode).toBe(201);
    await authed('POST', `/api/admin/aviaries/${AVIARY}/perches`, {
      value: 'W2',
      label: 'WTest Perch 2',
    });

    const orders = await query<{ value: string; sort_order: number }>(
      `SELECT p.value, p.sort_order FROM perches p JOIN aviaries a ON a.id = p.aviary_id
       WHERE a.slug = $1 ORDER BY p.sort_order`,
      [AVIARY]
    );
    expect(orders.rows.map((r) => r.value)).toEqual(['W1', 'W2']);
    expect(orders.rows[1]!.sort_order).toBeGreaterThan(orders.rows[0]!.sort_order);
  });

  it('rejects duplicate values per aviary', async () => {
    const response = await authed('POST', `/api/admin/aviaries/${AVIARY}/perches`, {
      value: 'W1',
      label: 'Again',
    });
    expect(response.statusCode).toBe(409);
  });

  it('retires and unretires', async () => {
    await authed('PATCH', `/api/admin/aviaries/${AVIARY}/perches/W2`, { retired: true });
    const retired = await query(
      `SELECT retired_at FROM perches p JOIN aviaries a ON a.id = p.aviary_id
       WHERE a.slug = $1 AND p.value = 'W2'`,
      [AVIARY]
    );
    expect(retired.rows[0]!.retired_at).not.toBeNull();

    await authed('PATCH', `/api/admin/aviaries/${AVIARY}/perches/W2`, { retired: false });
    const unretired = await query(
      `SELECT retired_at FROM perches p JOIN aviaries a ON a.id = p.aviary_id
       WHERE a.slug = $1 AND p.value = 'W2'`,
      [AVIARY]
    );
    expect(unretired.rows[0]!.retired_at).toBeNull();
  });

  it('deletes never-published perches but refuses published ones', async () => {
    const deleted = await authed('DELETE', `/api/admin/aviaries/${AVIARY}/perches/W2`);
    expect(deleted.statusCode).toBe(200);

    // Perch "12" of Sayyida's Cove is in every published version
    const refused = await authed('DELETE', '/api/admin/aviaries/sayyidas-cove/perches/12');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/retire it instead/);
  });
});

describe('subjects', () => {
  it('rejects reserved generic names, case-insensitively (P2-D8)', async () => {
    for (const name of ['Juvenile', 'juvenile', 'JUVENILE']) {
      const response = await authed('POST', `/api/admin/aviaries/${AVIARY}/subjects`, {
        name,
        species: 'Barred Owl',
        type: 'juvenile',
        arrivedOn: '2026-07-01',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/reserved/);
    }
  });

  it('rejects names that fail the Excel sheet-name round-trip', async () => {
    for (const name of ['Bad[Name]', 'History', "'Quoted'", 'X'.repeat(29)]) {
      const response = await authed('POST', `/api/admin/aviaries/${AVIARY}/subjects`, {
        name,
        species: 'Barred Owl',
        type: 'juvenile',
        arrivedOn: '2026-07-01',
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('creates an episode and rejects overlapping ones with a friendly message', async () => {
    const created = await authed('POST', `/api/admin/aviaries/${AVIARY}/subjects`, {
      name: 'WTest Bird',
      species: 'Barred Owl',
      type: 'juvenile',
      arrivedOn: '2026-07-01',
    });
    expect(created.statusCode).toBe(201);

    const overlap = await authed('POST', `/api/admin/aviaries/${AVIARY}/subjects`, {
      name: 'WTest Bird',
      species: 'Barred Owl',
      type: 'juvenile',
      arrivedOn: '2026-07-15',
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toMatch(/overlapping/);
  });

  it('records departures and rejects impossible ones', async () => {
    const id = (
      await query<{ id: string }>(
        `SELECT s.id FROM subjects s JOIN aviaries a ON a.id = s.aviary_id
         WHERE a.slug = $1 AND s.name = 'WTest Bird'`,
        [AVIARY]
      )
    ).rows[0]!.id;

    const tooEarly = await authed('PATCH', `/api/admin/subjects/${id}`, {
      departedOn: '2026-06-01',
    });
    expect(tooEarly.statusCode).toBe(400);

    const departed = await authed('PATCH', `/api/admin/subjects/${id}`, {
      departedOn: '2026-07-20',
    });
    expect(departed.statusCode).toBe(200);
  });

  it('change-type closes the open episode and opens a new one', async () => {
    await authed('POST', `/api/admin/aviaries/${AVIARY}/subjects`, {
      name: 'WTest Changer',
      species: 'Barred Owl',
      type: 'baby',
      arrivedOn: '2026-07-01',
    });
    const id = (
      await query<{ id: string }>(
        `SELECT s.id FROM subjects s JOIN aviaries a ON a.id = s.aviary_id
         WHERE a.slug = $1 AND s.name = 'WTest Changer' AND s.departed_on IS NULL`,
        [AVIARY]
      )
    ).rows[0]!.id;

    const changed = await authed('POST', `/api/admin/subjects/${id}/change-type`, {
      newType: 'juvenile',
      effectiveOn: '2026-07-10',
    });
    expect(changed.statusCode).toBe(200);

    const episodes = await query<{ subject_type: string; departed_on: string | null }>(
      `SELECT s.subject_type, s.departed_on FROM subjects s JOIN aviaries a ON a.id = s.aviary_id
       WHERE a.slug = $1 AND s.name = 'WTest Changer' ORDER BY s.arrived_on`,
      [AVIARY]
    );
    expect(episodes.rows).toHaveLength(2);
    expect(episodes.rows[0]).toMatchObject({ subject_type: 'baby' });
    expect(episodes.rows[0]!.departed_on).not.toBeNull();
    expect(episodes.rows[1]).toMatchObject({ subject_type: 'juvenile', departed_on: null });

    // Closed episode can't change type again; same type is a 400
    const closedId = (
      await query<{ id: string }>(
        `SELECT s.id FROM subjects s JOIN aviaries a ON a.id = s.aviary_id
         WHERE a.slug = $1 AND s.name = 'WTest Changer' AND s.departed_on IS NOT NULL`,
        [AVIARY]
      )
    ).rows[0]!.id;
    expect(
      (
        await authed('POST', `/api/admin/subjects/${closedId}/change-type`, {
          newType: 'foster_parent',
          effectiveOn: '2026-07-12',
        })
      ).statusCode
    ).toBe(409);
  });

  it('deletes never-published episodes but refuses published ones', async () => {
    const draftId = (
      await query<{ id: string }>(
        `SELECT s.id FROM subjects s JOIN aviaries a ON a.id = s.aviary_id
         WHERE a.slug = $1 AND s.name = 'WTest Bird'`,
        [AVIARY]
      )
    ).rows[0]!.id;
    expect((await authed('DELETE', `/api/admin/subjects/${draftId}`)).statusCode).toBe(200);

    const sayyidaId = (
      await query<{ id: string }>(`SELECT id FROM subjects WHERE name = 'Sayyida'`)
    ).rows[0]!.id;
    const refused = await authed('DELETE', `/api/admin/subjects/${sayyidaId}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/departure instead/);
  });
});

describe('behaviors and groups', () => {
  it('requires an existing group and every mandated field', async () => {
    const missingFields = await authed('POST', '/api/admin/behaviors', {
      value: 'wtest_partial',
      label: 'Partial',
    });
    expect(missingFields.statusCode).toBe(400);

    const unknownGroup = await authed('POST', '/api/admin/behaviors', {
      value: 'wtest_lost',
      label: 'Lost',
      group: 'No Such Group',
      requiresLocation: false,
      requiresObject: false,
      requiresObjectInteraction: false,
      requiresAnimal: false,
      requiresAnimalInteraction: false,
      requiresDescription: false,
      excelRowLabel: 'Lost',
    });
    expect(unknownGroup.statusCode).toBe(400);
    expect(unknownGroup.json().error).toMatch(/create it first/);
  });

  it('creates groups and behaviors; insertAfter shifts the Excel row map', async () => {
    expect(
      (
        await authed('POST', '/api/admin/behavior-groups', { name: 'WTest Group', sortOrder: 99 })
      ).statusCode
    ).toBe(201);

    const appended = await authed('POST', '/api/admin/behaviors', {
      value: 'wtest_appended',
      label: 'WTest Appended',
      group: 'WTest Group',
      requiresLocation: true,
      requiresObject: false,
      requiresObjectInteraction: false,
      requiresAnimal: false,
      requiresAnimalInteraction: false,
      requiresDescription: false,
      excelRowLabel: 'WTest Appended',
    });
    expect(appended.statusCode).toBe(201);

    const maxOrder = (
      await query<{ excel_row_order: number }>(
        `SELECT excel_row_order FROM behaviors WHERE value = 'wtest_appended'`
      )
    ).rows[0]!.excel_row_order;
    const others = await query<{ max: number }>(
      `SELECT MAX(excel_row_order) AS max FROM behaviors WHERE value <> 'wtest_appended'`
    );
    expect(maxOrder).toBe(others.rows[0]!.max + 1);

    // insertAfter: lands right after the anchor; everything below shifts down
    const anchorBefore = (
      await query<{ excel_row_order: number }>(
        `SELECT excel_row_order FROM behaviors WHERE value = 'flying'`
      )
    ).rows[0]!.excel_row_order;
    const inserted = await authed('POST', '/api/admin/behaviors', {
      value: 'wtest_inserted',
      label: 'WTest Inserted',
      group: 'WTest Group',
      requiresLocation: false,
      requiresObject: false,
      requiresObjectInteraction: false,
      requiresAnimal: false,
      requiresAnimalInteraction: false,
      requiresDescription: false,
      excelRowLabel: 'WTest Inserted',
      insertAfter: 'flying',
    });
    expect(inserted.statusCode).toBe(201);

    const insertedOrder = (
      await query<{ excel_row_order: number }>(
        `SELECT excel_row_order FROM behaviors WHERE value = 'wtest_inserted'`
      )
    ).rows[0]!.excel_row_order;
    expect(insertedOrder).toBe(anchorBefore + 1);

    // Restore the seed row map exactly: remove the inserted row and unshift
    await query(`DELETE FROM behaviors WHERE value = 'wtest_inserted'`);
    await query(`UPDATE behaviors SET excel_row_order = excel_row_order - 1 WHERE excel_row_order > $1`, [
      insertedOrder,
    ]);
    const anchorAfter = (
      await query<{ excel_row_order: number }>(
        `SELECT excel_row_order FROM behaviors WHERE value = 'flying'`
      )
    ).rows[0]!.excel_row_order;
    expect(anchorAfter).toBe(anchorBefore);
  });

  it('patches labels and retirement', async () => {
    const patched = await authed('PATCH', '/api/admin/behaviors/wtest_appended', {
      label: 'WTest Appended (fixed)',
      retired: true,
    });
    expect(patched.statusCode).toBe(200);
    const row = await query<{ label: string; retired_at: string | null }>(
      `SELECT label, retired_at FROM behaviors WHERE value = 'wtest_appended'`
    );
    expect(row.rows[0]!.label).toBe('WTest Appended (fixed)');
    expect(row.rows[0]!.retired_at).not.toBeNull();
  });

  it('deletes never-published behaviors but refuses published ones', async () => {
    expect((await authed('DELETE', '/api/admin/behaviors/wtest_appended')).statusCode).toBe(200);

    const refused = await authed('DELETE', '/api/admin/behaviors/flying');
    expect(refused.statusCode).toBe(409);
  });
});

describe('vocab options', () => {
  it('creates, patches, and enforces the published-delete rule', async () => {
    expect(
      (
        await authed('POST', '/api/admin/options', {
          kind: 'object',
          value: 'wtest_toy',
          label: 'WTest Toy',
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await authed('POST', '/api/admin/options', {
          kind: 'object',
          value: 'wtest_toy',
          label: 'Again',
        })
      ).statusCode
    ).toBe(409);

    expect(
      (
        await authed('PATCH', '/api/admin/options/object/wtest_toy', { retired: true })
      ).statusCode
    ).toBe(200);

    expect((await authed('DELETE', '/api/admin/options/object/wtest_toy')).statusCode).toBe(200);

    const publishedValue = (
      await query<{ value: string }>(`SELECT value FROM vocab_options WHERE kind = 'animal' LIMIT 1`)
    ).rows[0]!.value;
    const refused = await authed('DELETE', `/api/admin/options/animal/${publishedValue}`);
    expect(refused.statusCode).toBe(409);
  });
});

describe('enablement', () => {
  it('rejects unknown values without touching the junctions', async () => {
    const response = await authed('PUT', `/api/admin/aviaries/${AVIARY}/enablement`, {
      behaviors: ['flying', 'not_a_behavior'],
      object: [],
      object_interaction: [],
      animal: [],
      animal_interaction: [],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not_a_behavior/);

    const untouched = await query(
      `SELECT 1 FROM aviary_behaviors ab JOIN aviaries a ON a.id = ab.aviary_id WHERE a.slug = $1`,
      [AVIARY]
    );
    expect(untouched.rows).toHaveLength(0);
  });

  it('replaces the enablement set atomically', async () => {
    const objectValue = (
      await query<{ value: string }>(
        `SELECT value FROM vocab_options WHERE kind = 'object' LIMIT 1`
      )
    ).rows[0]!.value;

    const response = await authed('PUT', `/api/admin/aviaries/${AVIARY}/enablement`, {
      behaviors: ['flying', 'resting_alert'],
      object: [objectValue],
      object_interaction: [],
      animal: [],
      animal_interaction: [],
    });
    expect(response.statusCode).toBe(200);

    const behaviors = await query(
      `SELECT b.value FROM aviary_behaviors ab
       JOIN aviaries a ON a.id = ab.aviary_id JOIN behaviors b ON b.id = ab.behavior_id
       WHERE a.slug = $1`,
      [AVIARY]
    );
    expect(behaviors.rows).toHaveLength(2);

    // Sayyida's Cove is untouched
    const sayyidas = await query(
      `SELECT 1 FROM aviary_behaviors ab JOIN aviaries a ON a.id = ab.aviary_id
       WHERE a.slug = 'sayyidas-cove'`
    );
    expect(sayyidas.rows).toHaveLength(23);
  });
});
