import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { query, closePool } from "../db/index.js";
import { generateToken, hashToken } from "../utils/adminTokens.js";
import { SESSION_COOKIE } from "./admin.js";

const TEST_EMAIL = "admin-read-test@example.com";

let app: FastifyInstance;
let testUserId: string;
let sessionToken: string;
let aliceObservationId: string;
const observationIds: string[] = [];

async function get(url: string) {
  return app.inject({
    method: "GET",
    url,
    cookies: { [SESSION_COOKIE]: sessionToken },
  });
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
      observer_name, observation_date, start_time, end_time, aviary, aviary_id,
      time_slots, submitted_at
    ) VALUES ($1, $2, '14:00', '14:30', $3, $4, $5, $6) RETURNING id`,
    [
      fields.observer,
      fields.date,
      fields.aviaryText,
      fields.aviaryId ?? null,
      JSON.stringify({
        "14:00": [
          {
            subjectType: "foster_parent",
            subjectId: "Sayyida",
            behavior: "resting",
            location: "5",
            notes: "",
          },
        ],
        "14:05": [
          {
            subjectType: "foster_parent",
            subjectId: "Sayyida",
            behavior: "flying",
            location: "",
            notes: "",
          },
        ],
      }),
      fields.submittedAt,
    ],
  );
  const id = result.rows[0]!.id;
  observationIds.push(id);
  return id;
}

beforeAll(async () => {
  app = await buildApp();

  // A killed prior run never reaches afterAll — sweep its leftovers first so
  // the count/order/pagination assertions below can't fail for stale reasons
  await query(`DELETE FROM observations WHERE observer_name LIKE 'ReadTest%'`);
  await query(`DELETE FROM aviaries WHERE slug = 'empty-test-aviary'`);

  const user = await query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name) VALUES ($1, 'Read Test Admin')
     ON CONFLICT (email) DO UPDATE SET is_active = true
     RETURNING id`,
    [TEST_EMAIL],
  );
  testUserId = user.rows[0]!.id;
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [
    testUserId,
  ]);

  sessionToken = generateToken();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '1 day')`,
    [testUserId, hashToken(sessionToken)],
  );

  const aviaryId = (
    await query<{ id: string }>(
      `SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'`,
    )
  ).rows[0]!.id;

  aliceObservationId = await insertObservation({
    observer: "ReadTest Alice",
    date: "2026-03-01",
    aviaryText: "sayyidas-cove",
    aviaryId,
    submittedAt: "2026-03-01T20:00:00.000Z",
  });
  await insertObservation({
    observer: "ReadTest Bob",
    date: "2026-04-01",
    aviaryText: "Legacy Aviary Label",
    aviaryId: null,
    submittedAt: "2026-04-01T20:00:00.000Z",
  });
});

afterAll(async () => {
  if (observationIds.length) {
    await query(`DELETE FROM observations WHERE id = ANY($1::uuid[])`, [
      observationIds,
    ]);
  }
  await query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [
    testUserId,
  ]);
  await query(`DELETE FROM admin_users WHERE email = $1`, [TEST_EMAIL]);
  await app.close();
  await closePool();
});

describe("auth guard on read endpoints", () => {
  it.each([
    "/api/admin/overview",
    "/api/admin/aviaries/sayyidas-cove",
    "/api/admin/vocabulary",
    "/api/admin/config-versions",
    "/api/admin/submissions",
  ])("%s returns 401 without a session", async (url) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/admin/overview", () => {
  it("returns aviary cards, the latest version, and the unpublished flag", async () => {
    const response = await get("/api/admin/overview");
    expect(response.statusCode).toBe(200);
    const { aviaries, latestVersion, unpublishedChanges } =
      response.json().data;

    expect(aviaries).toHaveLength(1);
    expect(aviaries[0]).toMatchObject({
      slug: "sayyidas-cove",
      name: "Sayyida's Cove",
      isActive: true,
      currentSubjects: 4, // Sayyida + juveniles 187(B)/216(O)/253(R)
      perches: 50, // active only (overview filters retired); 009 re-catalog
      diagrams: 3, // Eastern Perimeter / NW & Central / SW & Central (009)
    });
    // Grows by one with each config publish (v5 = number-forward labels);
    // assert a floor rather than pinning a churn-prone exact number.
    expect(latestVersion.version).toBeGreaterThanOrEqual(5);
    expect(latestVersion.publishedAt).toBeTruthy();
    // Editing tables match the latest snapshot on a freshly migrated DB
    expect(unpublishedChanges).toBe(false);
  });

  it("reports unpublished changes when the editing tables drift", async () => {
    await query(
      `UPDATE behaviors SET label = label || ' (drift)' WHERE value = 'flying'`,
    );
    try {
      const drifted = await get("/api/admin/overview");
      expect(drifted.json().data.unpublishedChanges).toBe(true);
    } finally {
      await query(
        `UPDATE behaviors SET label = replace(label, ' (drift)', '') WHERE value = 'flying'`,
      );
    }
    const restored = await get("/api/admin/overview");
    expect(restored.json().data.unpublishedChanges).toBe(false);
  });
});

describe("GET /api/admin/aviaries/:slug", () => {
  it("404s for an unknown slug", async () => {
    const response = await get("/api/admin/aviaries/nowhere");
    expect(response.statusCode).toBe(404);
  });

  it("returns Sayyida's Cove in full", async () => {
    const response = await get("/api/admin/aviaries/sayyidas-cove");
    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    expect(data.name).toBe("Sayyida's Cove");
    expect(data.diagrams).toHaveLength(3); // 009 re-catalog: 3 diagram views
    for (const diagram of data.diagrams) {
      expect(diagram.url).toMatch(/^https:\/\/.*\.r2\.dev\/.*\.webp$/);
      expect(diagram.label).toBeTruthy();
    }

    // Editing view includes retired perches: 50 active + 5 retired old-format specials
    expect(data.perches).toHaveLength(55);
    expect(
      data.perches.find((p: { value: string }) => p.value === "Ground"),
    ).toBeTruthy();

    expect(data.subjects).toHaveLength(4);
    const sayyida = data.subjects.find(
      (s: { name: string }) => s.name === "Sayyida",
    );
    expect(sayyida).toMatchObject({ type: "foster_parent", current: true });
    expect(sayyida.arrivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The editing UI addresses episodes by UUID (PATCH/change-type/DELETE)
    expect(sayyida.id).toMatch(/^[0-9a-f-]{36}$/);
    const juvenile = data.subjects.find(
      (s: { name: string }) => s.name === "187(B)",
    );
    expect(juvenile).toMatchObject({
      type: "juvenile",
      current: true,
      arrivedOn: "2026-06-01",
    });

    // The junctions enable the full catalog (incl. retired entries, kept for history)
    expect(data.enabled.behaviors).toHaveLength(23);
    expect(data.enabled.object).toHaveLength(10);
    expect(data.enabled.object_interaction).toHaveLength(6);
    expect(data.enabled.animal).toHaveLength(9);
    expect(data.enabled.animal_interaction).toHaveLength(11);
  });
});

describe("GET /api/admin/vocabulary", () => {
  it("returns the catalog with groups, flags, and the enablement matrix", async () => {
    const response = await get("/api/admin/vocabulary");
    expect(response.statusCode).toBe(200);
    const data = response.json().data;

    expect(data.behaviorGroups.map((g: { name: string }) => g.name)).toEqual([
      "Feeding",
      "Locomotion",
      "Resting",
      "Maintenance",
      "Social & Environmental",
      "Other",
    ]);

    expect(data.behaviors).toHaveLength(23);
    expect(
      data.behaviors.filter((b: { retired: boolean }) => b.retired),
    ).toHaveLength(5);
    const withLocation = data.behaviors.find(
      (b: { requiresLocation: boolean }) => b.requiresLocation,
    );
    expect(withLocation).toBeTruthy();
    expect(withLocation.group).toBeTruthy();
    expect(withLocation.excelRowLabel).toBeTruthy();

    expect(data.options.object).toHaveLength(10);
    expect(data.options.object_interaction).toHaveLength(6);
    expect(data.options.animal).toHaveLength(9);
    expect(data.options.animal_interaction).toHaveLength(11);

    expect(data.enablement["sayyidas-cove"].behaviors).toHaveLength(23);
    expect(data.enablement["sayyidas-cove"].animal_interaction).toHaveLength(
      11,
    );

    // slug → display name, so the enablement matrix can head columns with names
    expect(data.aviaries).toContainEqual({
      slug: "sayyidas-cove",
      name: "Sayyida's Cove",
    });
  });

  it("lists an aviary with zero enablements as an all-empty bucket, not a missing key", async () => {
    await query(
      `INSERT INTO aviaries (slug, name) VALUES ('empty-test-aviary', 'Empty Test')`,
    );
    try {
      const response = await get("/api/admin/vocabulary");
      expect(response.json().data.enablement["empty-test-aviary"]).toEqual({
        behaviors: [],
        object: [],
        object_interaction: [],
        animal: [],
        animal_interaction: [],
      });
    } finally {
      await query(`DELETE FROM aviaries WHERE slug = 'empty-test-aviary'`);
    }
  });
});

describe("GET /api/admin/config-versions", () => {
  it("lists published versions newest-first", async () => {
    const response = await get("/api/admin/config-versions");
    expect(response.statusCode).toBe(200);
    const { versions } = response.json().data;

    // Test the newest-first property, not the exact list — the version count
    // grows with every publish (now through v5) and pinning it churns.
    const nums = versions.map((v: { version: number }) => v.version);
    expect(nums.length).toBeGreaterThanOrEqual(5);
    expect([...nums].sort((a: number, b: number) => b - a)).toEqual(nums); // descending
    expect(new Set(nums).size).toBe(nums.length); // no duplicates
    expect(nums[nums.length - 1]).toBe(1); // v1 is the oldest
    for (const version of versions) {
      expect(version.publishedAt).toBeTruthy();
      // publishedBy is present on every row (NULL for engineering-script publishes)
      expect(version).toHaveProperty("publishedBy");
    }
  });

  it("attributes a dashboard publish to the admin who made it", async () => {
    // Publish a trivial draft change AS this test admin, then read it back
    await query(
      `UPDATE behaviors SET label = label || ' (attr)' WHERE value = 'flying'`,
    );
    let publishedVersion: number | undefined;
    try {
      const published = await app.inject({
        method: "POST",
        url: "/api/admin/config/publish",
        headers: { "x-ethogram-admin": "1" },
        cookies: { [SESSION_COOKIE]: sessionToken },
        payload: { notes: "attribution read-test" },
      });
      expect(published.statusCode).toBe(201);
      publishedVersion = published.json().data.version;

      const list = await get("/api/admin/config-versions");
      const row = list
        .json()
        .data.versions.find(
          (v: { version: number }) => v.version === publishedVersion,
        );
      expect(row.publishedBy).toBe("Read Test Admin");
    } finally {
      await query(
        `UPDATE behaviors SET label = replace(label, ' (attr)', '') WHERE value = 'flying'`,
      );
      if (publishedVersion !== undefined) {
        await query(`DELETE FROM config_versions WHERE id = $1`, [
          publishedVersion,
        ]);
        await query(
          `SELECT setval(pg_get_serial_sequence('config_versions','id'), MAX(id)) FROM config_versions`,
        );
      }
    }
  });
});

describe("GET /api/admin/submissions", () => {
  it("lists submissions newest-first with resolved aviary names", async () => {
    const response = await get("/api/admin/submissions?observer=ReadTest");
    expect(response.statusCode).toBe(200);
    const { items, total } = response.json().data;

    expect(total).toBe(2);
    expect(items.map((i: { observerName: string }) => i.observerName)).toEqual([
      "ReadTest Bob",
      "ReadTest Alice",
    ]);

    const alice = items[1];
    expect(alice).toMatchObject({
      // The id IS the Excel-download capability (P3-D6) — pin it exactly
      id: aliceObservationId,
      observationDate: "2026-03-01",
      aviarySlug: "sayyidas-cove",
      aviaryName: "Sayyida's Cove",
      slotCount: 2,
    });
    expect(alice.startTime).toMatch(/^14:00/);

    // Legacy row: no resolved aviary — the free-text label passes through
    const bob = items[0];
    expect(bob).toMatchObject({
      aviarySlug: null,
      aviaryName: "Legacy Aviary Label",
    });
  });

  it("filters by date range", async () => {
    const response = await get(
      "/api/admin/submissions?observer=ReadTest&from=2026-03-15&to=2026-05-01",
    );
    const { items, total } = response.json().data;
    expect(total).toBe(1);
    expect(items[0].observerName).toBe("ReadTest Bob");
  });

  it("filters by aviary slug and by legacy label", async () => {
    const bySlug = await get(
      "/api/admin/submissions?observer=ReadTest&aviary=sayyidas-cove",
    );
    expect(
      bySlug
        .json()
        .data.items.map((i: { observerName: string }) => i.observerName),
    ).toEqual(["ReadTest Alice"]);

    const byLegacy = await get(
      "/api/admin/submissions?observer=ReadTest&aviary=Legacy%20Aviary%20Label",
    );
    expect(
      byLegacy
        .json()
        .data.items.map((i: { observerName: string }) => i.observerName),
    ).toEqual(["ReadTest Bob"]);
  });

  it("filters by aviary DISPLAY NAME as a substring (what staff actually type)", async () => {
    // "Sayyida" is the display name, not the slug — the old exact-slug match
    // returned nothing; now it resolves via a name ILIKE
    const byName = await get(
      "/api/admin/submissions?observer=ReadTest&aviary=Sayyida",
    );
    expect(
      byName
        .json()
        .data.items.map((i: { observerName: string }) => i.observerName),
    ).toEqual(["ReadTest Alice"]);
  });

  it("paginates with limit/offset and reports the unpaginated total", async () => {
    const response = await get(
      "/api/admin/submissions?observer=ReadTest&limit=1&offset=1",
    );
    const { items, total } = response.json().data;
    expect(total).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].observerName).toBe("ReadTest Alice");
  });

  it("rejects malformed filters", async () => {
    const response = await get("/api/admin/submissions?from=yesterday");
    expect(response.statusCode).toBe(400);
  });

  it("rejects calendar-invalid dates with a 400, not a Postgres 500", async () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2027-02-29"]) {
      const response = await get(`/api/admin/submissions?from=${bad}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        success: false,
        error: "Invalid filter parameters",
      });
    }
  });
});
