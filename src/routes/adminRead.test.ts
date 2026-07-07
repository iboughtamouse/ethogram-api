import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-read-test@example.com';

let app: FastifyInstance;
let testUserId: string;
let sessionToken: string;
const observationIds: string[] = [];

async function get(url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: sessionToken } });
}

async function insertObservation(fields: {
  observer: string;
  date: string;
  aviaryText: string;
  aviaryId?: string | null;
  submittedAt: string;
}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO observations (
      observer_name, observation_date, start_time, end_time, aviary, aviary_id, mode,
      time_slots, submitted_at
    ) VALUES ($1, $2, '14:00', '14:30', $3, $4, 'live', $5, $6) RETURNING id`,
    [
      fields.observer,
      fields.date,
      fields.aviaryText,
      fields.aviaryId ?? null,
      JSON.stringify({
        '14:00': [
          { subjectType: 'foster_parent', subjectId: 'Sayyida', behavior: 'resting', location: '5', notes: '' },
        ],
        '14:05': [
          { subjectType: 'foster_parent', subjectId: 'Sayyida', behavior: 'flying', location: '', notes: '' },
        ],
      }),
      fields.submittedAt,
    ]
  );
  const id = result.rows[0]!.id;
  observationIds.push(id);
  return id;
}

beforeAll(async () => {
  app = await buildApp();

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Read Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true
     RETURNING id`,
    [TEST_EMAIL]
  );
  testUserId = user.rows[0]!.id;

  sessionToken = generateToken();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '1 day')`,
    [testUserId, hashToken(sessionToken)]
  );

  const aviaryId = (
    await query<{ id: string }>(`SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'`)
  ).rows[0]!.id;

  await insertObservation({
    observer: 'ReadTest Alice',
    date: '2026-03-01',
    aviaryText: 'sayyidas-cove',
    aviaryId,
    submittedAt: '2026-03-01T20:00:00.000Z',
  });
  await insertObservation({
    observer: 'ReadTest Bob',
    date: '2026-04-01',
    aviaryText: 'Legacy Aviary Label',
    aviaryId: null,
    submittedAt: '2026-04-01T20:00:00.000Z',
  });
});

afterAll(async () => {
  if (observationIds.length) {
    await query(`DELETE FROM observations WHERE id = ANY($1::uuid[])`, [observationIds]);
  }
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe('auth guard on read endpoints', () => {
  it.each([
    '/api/admin/overview',
    '/api/admin/aviaries/sayyidas-cove',
    '/api/admin/vocabulary',
    '/api/admin/config-versions',
    '/api/admin/submissions',
  ])('%s returns 401 without a session', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/admin/overview', () => {
  it('returns aviary cards, the latest version, and the unpublished flag', async () => {
    const response = await get('/api/admin/overview');
    expect(response.statusCode).toBe(200);
    const { aviaries, latestVersion, unpublishedChanges } = response.json().data;

    expect(aviaries).toHaveLength(1);
    expect(aviaries[0]).toMatchObject({
      slug: 'sayyidas-cove',
      name: "Sayyida's Cove",
      isActive: true,
      currentSubjects: 4, // Sayyida + juveniles 187(B)/216(O)/253(R)
      perches: 38,
      diagrams: 2,
    });
    expect(latestVersion.version).toBe(3);
    expect(latestVersion.publishedAt).toBeTruthy();
    // Editing tables match the latest snapshot on a freshly migrated DB
    expect(unpublishedChanges).toBe(false);
  });
});

describe('GET /api/admin/aviaries/:slug', () => {
  it('404s for an unknown slug', async () => {
    const response = await get('/api/admin/aviaries/nowhere');
    expect(response.statusCode).toBe(404);
  });

  it("returns Sayyida's Cove in full", async () => {
    const response = await get('/api/admin/aviaries/sayyidas-cove');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    expect(data.name).toBe("Sayyida's Cove");
    expect(data.diagrams).toHaveLength(2);
    for (const diagram of data.diagrams) {
      expect(diagram.url).toMatch(/^https:\/\/.*\.r2\.dev\/.*\.webp$/);
      expect(diagram.label).toBeTruthy();
    }

    expect(data.perches).toHaveLength(38);
    expect(data.perches.find((p: { value: string }) => p.value === 'Ground')).toBeTruthy();

    expect(data.subjects).toHaveLength(4);
    const sayyida = data.subjects.find((s: { name: string }) => s.name === 'Sayyida');
    expect(sayyida).toMatchObject({ type: 'foster_parent', current: true });
    expect(sayyida.arrivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const juvenile = data.subjects.find((s: { name: string }) => s.name === '187(B)');
    expect(juvenile).toMatchObject({ type: 'juvenile', current: true, arrivedOn: '2026-06-01' });

    // The junctions enable the full catalog (incl. retired entries, kept for history)
    expect(data.enabled.behaviors).toHaveLength(23);
    expect(data.enabled.object).toHaveLength(10);
    expect(data.enabled.object_interaction).toHaveLength(6);
    expect(data.enabled.animal).toHaveLength(9);
    expect(data.enabled.animal_interaction).toHaveLength(11);
  });
});

describe('GET /api/admin/vocabulary', () => {
  it('returns the catalog with groups, flags, and the enablement matrix', async () => {
    const response = await get('/api/admin/vocabulary');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    expect(data.behaviorGroups.map((g: { name: string }) => g.name)).toEqual([
      'Feeding',
      'Locomotion',
      'Resting',
      'Maintenance',
      'Social & Environmental',
      'Other',
    ]);

    expect(data.behaviors).toHaveLength(23);
    expect(data.behaviors.filter((b: { retired: boolean }) => b.retired)).toHaveLength(5);
    const withLocation = data.behaviors.find(
      (b: { requiresLocation: boolean }) => b.requiresLocation
    );
    expect(withLocation).toBeTruthy();
    expect(withLocation.group).toBeTruthy();
    expect(withLocation.excelRowLabel).toBeTruthy();

    expect(data.options.object).toHaveLength(10);
    expect(data.options.object_interaction).toHaveLength(6);
    expect(data.options.animal).toHaveLength(9);
    expect(data.options.animal_interaction).toHaveLength(11);

    expect(data.enablement['sayyidas-cove'].behaviors).toHaveLength(23);
    expect(data.enablement['sayyidas-cove'].animal_interaction).toHaveLength(11);
  });
});

describe('GET /api/admin/config-versions', () => {
  it('lists published versions newest-first', async () => {
    const response = await get('/api/admin/config-versions');
    expect(response.statusCode).toBe(200);
    const { versions } = response.json().data;

    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    for (const version of versions) {
      expect(version.publishedAt).toBeTruthy();
    }
  });
});

describe('GET /api/admin/submissions', () => {
  it('lists submissions newest-first with resolved aviary names', async () => {
    const response = await get('/api/admin/submissions?observer=ReadTest');
    expect(response.statusCode).toBe(200);
    const { items, total } = response.json().data;

    expect(total).toBe(2);
    expect(items.map((i: { observerName: string }) => i.observerName)).toEqual([
      'ReadTest Bob',
      'ReadTest Alice',
    ]);

    const alice = items[1];
    expect(alice).toMatchObject({
      observationDate: '2026-03-01',
      aviarySlug: 'sayyidas-cove',
      aviaryName: "Sayyida's Cove",
      mode: 'live',
      slotCount: 2,
    });
    expect(alice.startTime).toMatch(/^14:00/);

    // Legacy row: no resolved aviary — the free-text label passes through
    const bob = items[0];
    expect(bob).toMatchObject({ aviarySlug: null, aviaryName: 'Legacy Aviary Label' });
  });

  it('filters by date range', async () => {
    const response = await get(
      '/api/admin/submissions?observer=ReadTest&from=2026-03-15&to=2026-05-01'
    );
    const { items, total } = response.json().data;
    expect(total).toBe(1);
    expect(items[0].observerName).toBe('ReadTest Bob');
  });

  it('filters by aviary slug and by legacy label', async () => {
    const bySlug = await get('/api/admin/submissions?observer=ReadTest&aviary=sayyidas-cove');
    expect(bySlug.json().data.items.map((i: { observerName: string }) => i.observerName)).toEqual([
      'ReadTest Alice',
    ]);

    const byLegacy = await get(
      '/api/admin/submissions?observer=ReadTest&aviary=Legacy%20Aviary%20Label'
    );
    expect(byLegacy.json().data.items.map((i: { observerName: string }) => i.observerName)).toEqual(
      ['ReadTest Bob']
    );
  });

  it('paginates with limit/offset and reports the unpaginated total', async () => {
    const response = await get('/api/admin/submissions?observer=ReadTest&limit=1&offset=1');
    const { items, total } = response.json().data;
    expect(total).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].observerName).toBe('ReadTest Alice');
  });

  it('rejects malformed filters', async () => {
    const response = await get('/api/admin/submissions?from=yesterday');
    expect(response.statusCode).toBe(400);
  });
});
