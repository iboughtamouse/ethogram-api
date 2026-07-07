/**
 * Read-only admin endpoints (Phase 3 stage 3B): the dashboard's data plumbing.
 *
 * Registered inside admin.ts's session-guarded scope, so every route here
 * already sits behind requireAdminSession + the Origin/CSRF hooks. Nothing
 * observer-facing changes; no mutations exist until stage 3C.
 *
 * Design: ethogram-notes/01-ACTIVE/config-as-data-phase3-design.md §5.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';

const VOCAB_KINDS = ['object', 'object_interaction', 'animal', 'animal_interaction'] as const;

// Shape AND calendar validity: '2026-02-30' passes the regex but must 400,
// not reach Postgres and 500. Date.parse alone is NOT enough — V8 rolls
// out-of-range days over (Feb 30 → Mar 2) — so round-trip the parsed date
// back to a string and require it to match.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(value); // date-only ISO strings parse as UTC midnight
    return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
  });

const submissionsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  observer: z.string().max(255).optional(),
  aviary: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminReadRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /overview — aviary cards + latest published version + unpublished flag
  // ---------------------------------------------------------------------------
  app.get('/overview', async (_request, reply) => {
    const [aviaries, latest, unpublished] = await Promise.all([
      query<{
        slug: string;
        name: string;
        isActive: boolean;
        currentSubjects: number;
        perches: number;
        diagrams: number;
      }>(
        `SELECT a.slug, a.name, a.is_active AS "isActive",
                (SELECT COUNT(*)::int FROM subjects s
                 WHERE s.aviary_id = a.id
                   AND s.arrived_on <= CURRENT_DATE
                   AND (s.departed_on IS NULL OR s.departed_on > CURRENT_DATE)) AS "currentSubjects",
                (SELECT COUNT(*)::int FROM perches p
                 WHERE p.aviary_id = a.id AND p.retired_at IS NULL) AS perches,
                (SELECT COUNT(*)::int FROM aviary_perch_diagrams d
                 WHERE d.aviary_id = a.id) AS diagrams
         FROM aviaries a
         ORDER BY a.name`
      ),
      query<{ version: number; publishedAt: string; notes: string | null }>(
        `SELECT id AS version, published_at AS "publishedAt", notes
         FROM config_versions ORDER BY id DESC LIMIT 1`
      ),
      // Same comparison the publish idempotency checks use (migrations 005/006):
      // any drift between the editing tables and the latest snapshot
      query<{ changed: boolean }>(
        `SELECT compose_config() IS DISTINCT FROM
                (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1) AS changed`
      ),
    ]);

    return reply.status(200).send({
      success: true,
      data: {
        aviaries: aviaries.rows,
        latestVersion: latest.rows[0] ?? null,
        unpublishedChanges: unpublished.rows[0]!.changed,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /aviaries/:slug — everything the dashboard shows for one aviary
  // ---------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>('/aviaries/:slug', async (request, reply) => {
    const aviary = await query<{ id: string; slug: string; name: string; isActive: boolean }>(
      `SELECT id, slug, name, is_active AS "isActive" FROM aviaries WHERE slug = $1`,
      [request.params.slug]
    );
    const found = aviary.rows[0];
    if (!found) {
      return reply.status(404).send({ success: false, error: 'Unknown aviary' });
    }

    const [diagrams, perches, subjects, behaviors, options] = await Promise.all([
      query<{ url: string; label: string }>(
        `SELECT url, label FROM aviary_perch_diagrams
         WHERE aviary_id = $1 ORDER BY sort_order, label`,
        [found.id]
      ),
      query<{ value: string; label: string; group: string | null; retired: boolean }>(
        `SELECT value, label, perch_group AS "group", retired_at IS NOT NULL AS retired
         FROM perches WHERE aviary_id = $1 ORDER BY sort_order, value`,
        [found.id]
      ),
      query<{
        name: string;
        species: string;
        type: string;
        arrivedOn: string;
        departedOn: string | null;
        current: boolean;
      }>(
        `SELECT name, species, subject_type AS type,
                arrived_on::text AS "arrivedOn", departed_on::text AS "departedOn",
                (arrived_on <= CURRENT_DATE
                 AND (departed_on IS NULL OR departed_on > CURRENT_DATE)) AS current
         FROM subjects WHERE aviary_id = $1
         ORDER BY arrived_on, name`,
        [found.id]
      ),
      query<{ value: string }>(
        `SELECT b.value FROM aviary_behaviors ab
         JOIN behaviors b ON b.id = ab.behavior_id
         WHERE ab.aviary_id = $1 ORDER BY b.excel_row_order`,
        [found.id]
      ),
      query<{ kind: string; value: string }>(
        `SELECT v.kind, v.value FROM aviary_vocab_options av
         JOIN vocab_options v ON v.id = av.vocab_option_id
         WHERE av.aviary_id = $1 ORDER BY v.kind, v.label`,
        [found.id]
      ),
    ]);

    const enabled: Record<string, string[]> = { behaviors: behaviors.rows.map((r) => r.value) };
    for (const kind of VOCAB_KINDS) {
      enabled[kind] = options.rows.filter((r) => r.kind === kind).map((r) => r.value);
    }

    return reply.status(200).send({
      success: true,
      data: {
        slug: found.slug,
        name: found.name,
        isActive: found.isActive,
        diagrams: diagrams.rows,
        perches: perches.rows,
        subjects: subjects.rows,
        enabled,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /vocabulary — the full catalog + per-aviary enablement matrix
  // ---------------------------------------------------------------------------
  app.get('/vocabulary', async (_request, reply) => {
    const [allAviaries, groups, behaviors, options, behaviorEnablement, optionEnablement] =
      await Promise.all([
        query<{ slug: string }>(`SELECT slug FROM aviaries ORDER BY slug`),
        query<{ name: string; sortOrder: number }>(
        `SELECT name, sort_order AS "sortOrder" FROM behavior_groups ORDER BY sort_order`
      ),
      query<{
        value: string;
        label: string;
        group: string;
        requiresLocation: boolean;
        requiresObject: boolean;
        requiresObjectInteraction: boolean;
        requiresAnimal: boolean;
        requiresAnimalInteraction: boolean;
        requiresDescription: boolean;
        excelRowLabel: string;
        excelRowOrder: number;
        retired: boolean;
      }>(
        `SELECT b.value, b.label, g.name AS "group",
                b.requires_location AS "requiresLocation",
                b.requires_object AS "requiresObject",
                b.requires_object_interaction AS "requiresObjectInteraction",
                b.requires_animal AS "requiresAnimal",
                b.requires_animal_interaction AS "requiresAnimalInteraction",
                b.requires_description AS "requiresDescription",
                b.excel_row_label AS "excelRowLabel",
                b.excel_row_order AS "excelRowOrder",
                b.retired_at IS NOT NULL AS retired
         FROM behaviors b JOIN behavior_groups g ON g.id = b.group_id
         ORDER BY b.excel_row_order`
      ),
      query<{ kind: string; value: string; label: string; retired: boolean }>(
        `SELECT kind, value, label, retired_at IS NOT NULL AS retired
         FROM vocab_options ORDER BY kind, label`
      ),
      query<{ slug: string; value: string }>(
        `SELECT a.slug, b.value FROM aviary_behaviors ab
         JOIN aviaries a ON a.id = ab.aviary_id
         JOIN behaviors b ON b.id = ab.behavior_id`
      ),
      query<{ slug: string; kind: string; value: string }>(
        `SELECT a.slug, v.kind, v.value FROM aviary_vocab_options av
         JOIN aviaries a ON a.id = av.aviary_id
         JOIN vocab_options v ON v.id = av.vocab_option_id`
      ),
    ]);

    const enablement: Record<string, Record<string, string[]>> = {};
    const bucketFor = (slug: string): Record<string, string[]> => {
      if (!enablement[slug]) {
        enablement[slug] = { behaviors: [] };
        for (const kind of VOCAB_KINDS) enablement[slug][kind] = [];
      }
      return enablement[slug];
    };
    // Seed a bucket for EVERY aviary first: one with zero enablements (e.g. a
    // freshly created blank aviary) must appear as an all-empty column in the
    // matrix, not silently vanish from it
    for (const row of allAviaries.rows) bucketFor(row.slug);
    for (const row of behaviorEnablement.rows) bucketFor(row.slug).behaviors!.push(row.value);
    for (const row of optionEnablement.rows) bucketFor(row.slug)[row.kind]!.push(row.value);

    const optionsByKind: Record<string, { value: string; label: string; retired: boolean }[]> = {};
    for (const kind of VOCAB_KINDS) {
      optionsByKind[kind] = options.rows
        .filter((r) => r.kind === kind)
        .map(({ value, label, retired }) => ({ value, label, retired }));
    }

    return reply.status(200).send({
      success: true,
      data: {
        behaviorGroups: groups.rows,
        behaviors: behaviors.rows,
        options: optionsByKind,
        enablement,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /config-versions — published history, newest first
  // ---------------------------------------------------------------------------
  app.get('/config-versions', async (_request, reply) => {
    const versions = await query<{ version: number; publishedAt: string; notes: string | null }>(
      `SELECT id AS version, published_at AS "publishedAt", notes
       FROM config_versions ORDER BY id DESC`
    );
    return reply.status(200).send({ success: true, data: { versions: versions.rows } });
  });

  // ---------------------------------------------------------------------------
  // GET /submissions — recent observations (P3-D6); Excel download reuses the
  // existing public GET /api/observations/:id/excel (the UUID is the capability)
  // ---------------------------------------------------------------------------
  app.get('/submissions', async (request, reply) => {
    const parsed = submissionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid filter parameters' });
    }
    const { from, to, observer, aviary, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      where.push(`o.observation_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`o.observation_date <= $${params.length}`);
    }
    if (observer) {
      params.push(`%${observer}%`);
      where.push(`o.observer_name ILIKE $${params.length}`);
    }
    if (aviary) {
      // Matches the resolved aviary's slug, or the legacy free-text column for
      // rows that predate slug resolution
      params.push(aviary);
      where.push(`(a.slug = $${params.length} OR o.aviary = $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM observations o LEFT JOIN aviaries a ON a.id = o.aviary_id ${whereSql}`;

    const [items, total] = await Promise.all([
      query<{
        id: string;
        submittedAt: string;
        observationDate: string;
        startTime: string;
        endTime: string;
        observerName: string;
        mode: string;
        aviarySlug: string | null;
        aviaryName: string;
        slotCount: number;
      }>(
        `SELECT o.id, o.submitted_at AS "submittedAt",
                o.observation_date::text AS "observationDate",
                o.start_time::text AS "startTime", o.end_time::text AS "endTime",
                o.observer_name AS "observerName", o.mode,
                a.slug AS "aviarySlug", COALESCE(a.name, o.aviary) AS "aviaryName",
                (SELECT COUNT(*)::int FROM jsonb_object_keys(o.time_slots)) AS "slotCount"
         ${fromSql}
         ORDER BY o.submitted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query<{ count: number }>(`SELECT COUNT(*)::int AS count ${fromSql}`, params),
    ]);

    return reply.status(200).send({
      success: true,
      data: { items: items.rows, total: total.rows[0]!.count },
    });
  });
};
