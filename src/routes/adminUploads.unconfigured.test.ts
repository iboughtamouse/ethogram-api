/**
 * The unconfigured-R2 path: uploads must degrade to a clear 503 — never a
 * boot failure (the 3A incident class) and never a confusing 500. This file
 * mocks the config module to blank the R2 group; every other test file gets
 * the fake credentials from vitest.config.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return { config: { ...actual.config, r2: null } };
});

import { buildApp } from "../app.js";
import { query, closePool } from "../db/index.js";
import { generateToken, hashToken } from "../utils/adminTokens.js";
import { SESSION_COOKIE } from "./admin.js";

const TEST_EMAIL = "admin-uploads-unconfigured-test@example.com";
// File-owned aviary so nothing here touches the seed aviary's diagram rows
const AVIARY = "unconf-test-aviary";
const EXISTING_URL =
  "https://pub-legacy.r2.dev/perch-diagram-unconf-test-aviary-a-v1.webp";

let app: FastifyInstance;
let testUserId: string;
let session: string;

async function sweep(): Promise<void> {
  await query(
    `DELETE FROM aviary_perch_diagrams WHERE aviary_id IN (SELECT id FROM aviaries WHERE slug = $1)`,
    [AVIARY],
  );
  await query(`DELETE FROM aviaries WHERE slug = $1`, [AVIARY]);
}

beforeAll(async () => {
  app = await buildApp();
  await sweep();
  const aviary = await query<{ id: string }>(
    `INSERT INTO aviaries (slug, name, is_active) VALUES ($1, 'Unconfigured Test Aviary', false)
     RETURNING id`,
    [AVIARY],
  );
  await query(
    `INSERT INTO aviary_perch_diagrams (aviary_id, url, label, sort_order) VALUES ($1, $2, 'A', 1)`,
    [aviary.rows[0]!.id, EXISTING_URL],
  );

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Unconfigured Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true RETURNING id`,
    [TEST_EMAIL],
  );
  testUserId = user.rows[0]!.id;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [
    testUserId,
  ]);
  session = generateToken();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '1 day')`,
    [testUserId, hashToken(session)],
  );
});

afterAll(async () => {
  await sweep();
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [
    testUserId,
  ]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe("uploads with R2 unconfigured", () => {
  it("answers 503 with a plain explanation, not a 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/uploads/perch-diagram",
      headers: { "x-ethogram-admin": "1" },
      cookies: { [SESSION_COOKIE]: session },
      payload: {
        aviary: "sayyidas-cove",
        label: "X View",
        contentType: "image/webp",
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatch(/not configured/);
  });
});

describe("diagram replace-set with R2 unconfigured", () => {
  const CSRF = { "x-ethogram-admin": "1" };
  function putDiagrams(payload: unknown) {
    return app.inject({
      method: "PUT",
      url: `/api/admin/aviaries/${AVIARY}/diagrams`,
      headers: CSRF,
      cookies: { [SESSION_COOKIE]: session },
      payload: payload as Record<string, unknown>,
    });
  }

  it("rejects a new URL with a clear message (no base to validate against)", async () => {
    const response = await putDiagrams({
      diagrams: [{ url: "https://anywhere.example/x.webp", label: "New" }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not configured/i);
  });

  it("still lets an already-current diagram be relabeled and kept", async () => {
    // An existing row (not under any active R2 base) must stay editable even
    // with uploads disabled — relabel/reorder/remove all use current URLs
    const response = await putDiagrams({
      diagrams: [{ url: EXISTING_URL, label: "A (renamed)" }],
    });
    expect(response.statusCode).toBe(200);
    const row = await query<{ label: string }>(
      `SELECT label FROM aviary_perch_diagrams WHERE url = $1`,
      [EXISTING_URL],
    );
    expect(row.rows[0]!.label).toBe("A (renamed)");
  });
});
