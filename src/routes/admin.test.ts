import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock the email service so no real Resend call happens and so tests can
// recover the raw magic-link token (only its hash reaches the database).
vi.mock('../services/email.js', () => ({
  sendAdminLoginEmail: vi.fn(async () => ({ success: true })),
  sendObservationEmail: vi.fn(async () => ({ success: true })),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { sendAdminLoginEmail } from '../services/email.js';
import { SESSION_COOKIE } from './admin.js';

const TEST_EMAIL = 'admin-test@example.com';
const CSRF_HEADER = { 'x-ethogram-admin': '1' };

let app: FastifyInstance;
let testUserId: string;

/** The raw token from the most recent mocked sign-in email. */
function lastEmailedToken(): string {
  const calls = vi.mocked(sendAdminLoginEmail).mock.calls;
  const link = calls[calls.length - 1]![0].link;
  return link.split('#token=')[1]!;
}

async function requestLink(email: string, ip = '10.0.0.1', origin?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/admin/auth/request-link',
    headers: origin ? { ...CSRF_HEADER, origin } : CSRF_HEADER,
    payload: { email },
    remoteAddress: ip,
  });
}

async function verify(token: string, ip = '10.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/admin/auth/verify',
    headers: CSRF_HEADER,
    payload: { token },
    remoteAddress: ip,
  });
}

/** Full happy path: request a link, redeem it, return the session cookie value. */
async function signIn(): Promise<string> {
  await requestLink(TEST_EMAIL);
  const response = await verify(lastEmailedToken());
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  return cookie!.value;
}

beforeAll(async () => {
  app = await buildApp();
  const inserted = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true
     RETURNING id`,
    [TEST_EMAIL]
  );
  testUserId = inserted.rows[0]!.id;
});

afterAll(async () => {
  await query('DELETE FROM admin_auth_events');
  await query('DELETE FROM admin_sessions');
  await query('DELETE FROM admin_login_tokens');
  await query('DELETE FROM admin_users WHERE email = $1', [TEST_EMAIL]);
  await app.close();
  await closePool();
});

beforeEach(async () => {
  await query('DELETE FROM admin_auth_events');
  await query('DELETE FROM admin_sessions');
  await query('DELETE FROM admin_login_tokens');
  await query('UPDATE admin_users SET is_active = true WHERE email = $1', [TEST_EMAIL]);
  vi.clearAllMocks();
});

describe('migration 007 seed', () => {
  it('seeds the owner as the initial allowlist', async () => {
    const result = await query(
      `SELECT display_name FROM admin_users WHERE email = 'iboughtamouse@gmail.com' AND is_active`
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe('CSRF header guard', () => {
  it('rejects admin POSTs without x-ethogram-admin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/request-link',
      payload: { email: TEST_EMAIL },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not apply to GETs (session guard still does)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/me' });
    expect(response.statusCode).toBe(401);
  });
});

describe('Origin allowlist', () => {
  it('rejects any admin request whose Origin is not the admin app', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/request-link',
      headers: { ...CSRF_HEADER, origin: 'https://evil.example.com' },
      payload: { email: TEST_EMAIL },
    });
    expect(response.statusCode).toBe(403);
    expect(sendAdminLoginEmail).not.toHaveBeenCalled();
  });

  it('also rejects a mismatched Origin on GETs (before the session guard)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows the configured admin origin', async () => {
    // config.adminAppUrl defaults to http://localhost:5174 under test env
    const response = await requestLink(TEST_EMAIL, '10.0.0.1', 'http://localhost:5174');
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/admin/auth/request-link', () => {
  it('returns the same 200 message for unknown emails and sends nothing', async () => {
    const response = await requestLink('nobody@example.com');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.message).toMatch(/on its way/);
    expect(sendAdminLoginEmail).not.toHaveBeenCalled();
    const tokens = await query('SELECT id FROM admin_login_tokens');
    expect(tokens.rows).toHaveLength(0);
  });

  it('creates a hashed single-use token and emails a fragment link for allowlisted emails', async () => {
    const response = await requestLink(TEST_EMAIL);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.message).toMatch(/on its way/);

    expect(sendAdminLoginEmail).toHaveBeenCalledTimes(1);
    const { to, link } = vi.mocked(sendAdminLoginEmail).mock.calls[0]![0];
    expect(to).toBe(TEST_EMAIL);
    expect(link).toContain('/auth/callback#token=');

    const raw = lastEmailedToken();
    const tokens = await query<{ token_hash: string; consumed_at: string | null }>(
      'SELECT token_hash, consumed_at FROM admin_login_tokens WHERE admin_user_id = $1',
      [testUserId]
    );
    expect(tokens.rows).toHaveLength(1);
    expect(tokens.rows[0]!.token_hash).toBe(hashToken(raw));
    expect(tokens.rows[0]!.token_hash).not.toBe(raw);
    expect(tokens.rows[0]!.consumed_at).toBeNull();
  });

  it('normalizes email case and whitespace', async () => {
    await requestLink(`  ${TEST_EMAIL.toUpperCase()}  `);
    const tokens = await query('SELECT id FROM admin_login_tokens WHERE admin_user_id = $1', [
      testUserId,
    ]);
    expect(tokens.rows).toHaveLength(1);
  });

  it('sends nothing for deactivated admins (still 200)', async () => {
    await query('UPDATE admin_users SET is_active = false WHERE email = $1', [TEST_EMAIL]);
    const response = await requestLink(TEST_EMAIL);
    expect(response.statusCode).toBe(200);
    expect(sendAdminLoginEmail).not.toHaveBeenCalled();
  });

  it('rate-limits per email (3 per window)', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestLink('nobody@example.com')).statusCode).toBe(200);
    }
    expect((await requestLink('nobody@example.com')).statusCode).toBe(429);
  });

  it('rate-limits per IP (10 per window) across emails', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await requestLink(`n${i}@example.com`, '10.9.9.9')).statusCode).toBe(200);
    }
    expect((await requestLink('n10@example.com', '10.9.9.9')).statusCode).toBe(429);
  });

  it('rejects malformed bodies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/request-link',
      headers: CSRF_HEADER,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('opportunistically sweeps long-expired login tokens', async () => {
    await query(
      `INSERT INTO admin_login_tokens (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - interval '2 hours')`,
      [testUserId, hashToken(generateToken())]
    );
    await requestLink('nobody@example.com');
    const stale = await query(
      `SELECT id FROM admin_login_tokens WHERE expires_at < NOW() - interval '1 hour'`
    );
    expect(stale.rows).toHaveLength(0);
  });
});

describe('POST /api/admin/auth/verify', () => {
  it('redeems a fresh token: session cookie set, token consumed', async () => {
    await requestLink(TEST_EMAIL);
    const raw = lastEmailedToken();

    const response = await verify(raw);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ email: TEST_EMAIL, displayName: 'Test Admin' });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.path).toBe('/');

    const token = await query<{ consumed_at: string | null }>(
      'SELECT consumed_at FROM admin_login_tokens WHERE token_hash = $1',
      [hashToken(raw)]
    );
    expect(token.rows[0]!.consumed_at).not.toBeNull();

    const sessions = await query('SELECT id FROM admin_sessions WHERE admin_user_id = $1', [
      testUserId,
    ]);
    expect(sessions.rows).toHaveLength(1);
  });

  it('is single-use: a second redeem fails', async () => {
    await requestLink(TEST_EMAIL);
    const raw = lastEmailedToken();
    expect((await verify(raw)).statusCode).toBe(200);
    expect((await verify(raw)).statusCode).toBe(401);
  });

  it('rejects unknown tokens and records a failure event', async () => {
    const response = await verify(generateToken());
    expect(response.statusCode).toBe(401);
    const events = await query(
      `SELECT id FROM admin_auth_events WHERE kind = 'verify_failed'`
    );
    expect(events.rows).toHaveLength(1);
  });

  it('rejects expired tokens', async () => {
    const raw = generateToken();
    await query(
      `INSERT INTO admin_login_tokens (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - interval '1 minute')`,
      [testUserId, hashToken(raw)]
    );
    expect((await verify(raw)).statusCode).toBe(401);
  });

  it('rejects tokens for deactivated admins without creating a session', async () => {
    await requestLink(TEST_EMAIL);
    const raw = lastEmailedToken();
    await query('UPDATE admin_users SET is_active = false WHERE email = $1', [TEST_EMAIL]);

    expect((await verify(raw)).statusCode).toBe(401);
    const sessions = await query('SELECT id FROM admin_sessions');
    expect(sessions.rows).toHaveLength(0);
  });

  it('locks out an IP after repeated failures', async () => {
    for (let i = 0; i < 10; i++) {
      await query(`INSERT INTO admin_auth_events (kind, ip) VALUES ('verify_failed', $1)`, [
        '10.6.6.6',
      ]);
    }
    expect((await verify(generateToken(), '10.6.6.6')).statusCode).toBe(429);
  });

  it('has no GET route (scanner prefetch cannot redeem)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/auth/verify' });
    expect(response.statusCode).toBe(404);
  });

  it('sweeps expired sessions on successful sign-in', async () => {
    await query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - interval '1 day')`,
      [testUserId, hashToken(generateToken())]
    );
    await signIn();
    const expired = await query(`SELECT id FROM admin_sessions WHERE expires_at < NOW()`);
    expect(expired.rows).toHaveLength(0);
  });
});

describe('GET /api/admin/me', () => {
  it('401s without a cookie', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/me' })).statusCode).toBe(401);
  });

  it('401s with a garbage cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: generateToken() },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns the signed-in admin with a valid session', async () => {
    const session = await signIn();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ email: TEST_EMAIL, displayName: 'Test Admin' });
  });

  it('401s once the session row has expired', async () => {
    const raw = generateToken();
    await query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - interval '1 minute')`,
      [testUserId, hashToken(raw)]
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(response.statusCode).toBe(401);
  });

  it('slides expiry forward for sessions not touched within the hour', async () => {
    const raw = generateToken();
    await query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, last_seen_at, expires_at)
       VALUES ($1, $2, NOW() - interval '2 hours', NOW() + interval '1 day')`,
      [testUserId, hashToken(raw)]
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(response.statusCode).toBe(200);

    const bumped = await query<{ slid: boolean }>(
      `SELECT expires_at > NOW() + interval '29 days' AS slid
       FROM admin_sessions WHERE token_hash = $1`,
      [hashToken(raw)]
    );
    expect(bumped.rows[0]!.slid).toBe(true);

    // The browser's cookie must be re-issued too, or it would still expire
    // 30 days after the original sign-in
    const reissued = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(reissued).toBeDefined();
    expect(reissued!.value).toBe(raw);
  });

  it('does not re-issue the cookie for a session touched within the hour', async () => {
    const session = await signIn(); // last_seen_at = NOW()
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(200);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });
});

describe('POST /api/admin/auth/logout', () => {
  it('deletes the session and the cookie stops working', async () => {
    const session = await signIn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: CSRF_HEADER,
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(response.statusCode).toBe(200);

    const sessions = await query('SELECT id FROM admin_sessions');
    expect(sessions.rows).toHaveLength(0);

    // The clearing cookie must repeat secure/sameSite or browsers won't delete it
    const cleared = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared).toBeDefined();
    expect(cleared!.sameSite?.toLowerCase()).toBe('lax');

    const me = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.statusCode).toBe(401);
  });

  it('requires a session (401 when anonymous)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: CSRF_HEADER,
    });
    expect(response.statusCode).toBe(401);
  });
});
