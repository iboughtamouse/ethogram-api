/**
 * The unconfigured-R2 path: uploads must degrade to a clear 503 — never a
 * boot failure (the 3A incident class) and never a confusing 500. This file
 * mocks the config module to blank the R2 group; every other test file gets
 * the fake credentials from vitest.config.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { config: { ...actual.config, r2: null } };
});

import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-uploads-unconfigured-test@example.com';

let app: FastifyInstance;
let testUserId: string;
let session: string;

beforeAll(async () => {
  app = await buildApp();
  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Unconfigured Test Admin')
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
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe('uploads with R2 unconfigured', () => {
  it('answers 503 with a plain explanation, not a 500', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/uploads/perch-diagram',
      headers: { 'x-ethogram-admin': '1' },
      cookies: { [SESSION_COOKIE]: session },
      payload: { aviary: 'sayyidas-cove', label: 'X View', contentType: 'image/webp' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatch(/not configured/);
  });
});
