import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-uploads-test@example.com';
const CSRF = { 'x-ethogram-admin': '1' };
// vitest.config.ts injects the fake R2 env these URLs derive from
const FAKE_BASE = 'https://pub-test.r2.dev';

let app: FastifyInstance;
let testUserId: string;
let session: string;

function mint(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/admin/uploads/perch-diagram',
    headers: CSRF,
    cookies: { [SESSION_COOKIE]: session },
    payload: payload as Record<string, unknown>,
  });
}

async function sweep(): Promise<void> {
  await query(`DELETE FROM aviary_perch_diagrams WHERE url LIKE $1`, [`${FAKE_BASE}/%`]);
}

beforeAll(async () => {
  app = await buildApp();
  await sweep();

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Uploads Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true RETURNING id`,
    [TEST_EMAIL]
  );
  testUserId = user.rows[0]!.id;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);

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

describe('POST /api/admin/uploads/perch-diagram', () => {
  it('rejects requests without a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/uploads/perch-diagram',
      headers: CSRF,
      payload: { aviary: 'sayyidas-cove', label: 'X', contentType: 'image/webp' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects non-image content types', async () => {
    const response = await mint({
      aviary: 'sayyidas-cove',
      label: 'Utest View',
      contentType: 'application/pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/WebP, PNG, or JPEG/);
  });

  it('404s unknown aviaries', async () => {
    const response = await mint({
      aviary: 'nowhere',
      label: 'Utest View',
      contentType: 'image/webp',
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects labels that slug to nothing', async () => {
    const response = await mint({
      aviary: 'sayyidas-cove',
      label: '★☆',
      contentType: 'image/webp',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/letter or digit/);
  });

  it('mints a presigned PUT with a v1 key and audits it', async () => {
    const response = await mint({
      aviary: 'sayyidas-cove',
      label: 'Utest View',
      contentType: 'image/webp',
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data;

    expect(data.key).toBe('perch-diagram-sayyidas-cove-utest-view-v1.webp');
    expect(data.publicUrl).toBe(`${FAKE_BASE}/${data.key}`);
    const upload = new URL(data.uploadUrl);
    expect(upload.host).toBe('test-bucket.testaccount.r2.cloudflarestorage.com');
    expect(upload.pathname).toBe(`/${data.key}`);
    expect(upload.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(data.expiresInSeconds).toBeGreaterThan(0);
    expect(data.maxBytes).toBeGreaterThan(0);

    const audit = await query(
      `SELECT 1 FROM audit_log
       WHERE admin_user_id = $1 AND action = 'mint_upload_url' AND entity = 'perch_diagram'`,
      [testUserId]
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('bumps the version when the URL is already used by a draft diagram', async () => {
    const aviaryId = (
      await query<{ id: string }>(`SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'`)
    ).rows[0]!.id;
    await query(
      `INSERT INTO aviary_perch_diagrams (aviary_id, url, label, sort_order)
       VALUES ($1, $2, 'Utest Taken', 99)`,
      [aviaryId, `${FAKE_BASE}/perch-diagram-sayyidas-cove-utest-taken-v1.webp`]
    );
    try {
      const response = await mint({
        aviary: 'sayyidas-cove',
        label: 'Utest Taken',
        contentType: 'image/webp',
      });
      expect(response.statusCode).toBe(201);
      // Same label + type → the next version; the frozen v1 URL is never reused
      expect(response.json().data.key).toBe(
        'perch-diagram-sayyidas-cove-utest-taken-v2.webp'
      );
    } finally {
      await query(`DELETE FROM aviary_perch_diagrams WHERE label = 'Utest Taken'`);
    }
  });
});
