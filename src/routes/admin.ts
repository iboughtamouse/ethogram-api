/**
 * Admin routes (Phase 3 stage 3A): magic-link auth + session-guarded scope.
 *
 * Design: ethogram-notes/01-ACTIVE/config-as-data-phase3-design.md §2.
 * CSRF defense on this scope is two layers, both enforced in the onRequest
 * hook below: (1) a browser Origin allowlist — a credentialed cross-origin
 * request always carries an Origin header, so any request whose Origin isn't
 * the admin app is rejected; this locks the scope to the admin origin even
 * though the shared CORS registration allows the public form origin too;
 * (2) a required x-ethogram-admin header on mutations.
 */

import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { generateToken, hashToken } from '../utils/adminTokens.js';
import { sendAdminLoginEmail } from '../services/email.js';
import { adminReadRoutes } from './adminRead.js';
import { adminWriteRoutes } from './adminWrite.js';
import { adminConfigRoutes } from './adminConfig.js';

export const SESSION_COOKIE = 'ethogram_admin_session';

const TOKEN_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;
// Sliding expiry: bump at most once an hour so /me polling doesn't write-storm
const SESSION_TOUCH_MINUTES = 60;

// Durable rate limits (counted from admin_auth_events, so they survive redeploys)
const RATE_WINDOW_MINUTES = 15;
const REQUEST_LINK_MAX_PER_EMAIL = 3;
const REQUEST_LINK_MAX_PER_IP = 10;
const VERIFY_FAILURES_MAX_PER_IP = 10;

// Identical response for allowlisted and unknown emails (no enumeration)
const REQUEST_LINK_MESSAGE =
  'If that address is on the admin list, a sign-in link is on its way.';

const requestLinkSchema = z.object({
  email: z.string().min(3).max(255),
});

const verifySchema = z.object({
  token: z.string().min(20).max(200),
});

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

async function countEvents(
  kind: string,
  column: 'email' | 'ip',
  value: string
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM admin_auth_events
     WHERE kind = $1 AND ${column} = $2
       AND created_at > NOW() - make_interval(mins => $3)`,
    [kind, value, RATE_WINDOW_MINUTES]
  );
  return parseInt(result.rows[0]!.count, 10);
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.adminCookieSecure,
    sameSite: config.adminCookieSameSite,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  // Clearing must repeat the secure/sameSite attributes used when setting the
  // cookie, or browsers refuse to match and delete it (notably SameSite=None).
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    secure: config.adminCookieSecure,
    sameSite: config.adminCookieSameSite,
  });
}

/**
 * preHandler for the session-guarded scope: resolves the cookie to an active
 * session + active admin user, attaches request.adminUser, and slides the
 * session expiry forward (at most once per SESSION_TOUCH_MINUTES).
 */
async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    return reply.status(401).send({ success: false, error: 'Not signed in' });
  }

  const result = await query<{
    session_id: string;
    stale: boolean;
    user_id: string;
    email: string;
    display_name: string;
  }>(
    `SELECT s.id AS session_id,
            s.last_seen_at < NOW() - make_interval(mins => $2) AS stale,
            u.id AS user_id, u.email, u.display_name
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active`,
    [hashToken(raw), SESSION_TOUCH_MINUTES]
  );

  const row = result.rows[0];
  if (!row) {
    clearSessionCookie(reply);
    return reply.status(401).send({ success: false, error: 'Not signed in' });
  }

  if (row.stale) {
    await query(
      `UPDATE admin_sessions
       SET last_seen_at = NOW(), expires_at = NOW() + make_interval(days => $2)
       WHERE id = $1`,
      [row.session_id, SESSION_TTL_DAYS]
    );
    // Slide the browser's copy too — the cookie's maxAge is fixed at issue, so
    // without re-setting it the session would be evicted client-side 30 days
    // after sign-in no matter how recently it was used.
    setSessionCookie(reply, raw);
  }

  request.adminUser = {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
  };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Scoped error handler: admin handlers run raw SQL without per-handler
  // try/catch, and Fastify's default handler would leak the Postgres error
  // message and SQLSTATE to the client. 4xx framework errors (malformed JSON
  // bodies etc.) keep their message inside the {success, error} envelope;
  // anything 5xx is logged and sanitized.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.status(status).send({
      success: false,
      error: status >= 500 ? 'Internal server error' : error.message,
    });
  });

  // CSRF guard for the whole /api/admin scope (CORS preflight OPTIONS is
  // answered by @fastify/cors before routing, so it never reaches this hook).
  app.addHook('onRequest', async (request, reply) => {
    // Origin allowlist: a browser attaches Origin to every credentialed
    // cross-origin request, so rejecting a mismatched Origin locks this scope
    // to the admin app even though the shared CORS list also admits the public
    // form origin. A missing Origin (server-to-server, curl, tests) carries no
    // ambient cookie, so it's allowed through.
    const origin = request.headers.origin;
    if (origin && origin !== config.adminAppUrl) {
      return reply.status(403).send({ success: false, error: 'Origin not allowed' });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers['x-ethogram-admin'] !== '1') {
        return reply
          .status(403)
          .send({ success: false, error: 'Missing x-ethogram-admin header' });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/request-link — always 200 with the same message (no enumeration).
  // The Resend send is fire-and-forget so an allowlisted address can't be
  // distinguished by response latency (design §2; the remaining delta is one
  // token INSERT, accepted residual risk).
  // ---------------------------------------------------------------------------
  app.post('/auth/request-link', async (request, reply) => {
    const parsed = requestLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'A valid email is required' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const ip = request.ip;

    // Opportunistic cleanup keeps these tables tiny (no cron needed): expired
    // login tokens and long-past auth events. Sessions are swept at verify.
    await query(`DELETE FROM admin_auth_events WHERE created_at < NOW() - interval '24 hours'`);
    await query(`DELETE FROM admin_login_tokens WHERE expires_at < NOW() - interval '1 hour'`);

    // Insert this attempt BEFORE counting, then gate on the count including our
    // own row. This closes the check-then-insert race: a concurrent burst all
    // sees an at-or-over-cap count and fails closed, instead of every request
    // reading the pre-burst count and sending a flood of emails.
    await query(`INSERT INTO admin_auth_events (kind, email, ip) VALUES ('request_link', $1, $2)`, [
      email,
      ip,
    ]);

    const [byEmail, byIp] = await Promise.all([
      countEvents('request_link', 'email', email),
      countEvents('request_link', 'ip', ip),
    ]);
    if (byEmail > REQUEST_LINK_MAX_PER_EMAIL || byIp > REQUEST_LINK_MAX_PER_IP) {
      return reply.status(429).send({
        success: false,
        error: 'Too many sign-in requests. Please try again later.',
      });
    }

    const user = await query<{ id: string }>(
      `SELECT id FROM admin_users WHERE email = $1 AND is_active`,
      [email]
    );

    if (user.rows[0]) {
      const token = generateToken();
      await query(
        `INSERT INTO admin_login_tokens (admin_user_id, token_hash, request_ip, expires_at)
         VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
        [user.rows[0].id, hashToken(token), ip, TOKEN_TTL_MINUTES]
      );

      // Token travels in the URL fragment: never sent to any server, never logged
      const link = `${config.adminAppUrl}/auth/callback#token=${token}`;
      void sendAdminLoginEmail({ to: email, link }).then((result) => {
        if (!result.success) {
          app.log.error({ err: result.error }, 'admin login email failed to send');
        }
      });
    }

    return reply.status(200).send({ success: true, data: { message: REQUEST_LINK_MESSAGE } });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/verify — redeem a magic-link token for a session cookie.
  // POST-only by design: email security scanners prefetch GETs (§2).
  // ---------------------------------------------------------------------------
  app.post('/auth/verify', async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'A token is required' });
    }
    const ip = request.ip;

    // Lockout: defense-in-depth behind the token's 256-bit entropy
    const failures = await countEvents('verify_failed', 'ip', ip);
    if (failures >= VERIFY_FAILURES_MAX_PER_IP) {
      return reply.status(429).send({
        success: false,
        error: 'Too many failed attempts. Please try again later.',
      });
    }

    // Single-use redeem: the UPDATE only matches an unconsumed, unexpired token
    const consumed = await query<{ admin_user_id: string }>(
      `UPDATE admin_login_tokens SET consumed_at = NOW()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING admin_user_id`,
      [hashToken(parsed.data.token)]
    );

    const redeemed = consumed.rows[0];
    if (!redeemed) {
      await query(`INSERT INTO admin_auth_events (kind, ip) VALUES ('verify_failed', $1)`, [ip]);
      return reply.status(401).send({
        success: false,
        error: 'This sign-in link is invalid or has expired. Request a new one.',
      });
    }

    const user = await query<{ email: string; display_name: string }>(
      `SELECT email, display_name FROM admin_users WHERE id = $1 AND is_active`,
      [redeemed.admin_user_id]
    );
    if (!user.rows[0]) {
      return reply.status(401).send({
        success: false,
        error: 'This account is no longer active.',
      });
    }

    // Opportunistic sweep of expired sessions (login is low-frequency)
    await query(`DELETE FROM admin_sessions WHERE expires_at < NOW()`);

    const sessionToken = generateToken();
    await query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + make_interval(days => $3))`,
      [redeemed.admin_user_id, hashToken(sessionToken), SESSION_TTL_DAYS]
    );

    setSessionCookie(reply, sessionToken);
    return reply.status(200).send({
      success: true,
      data: { email: user.rows[0].email, displayName: user.rows[0].display_name },
    });
  });

  // ---------------------------------------------------------------------------
  // Session-guarded scope
  // ---------------------------------------------------------------------------
  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireAdminSession);

    // Stage 3B: read-only dashboard endpoints
    await guarded.register(adminReadRoutes);

    // Stage 3C: editing (CRUD over the draft tables) + the publish gate
    await guarded.register(adminWriteRoutes);
    await guarded.register(adminConfigRoutes);

    guarded.get('/me', async (request, reply) => {
      const { email, displayName } = request.adminUser!;
      return reply.status(200).send({ success: true, data: { email, displayName } });
    });

    guarded.post('/auth/logout', async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE]!;
      await query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(raw)]);
      clearSessionCookie(reply);
      return reply.status(200).send({ success: true, data: { message: 'Signed out' } });
    });
  });
};
