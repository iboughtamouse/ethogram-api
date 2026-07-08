import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { query, closePool } from "../db/index.js";
import { generateToken, hashToken } from "../utils/adminTokens.js";
import { SESSION_COOKIE } from "./admin.js";

const TEST_EMAIL = "admin-uploads-test@example.com";
const CSRF = { "x-ethogram-admin": "1" };
// vitest.config.ts injects the fake R2 env these URLs derive from
const FAKE_BASE = "https://pub-test.r2.dev";
// This file owns its own aviary and never inserts diagram/version rows onto
// the seed aviary — a killed run must not leave state that poisons another
// file's clean-state assertions (adminConfig.test.ts).
const AVIARY = "uptest-aviary";
const VERSION_NOTE = "uptest history fixture";

let app: FastifyInstance;
let testUserId: string;
let session: string;

function mint(payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/admin/uploads/perch-diagram",
    headers: CSRF,
    cookies: { [SESSION_COOKIE]: session },
    payload: payload as Record<string, unknown>,
  });
}

async function sweep(): Promise<void> {
  await query(`DELETE FROM config_versions WHERE notes = $1`, [VERSION_NOTE]);
  await query(`DELETE FROM aviary_perch_diagrams WHERE url LIKE $1`, [
    `${FAKE_BASE}/%`,
  ]);
  await query(`DELETE FROM aviaries WHERE slug = $1`, [AVIARY]);
}

beforeAll(async () => {
  app = await buildApp();
  await sweep();
  await query(
    `INSERT INTO aviaries (slug, name, is_active) VALUES ($1, 'Uploads Test Aviary', false)`,
    [AVIARY],
  );

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Uploads Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true RETURNING id`,
    [TEST_EMAIL],
  );
  testUserId = user.rows[0]!.id;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [
    testUserId,
  ]);
  // A killed prior run leaves mint reservations (audit rows) that would push
  // this run's version numbers forward — clear them so keys start at v1
  await query(`DELETE FROM audit_log WHERE admin_user_id = $1`, [testUserId]);

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

describe("POST /api/admin/uploads/perch-diagram", () => {
  it("rejects requests without a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/uploads/perch-diagram",
      headers: CSRF,
      payload: { aviary: AVIARY, label: "X", contentType: "image/webp" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects non-image content types", async () => {
    const response = await mint({
      aviary: AVIARY,
      label: "Utest View",
      contentType: "application/pdf",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/WebP, PNG, or JPEG/);
  });

  it("rejects a contentType that names an Object.prototype key", async () => {
    // 'constructor' is truthy on a plain object; the z.enum + null-proto map
    // must reject it rather than mint a garbage key
    const response = await mint({
      aviary: AVIARY,
      label: "Utest View",
      contentType: "constructor",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects labels longer than 255 characters with a clear message", async () => {
    const response = await mint({
      aviary: AVIARY,
      label: "X".repeat(256),
      contentType: "image/webp",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/too long/);
  });

  it("404s unknown aviaries", async () => {
    const response = await mint({
      aviary: "nowhere",
      label: "Utest View",
      contentType: "image/webp",
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects labels that slug to nothing", async () => {
    const response = await mint({
      aviary: AVIARY,
      label: "★☆",
      contentType: "image/webp",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/letter or digit/);
  });

  it("mints a presigned PUT with a v1 key and audits it", async () => {
    const response = await mint({
      aviary: AVIARY,
      label: "Utest View",
      contentType: "image/webp",
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data;

    expect(data.key).toBe(`perch-diagram-${AVIARY}-utest-view-v1.webp`);
    expect(data.publicUrl).toBe(`${FAKE_BASE}/${data.key}`);
    const upload = new URL(data.uploadUrl);
    expect(upload.host).toBe(
      "test-bucket.testaccount.r2.cloudflarestorage.com",
    );
    expect(upload.pathname).toBe(`/${data.key}`);
    expect(upload.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(data.expiresInSeconds).toBeGreaterThan(0);
    expect(data.maxBytes).toBeGreaterThan(0);

    const audit = await query(
      `SELECT 1 FROM audit_log
       WHERE admin_user_id = $1 AND action = 'mint_upload_url' AND entity = 'perch_diagram'
         AND entity_id = $2`,
      [testUserId, `${AVIARY}/${data.key}`],
    );
    expect(audit.rows.length).toBe(1);
  });

  it("reserves the key: re-minting the same label never returns the same key", async () => {
    const first = await mint({
      aviary: AVIARY,
      label: "Utest Reserve",
      contentType: "image/webp",
    });
    const second = await mint({
      aviary: AVIARY,
      label: "Utest Reserve",
      contentType: "image/webp",
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().data.key).toBe(
      `perch-diagram-${AVIARY}-utest-reserve-v1.webp`,
    );
    expect(second.json().data.key).toBe(
      `perch-diagram-${AVIARY}-utest-reserve-v2.webp`,
    );
  });

  it("bumps the version when the URL is already used by a draft diagram", async () => {
    const aviaryId = (
      await query<{ id: string }>(`SELECT id FROM aviaries WHERE slug = $1`, [
        AVIARY,
      ])
    ).rows[0]!.id;
    await query(
      `INSERT INTO aviary_perch_diagrams (aviary_id, url, label, sort_order)
       VALUES ($1, $2, 'Utest Taken', 99)`,
      [aviaryId, `${FAKE_BASE}/perch-diagram-${AVIARY}-utest-taken-v1.webp`],
    );
    try {
      const response = await mint({
        aviary: AVIARY,
        label: "Utest Taken",
        contentType: "image/webp",
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.key).toBe(
        `perch-diagram-${AVIARY}-utest-taken-v2.webp`,
      );
    } finally {
      await query(
        `DELETE FROM aviary_perch_diagrams WHERE label = 'Utest Taken'`,
      );
    }
  });

  it("bumps the version when the URL was frozen into a published config version", async () => {
    // The core invariant: a URL published into history is never re-minted, so
    // its bucket object can never be overwritten. No draft row exists here —
    // only the published-history branch of the reuse guard can catch this.
    const frozenUrl = `${FAKE_BASE}/perch-diagram-${AVIARY}-utest-frozen-v1.webp`;
    await query(
      `INSERT INTO config_versions (config, notes, published_by) VALUES ($1, $2, $3)`,
      [
        JSON.stringify({
          aviaries: [
            { slug: AVIARY, perchDiagrams: [{ url: frozenUrl, label: "x" }] },
          ],
        }),
        VERSION_NOTE,
        testUserId,
      ],
    );
    try {
      const response = await mint({
        aviary: AVIARY,
        label: "Utest Frozen",
        contentType: "image/webp",
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.key).toBe(
        `perch-diagram-${AVIARY}-utest-frozen-v2.webp`,
      );
    } finally {
      await query(`DELETE FROM config_versions WHERE notes = $1`, [
        VERSION_NOTE,
      ]);
    }
  });
});
