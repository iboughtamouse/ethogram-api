import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { query, closePool } from "../db/index.js";
import { generateToken, hashToken } from "../utils/adminTokens.js";
import { SESSION_COOKIE } from "./admin.js";

// This suite manages the shared admin_users table. To stay safe under vitest's
// parallel file workers (other suites' session users must keep is_active), it
// only ever touches rows it owns: the acting admin plus emails under this
// prefix. It never deactivates admins it did not create.
const ACTOR_EMAIL = "admin-users-test-actor@example.com";
const PREFIX = "admin-users-test-";
const CSRF = { "x-ethogram-admin": "1" };

let app: FastifyInstance;
let actorId: string;
let session: string;

function authed(
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
  cookie: string = session,
) {
  return app.inject({
    method,
    url,
    headers: CSRF,
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload !== undefined && {
      payload: payload as Record<string, unknown>,
    }),
  });
}

async function sweep(): Promise<void> {
  const owned = `(SELECT id FROM admin_users WHERE email LIKE '${PREFIX}%')`;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id IN ${owned}`);
  await query(`DELETE FROM admin_login_tokens WHERE admin_user_id IN ${owned}`);
  await query(`DELETE FROM audit_log WHERE admin_user_id IN ${owned}`);
  await query(`DELETE FROM admin_users WHERE email LIKE '${PREFIX}%'`);
}

beforeAll(async () => {
  app = await buildApp();
  await sweep();

  const actor = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Users Test Actor')
     RETURNING id`,
    [ACTOR_EMAIL],
  );
  actorId = actor.rows[0]!.id;
  session = generateToken();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '1 day')`,
    [actorId, hashToken(session)],
  );
});

afterAll(async () => {
  await sweep();
  await app.close();
  await closePool();
});

// Remove every invited row between tests so each starts from a known slate
// (the actor and its session persist for the whole file).
beforeEach(async () => {
  await query(
    `DELETE FROM admin_sessions WHERE admin_user_id IN
       (SELECT id FROM admin_users WHERE email LIKE '${PREFIX}invitee%')`,
  );
  await query(
    `DELETE FROM audit_log WHERE admin_user_id IN
       (SELECT id FROM admin_users WHERE email LIKE '${PREFIX}invitee%')`,
  );
  await query(`DELETE FROM admin_users WHERE email LIKE '${PREFIX}invitee%'`);
});

async function addInvitee(email: string, displayName = "Invitee") {
  const response = await authed("POST", "/api/admin/admin-users", {
    email,
    displayName,
  });
  expect(response.statusCode).toBe(201);
  return response.json().data.id as string;
}

describe("admin allowlist — guard", () => {
  it("rejects listing without a session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/admin-users",
      headers: CSRF,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("admin allowlist — list", () => {
  it("returns the acting admin among the allowlist with camelCase fields", async () => {
    const response = await authed("GET", "/api/admin/admin-users");
    expect(response.statusCode).toBe(200);
    const { admins } = response.json().data;
    const me = admins.find((a: { email: string }) => a.email === ACTOR_EMAIL);
    expect(me).toMatchObject({
      displayName: "Users Test Actor",
      isActive: true,
    });
    expect(me.createdAt).toBeTruthy();
  });
});

describe("admin allowlist — add", () => {
  it("adds a new admin, lowercasing the email, and writes an audit row", async () => {
    const response = await authed("POST", "/api/admin/admin-users", {
      email: `${PREFIX}Invitee-A@Example.com`,
      displayName: "  Invitee A  ",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      email: `${PREFIX}invitee-a@example.com`,
      displayName: "Invitee A",
      isActive: true,
    });

    // Scope to THIS invitee's id, not the actor's whole add history — the
    // actor authors an add row per test and beforeEach only sweeps invitee-
    // authored rows, so an actor-wide count would grow with test order.
    const newId = response.json().data.id;
    const audit = await query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'add:admin_user'`,
      [newId],
    );
    expect(audit.rows.length).toBe(1);
  });

  it("rejects a malformed email before inserting", async () => {
    const response = await authed("POST", "/api/admin/admin-users", {
      email: "not-an-email",
      displayName: "Nope",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/email address/);
  });

  it("rejects a blank display name", async () => {
    const response = await authed("POST", "/api/admin/admin-users", {
      email: `${PREFIX}invitee-blank@example.com`,
      displayName: "   ",
    });
    expect(response.statusCode).toBe(400);
  });

  it("409s when the email is already an active admin", async () => {
    const email = `${PREFIX}invitee-dup@example.com`;
    await addInvitee(email);
    const again = await authed("POST", "/api/admin/admin-users", {
      email,
      displayName: "Dup",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/already an admin/);
  });

  it("409s with a reactivate hint when the email was previously removed", async () => {
    const email = `${PREFIX}invitee-removed@example.com`;
    const id = await addInvitee(email);
    await authed("PATCH", `/api/admin/admin-users/${id}`, { isActive: false });

    const readd = await authed("POST", "/api/admin/admin-users", {
      email,
      displayName: "Back",
    });
    expect(readd.statusCode).toBe(409);
    expect(readd.json().error).toMatch(/Reactivate/i);
  });
});

describe("admin allowlist — deactivate / reactivate", () => {
  it("deactivates a colleague, revokes their sessions, and blocks their next request", async () => {
    const email = `${PREFIX}invitee-deact@example.com`;
    const id = await addInvitee(email);
    // Give the invitee a live session, then deactivate them
    const inviteeSession = generateToken();
    await query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + interval '1 day')`,
      [id, hashToken(inviteeSession)],
    );

    const response = await authed("PATCH", `/api/admin/admin-users/${id}`, {
      isActive: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.isActive).toBe(false);

    const sessions = await query(
      `SELECT 1 FROM admin_sessions WHERE admin_user_id = $1`,
      [id],
    );
    expect(sessions.rows.length).toBe(0);

    // End-to-end: the revoked session no longer authenticates
    const asInvitee = await authed(
      "GET",
      "/api/admin/admin-users",
      undefined,
      inviteeSession,
    );
    expect(asInvitee.statusCode).toBe(401);
  });

  it("reactivates a removed admin", async () => {
    const id = await addInvitee(`${PREFIX}invitee-react@example.com`);
    await authed("PATCH", `/api/admin/admin-users/${id}`, { isActive: false });
    const response = await authed("PATCH", `/api/admin/admin-users/${id}`, {
      isActive: true,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.isActive).toBe(true);
  });

  it("is a no-op (200, no audit) when already in the requested state", async () => {
    const id = await addInvitee(`${PREFIX}invitee-noop@example.com`);
    const before = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE entity_id = $1`,
      [id],
    );
    const response = await authed("PATCH", `/api/admin/admin-users/${id}`, {
      isActive: true, // already active
    });
    expect(response.statusCode).toBe(200);
    const after = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE entity_id = $1`,
      [id],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("refuses to let an admin remove their own access", async () => {
    const response = await authed(
      "PATCH",
      `/api/admin/admin-users/${actorId}`,
      {
        isActive: false,
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/your own access/);
    // Still active
    const still = await query<{ is_active: boolean }>(
      `SELECT is_active FROM admin_users WHERE id = $1`,
      [actorId],
    );
    expect(still.rows[0]!.is_active).toBe(true);
  });

  it("still refuses self-removal when the id is uppercased (uuid is case-insensitive in pg)", async () => {
    const response = await authed(
      "PATCH",
      `/api/admin/admin-users/${actorId.toUpperCase()}`,
      { isActive: false },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/your own access/);
    const still = await query<{ is_active: boolean }>(
      `SELECT is_active FROM admin_users WHERE id = $1`,
      [actorId],
    );
    expect(still.rows[0]!.is_active).toBe(true);
  });

  it("404s for an unknown or malformed id", async () => {
    const unknown = await authed(
      "PATCH",
      "/api/admin/admin-users/00000000-0000-0000-0000-000000000000",
      { isActive: false },
    );
    expect(unknown.statusCode).toBe(404);
    const malformed = await authed(
      "PATCH",
      "/api/admin/admin-users/not-a-uuid",
      { isActive: false },
    );
    expect(malformed.statusCode).toBe(404);
  });
});
