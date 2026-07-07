/**
 * Admin write endpoints (Phase 3 stage 3C): CRUD over the Phase 1 editing
 * tables. The editing tables ARE the draft — nothing observers see changes
 * until POST /config/publish (adminConfig.ts).
 *
 * Registered inside admin.ts's session-guarded scope. Guardrail hierarchy
 * (design §3): these endpoints enforce LOCAL rules — reserved subject names
 * (P2-D8), Excel sheet-name round-trip, wire values immutable (no rename
 * endpoints exist), deletes only for never-published entities, friendly
 * episode-overlap errors. Publish enforces the GLOBAL append-only invariants.
 * Every mutation writes an audit row (P3-D5).
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/index.js';
import { isoDate } from '../utils/isoDate.js';
import { sanitizeSheetName } from '../services/excel.js';
import { GENERIC_SUBJECT_IDS } from '../constants.js';
import { recordAudit } from '../services/audit.js';

const VOCAB_KINDS = ['object', 'object_interaction', 'animal', 'animal_interaction'] as const;

// Editing-table kind → composed-document key (for published-containment checks)
const KIND_TO_DOC_KEY: Record<(typeof VOCAB_KINDS)[number], string> = {
  object: 'objects',
  object_interaction: 'objectInteractionTypes',
  animal: 'animals',
  animal_interaction: 'animalInteractionTypes',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits, and hyphens')
  .max(100);
const labelSchema = z.string().trim().min(1).max(255);
const wireValueSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, underscores, hyphens')
  .max(100);

function isPgError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

/** True if any published version's document contains the given fragment. */
async function everPublished(fragment: unknown): Promise<boolean> {
  const result = await query(`SELECT 1 FROM config_versions WHERE config @> $1::jsonb LIMIT 1`, [
    JSON.stringify(fragment),
  ]);
  return result.rows.length > 0;
}

async function aviaryBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
  const result = await query<{ id: string; slug: string }>(
    `SELECT id, slug FROM aviaries WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] ?? null;
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ success: false, error });
}

export const adminWriteRoutes: FastifyPluginAsync = async (app) => {
  // ===========================================================================
  // AVIARIES
  // ===========================================================================

  app.post('/aviaries', async (request, reply) => {
    const parsed = z
      .object({ slug: slugSchema, name: labelSchema })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'An aviary needs a slug (lowercase-with-hyphens) and a name');
    }
    const { slug, name } = parsed.data;

    try {
      await query(`INSERT INTO aviaries (slug, name) VALUES ($1, $2)`, [slug, name]);
    } catch (error) {
      if (isPgError(error, '23505')) {
        return fail(reply, 409, 'An aviary with that slug or name already exists');
      }
      throw error;
    }
    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'create',
      entity: 'aviary',
      entityId: slug,
      detail: { name },
    });
    return reply.status(201).send({ success: true, data: { slug, name } });
  });

  app.patch<{ Params: { slug: string } }>('/aviaries/:slug', async (request, reply) => {
    const parsed = z
      .object({ name: labelSchema.optional(), isActive: z.boolean().optional() })
      .refine((body) => body.name !== undefined || body.isActive !== undefined)
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'Provide a new name and/or isActive');
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.name !== undefined) {
      params.push(parsed.data.name);
      sets.push(`name = $${params.length}`);
    }
    if (parsed.data.isActive !== undefined) {
      params.push(parsed.data.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    params.push(request.params.slug);

    let updated;
    try {
      updated = await query<{ slug: string; name: string; isActive: boolean }>(
        `UPDATE aviaries SET ${sets.join(', ')}
         WHERE slug = $${params.length}
         RETURNING slug, name, is_active AS "isActive"`,
        params
      );
    } catch (error) {
      if (isPgError(error, '23505')) {
        return fail(reply, 409, 'Another aviary already has that name');
      }
      throw error;
    }
    if (!updated.rows[0]) return fail(reply, 404, 'Unknown aviary');

    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'update',
      entity: 'aviary',
      entityId: request.params.slug,
      detail: parsed.data,
    });
    return reply.status(200).send({ success: true, data: updated.rows[0] });
  });

  // ===========================================================================
  // PERCHES
  // ===========================================================================

  app.post<{ Params: { slug: string } }>('/aviaries/:slug/perches', async (request, reply) => {
    const parsed = z
      .object({
        value: z.string().trim().min(1).max(20),
        label: labelSchema,
        group: z.string().trim().min(1).max(100).nullish(),
        sortOrder: z.number().int().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'A perch needs a value (max 20 chars) and a label');

    const aviary = await aviaryBySlug(request.params.slug);
    if (!aviary) return fail(reply, 404, 'Unknown aviary');
    const { value, label, group, sortOrder } = parsed.data;

    try {
      await query(
        `INSERT INTO perches (aviary_id, value, label, perch_group, sort_order)
         VALUES ($1, $2, $3, $4,
                 COALESCE($5, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM perches WHERE aviary_id = $1)))`,
        [aviary.id, value, label, group ?? null, sortOrder ?? null]
      );
    } catch (error) {
      if (isPgError(error, '23505')) {
        return fail(reply, 409, `Perch "${value}" already exists in this aviary`);
      }
      throw error;
    }
    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'create',
      entity: 'perch',
      entityId: `${aviary.slug}/${value}`,
      detail: { label, group: group ?? null },
    });
    return reply.status(201).send({ success: true, data: { value, label } });
  });

  app.patch<{ Params: { slug: string; value: string } }>(
    '/aviaries/:slug/perches/:value',
    async (request, reply) => {
      const parsed = z
        .object({
          label: labelSchema.optional(),
          group: z.string().trim().min(1).max(100).nullable().optional(),
          sortOrder: z.number().int().optional(),
          retired: z.boolean().optional(),
        })
        .refine((body) => Object.values(body).some((v) => v !== undefined))
        .safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'Nothing to update');

      const aviary = await aviaryBySlug(request.params.slug);
      if (!aviary) return fail(reply, 404, 'Unknown aviary');

      const sets: string[] = [];
      const params: unknown[] = [];
      if (parsed.data.label !== undefined) {
        params.push(parsed.data.label);
        sets.push(`label = $${params.length}`);
      }
      if (parsed.data.group !== undefined) {
        params.push(parsed.data.group);
        sets.push(`perch_group = $${params.length}`);
      }
      if (parsed.data.sortOrder !== undefined) {
        params.push(parsed.data.sortOrder);
        sets.push(`sort_order = $${params.length}`);
      }
      if (parsed.data.retired !== undefined) {
        sets.push(
          parsed.data.retired ? `retired_at = COALESCE(retired_at, NOW())` : `retired_at = NULL`
        );
      }
      params.push(aviary.id, request.params.value);

      const updated = await query(
        `UPDATE perches SET ${sets.join(', ')}
         WHERE aviary_id = $${params.length - 1} AND value = $${params.length}
         RETURNING value`,
        params
      );
      if (!updated.rows[0]) return fail(reply, 404, 'Unknown perch');

      await recordAudit({
        adminUserId: request.adminUser!.id,
        action: 'update',
        entity: 'perch',
        entityId: `${aviary.slug}/${request.params.value}`,
        detail: parsed.data,
      });
      return reply.status(200).send({ success: true, data: { value: request.params.value } });
    }
  );

  app.delete<{ Params: { slug: string; value: string } }>(
    '/aviaries/:slug/perches/:value',
    async (request, reply) => {
      const aviary = await aviaryBySlug(request.params.slug);
      if (!aviary) return fail(reply, 404, 'Unknown aviary');

      const published = await everPublished({
        aviaries: [{ slug: aviary.slug, perches: [{ value: request.params.value }] }],
      });
      if (published) {
        return fail(
          reply,
          409,
          'This perch appears in a published config version and cannot be deleted — retire it instead'
        );
      }

      const deleted = await query(
        `DELETE FROM perches WHERE aviary_id = $1 AND value = $2 RETURNING value`,
        [aviary.id, request.params.value]
      );
      if (!deleted.rows[0]) return fail(reply, 404, 'Unknown perch');

      await recordAudit({
        adminUserId: request.adminUser!.id,
        action: 'delete',
        entity: 'perch',
        entityId: `${aviary.slug}/${request.params.value}`,
      });
      return reply.status(200).send({ success: true, data: { value: request.params.value } });
    }
  );

  // ===========================================================================
  // SUBJECTS (residency episodes)
  // ===========================================================================

  app.post<{ Params: { slug: string } }>('/aviaries/:slug/subjects', async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(255),
        species: labelSchema,
        type: z.enum(['foster_parent', 'juvenile', 'baby']),
        arrivedOn: isoDate,
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'A subject needs a name, species, type, and arrival date');
    }
    const { name, species, type, arrivedOn } = parsed.data;

    // P2-D8: names matching a generic wire literal would be indistinguishable
    // from unidentified sightings (case-insensitive to avoid near-collisions)
    const reserved = [...GENERIC_SUBJECT_IDS].some(
      (id) => id.toLowerCase() === name.toLowerCase()
    );
    if (reserved) {
      return fail(
        reply,
        400,
        `"${name}" is reserved for unidentified birds and cannot be used as a subject name`
      );
    }

    // Names must survive the Excel sheet-name rules unchanged (design §3):
    // no * ? : \ / [ ], max 28 chars, no boundary apostrophes, not "History"
    if (sanitizeSheetName(name) !== name) {
      return fail(
        reply,
        400,
        `Subject names become Excel sheet names: max 28 characters, no * ? : \\ / [ ], no leading/trailing apostrophes, and not "History" — "${name}" doesn't qualify`
      );
    }

    const aviary = await aviaryBySlug(request.params.slug);
    if (!aviary) return fail(reply, 404, 'Unknown aviary');

    const overlap = await query(
      `SELECT 1 FROM subjects
       WHERE aviary_id = $1 AND name = $2
         AND daterange(arrived_on, departed_on) && daterange($3::date, NULL)`,
      [aviary.id, name, arrivedOn]
    );
    if (overlap.rows[0]) {
      return fail(
        reply,
        409,
        `"${name}" already has a residency episode overlapping ${arrivedOn} — record a departure first`
      );
    }

    let inserted;
    try {
      inserted = await query<{ id: string }>(
        `INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [aviary.id, name, species, type, arrivedOn]
      );
    } catch (error) {
      if (isPgError(error, '23P01') || isPgError(error, '23505')) {
        return fail(reply, 409, `"${name}" already has an overlapping residency episode`);
      }
      throw error;
    }

    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'create',
      entity: 'subject',
      entityId: inserted.rows[0]!.id,
      detail: { aviary: aviary.slug, name, species, type, arrivedOn },
    });
    return reply.status(201).send({ success: true, data: { id: inserted.rows[0]!.id, name } });
  });

  app.patch<{ Params: { id: string } }>('/subjects/:id', async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return fail(reply, 404, 'Unknown subject');
    const parsed = z
      .object({
        species: labelSchema.optional(),
        departedOn: isoDate.nullable().optional(),
      })
      .refine((body) => body.species !== undefined || body.departedOn !== undefined)
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'Provide a species and/or departure date');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.species !== undefined) {
      params.push(parsed.data.species);
      sets.push(`species = $${params.length}`);
    }
    if (parsed.data.departedOn !== undefined) {
      params.push(parsed.data.departedOn);
      sets.push(`departed_on = $${params.length}`);
    }
    params.push(request.params.id);

    let updated;
    try {
      updated = await query<{ id: string; name: string }>(
        `UPDATE subjects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name`,
        params
      );
    } catch (error) {
      if (isPgError(error, '23514')) {
        return fail(reply, 400, 'The departure date must be after the arrival date');
      }
      if (isPgError(error, '23P01')) {
        return fail(reply, 409, 'That change would overlap another residency episode');
      }
      throw error;
    }
    if (!updated.rows[0]) return fail(reply, 404, 'Unknown subject');

    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'update',
      entity: 'subject',
      entityId: request.params.id,
      detail: parsed.data,
    });
    return reply.status(200).send({ success: true, data: updated.rows[0] });
  });

  // "Type change" (e.g. baby → juvenile) is one action that closes the open
  // episode and opens a new one on the effective date (Phase 1 §2.2)
  app.post<{ Params: { id: string } }>('/subjects/:id/change-type', async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return fail(reply, 404, 'Unknown subject');
    const parsed = z
      .object({
        newType: z.enum(['foster_parent', 'juvenile', 'baby']),
        effectiveOn: isoDate,
      })
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'Provide newType and effectiveOn');
    const { newType, effectiveOn } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const episode = await client.query<{
        id: string;
        aviary_id: string;
        name: string;
        species: string;
        subject_type: string;
        arrived_on: string;
        departed_on: string | null;
      }>(`SELECT * FROM subjects WHERE id = $1 FOR UPDATE`, [request.params.id]);
      const current = episode.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return fail(reply, 404, 'Unknown subject');
      }
      if (current.departed_on !== null) {
        await client.query('ROLLBACK');
        return fail(reply, 409, 'This episode is already closed — the bird has departed');
      }
      if (current.subject_type === newType) {
        await client.query('ROLLBACK');
        return fail(reply, 400, `This bird is already recorded as ${newType}`);
      }

      await client.query(`UPDATE subjects SET departed_on = $1 WHERE id = $2`, [
        effectiveOn,
        current.id,
      ]);
      const opened = await client.query<{ id: string }>(
        `INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [current.aviary_id, current.name, current.species, newType, effectiveOn]
      );
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: 'change_type',
          entity: 'subject',
          entityId: current.id,
          detail: { name: current.name, from: current.subject_type, to: newType, effectiveOn },
        },
        client
      );
      await client.query('COMMIT');
      return reply
        .status(200)
        .send({ success: true, data: { closedId: current.id, openedId: opened.rows[0]!.id } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPgError(error, '23514')) {
        return fail(reply, 400, 'The effective date must be after the arrival date');
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete<{ Params: { id: string } }>('/subjects/:id', async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.id)) return fail(reply, 404, 'Unknown subject');
    const episode = await query<{
      name: string;
      subject_type: string;
      arrived_on: string;
      slug: string;
    }>(
      `SELECT s.name, s.subject_type, to_char(s.arrived_on, 'YYYY-MM-DD') AS arrived_on, a.slug
       FROM subjects s JOIN aviaries a ON a.id = s.aviary_id WHERE s.id = $1`,
      [request.params.id]
    );
    const current = episode.rows[0];
    if (!current) return fail(reply, 404, 'Unknown subject');

    const published = await everPublished({
      aviaries: [
        {
          slug: current.slug,
          subjects: [
            { name: current.name, type: current.subject_type, arrivedOn: current.arrived_on },
          ],
        },
      ],
    });
    if (published) {
      return fail(
        reply,
        409,
        'This episode appears in a published config version and cannot be deleted — record a departure instead'
      );
    }

    await query(`DELETE FROM subjects WHERE id = $1`, [request.params.id]);
    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'delete',
      entity: 'subject',
      entityId: request.params.id,
      detail: { aviary: current.slug, name: current.name },
    });
    return reply.status(200).send({ success: true, data: { id: request.params.id } });
  });

  // ===========================================================================
  // BEHAVIOR GROUPS
  // ===========================================================================

  app.post('/behavior-groups', async (request, reply) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int() })
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'A group needs a name and a sort order');

    try {
      await query(`INSERT INTO behavior_groups (name, sort_order) VALUES ($1, $2)`, [
        parsed.data.name,
        parsed.data.sortOrder,
      ]);
    } catch (error) {
      if (isPgError(error, '23505')) {
        return fail(reply, 409, 'A group with that name already exists');
      }
      throw error;
    }
    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'create',
      entity: 'behavior_group',
      entityId: parsed.data.name,
      detail: { sortOrder: parsed.data.sortOrder },
    });
    return reply.status(201).send({ success: true, data: { name: parsed.data.name } });
  });

  // ===========================================================================
  // BEHAVIORS
  // ===========================================================================

  app.post('/behaviors', async (request, reply) => {
    // Every schema-mandated field is required (design §3): a half-specified
    // behavior can't reach publish
    const parsed = z
      .object({
        value: wireValueSchema,
        label: labelSchema,
        group: z.string().trim().min(1).max(100),
        requiresLocation: z.boolean(),
        requiresObject: z.boolean(),
        requiresObjectInteraction: z.boolean(),
        requiresAnimal: z.boolean(),
        requiresAnimalInteraction: z.boolean(),
        requiresDescription: z.boolean(),
        excelRowLabel: labelSchema,
        insertAfter: wireValueSchema.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(
        reply,
        400,
        'A behavior needs value, label, group, all six requires-flags, and an Excel row label'
      );
    }
    const body = parsed.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const group = await client.query<{ id: string }>(
        `SELECT id FROM behavior_groups WHERE name = $1`,
        [body.group]
      );
      if (!group.rows[0]) {
        await client.query('ROLLBACK');
        return fail(reply, 400, `Unknown behavior group "${body.group}" — create it first`);
      }

      let rowOrder: number;
      if (body.insertAfter) {
        const after = await client.query<{ excel_row_order: number }>(
          `SELECT excel_row_order FROM behaviors WHERE value = $1`,
          [body.insertAfter]
        );
        if (!after.rows[0]) {
          await client.query('ROLLBACK');
          return fail(reply, 400, `Unknown behavior "${body.insertAfter}" to insert after`);
        }
        rowOrder = after.rows[0].excel_row_order + 1;
        await client.query(
          `UPDATE behaviors SET excel_row_order = excel_row_order + 1 WHERE excel_row_order >= $1`,
          [rowOrder]
        );
      } else {
        const max = await client.query<{ next: number }>(
          `SELECT COALESCE(MAX(excel_row_order), 0) + 1 AS next FROM behaviors`
        );
        rowOrder = max.rows[0]!.next;
      }

      await client.query(
        `INSERT INTO behaviors (value, label, group_id, requires_location, requires_object,
           requires_object_interaction, requires_animal, requires_animal_interaction,
           requires_description, excel_row_label, excel_row_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          body.value,
          body.label,
          group.rows[0].id,
          body.requiresLocation,
          body.requiresObject,
          body.requiresObjectInteraction,
          body.requiresAnimal,
          body.requiresAnimalInteraction,
          body.requiresDescription,
          body.excelRowLabel,
          rowOrder,
        ]
      );
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: 'create',
          entity: 'behavior',
          entityId: body.value,
          detail: { label: body.label, group: body.group, excelRowOrder: rowOrder },
        },
        client
      );
      await client.query('COMMIT');
      return reply.status(201).send({ success: true, data: { value: body.value } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPgError(error, '23505')) {
        return fail(reply, 409, `Behavior "${body.value}" already exists`);
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch<{ Params: { value: string } }>('/behaviors/:value', async (request, reply) => {
    const parsed = z
      .object({
        label: labelSchema.optional(),
        group: z.string().trim().min(1).max(100).optional(),
        requiresLocation: z.boolean().optional(),
        requiresObject: z.boolean().optional(),
        requiresObjectInteraction: z.boolean().optional(),
        requiresAnimal: z.boolean().optional(),
        requiresAnimalInteraction: z.boolean().optional(),
        requiresDescription: z.boolean().optional(),
        excelRowLabel: labelSchema.optional(),
        retired: z.boolean().optional(),
      })
      .refine((body) => Object.values(body).some((v) => v !== undefined))
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'Nothing to update');
    const body = parsed.data;

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (body.label !== undefined) push('label', body.label);
    if (body.group !== undefined) {
      const group = await query<{ id: string }>(`SELECT id FROM behavior_groups WHERE name = $1`, [
        body.group,
      ]);
      if (!group.rows[0]) return fail(reply, 400, `Unknown behavior group "${body.group}"`);
      push('group_id', group.rows[0].id);
    }
    if (body.requiresLocation !== undefined) push('requires_location', body.requiresLocation);
    if (body.requiresObject !== undefined) push('requires_object', body.requiresObject);
    if (body.requiresObjectInteraction !== undefined)
      push('requires_object_interaction', body.requiresObjectInteraction);
    if (body.requiresAnimal !== undefined) push('requires_animal', body.requiresAnimal);
    if (body.requiresAnimalInteraction !== undefined)
      push('requires_animal_interaction', body.requiresAnimalInteraction);
    if (body.requiresDescription !== undefined)
      push('requires_description', body.requiresDescription);
    if (body.excelRowLabel !== undefined) push('excel_row_label', body.excelRowLabel);
    if (body.retired !== undefined) {
      sets.push(body.retired ? `retired_at = COALESCE(retired_at, NOW())` : `retired_at = NULL`);
    }
    params.push(request.params.value);

    const updated = await query(
      `UPDATE behaviors SET ${sets.join(', ')} WHERE value = $${params.length} RETURNING value`,
      params
    );
    if (!updated.rows[0]) return fail(reply, 404, 'Unknown behavior');

    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'update',
      entity: 'behavior',
      entityId: request.params.value,
      detail: body,
    });
    return reply.status(200).send({ success: true, data: { value: request.params.value } });
  });

  app.delete<{ Params: { value: string } }>('/behaviors/:value', async (request, reply) => {
    const published = await everPublished({ behaviors: [{ value: request.params.value }] });
    if (published) {
      return fail(
        reply,
        409,
        'This behavior appears in a published config version and cannot be deleted — retire it instead'
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM aviary_behaviors WHERE behavior_id = (SELECT id FROM behaviors WHERE value = $1)`,
        [request.params.value]
      );
      const deleted = await client.query(`DELETE FROM behaviors WHERE value = $1 RETURNING value`, [
        request.params.value,
      ]);
      if (!deleted.rows[0]) {
        await client.query('ROLLBACK');
        return fail(reply, 404, 'Unknown behavior');
      }
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: 'delete',
          entity: 'behavior',
          entityId: request.params.value,
        },
        client
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return reply.status(200).send({ success: true, data: { value: request.params.value } });
  });

  // ===========================================================================
  // VOCAB OPTIONS (objects, animals, interaction types)
  // ===========================================================================

  app.post('/options', async (request, reply) => {
    const parsed = z
      .object({ kind: z.enum(VOCAB_KINDS), value: wireValueSchema, label: labelSchema })
      .safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'An option needs a kind, value, and label');
    const { kind, value, label } = parsed.data;

    try {
      await query(`INSERT INTO vocab_options (kind, value, label) VALUES ($1, $2, $3)`, [
        kind,
        value,
        label,
      ]);
    } catch (error) {
      if (isPgError(error, '23505')) {
        return fail(reply, 409, `The ${kind} option "${value}" already exists`);
      }
      throw error;
    }
    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'create',
      entity: 'vocab_option',
      entityId: `${kind}/${value}`,
      detail: { label },
    });
    return reply.status(201).send({ success: true, data: { kind, value, label } });
  });

  app.patch<{ Params: { kind: string; value: string } }>(
    '/options/:kind/:value',
    async (request, reply) => {
      const kindParsed = z.enum(VOCAB_KINDS).safeParse(request.params.kind);
      if (!kindParsed.success) return fail(reply, 404, 'Unknown option kind');
      const parsed = z
        .object({ label: labelSchema.optional(), retired: z.boolean().optional() })
        .refine((body) => body.label !== undefined || body.retired !== undefined)
        .safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'Provide a label and/or retired');

      const sets: string[] = [];
      const params: unknown[] = [];
      if (parsed.data.label !== undefined) {
        params.push(parsed.data.label);
        sets.push(`label = $${params.length}`);
      }
      if (parsed.data.retired !== undefined) {
        sets.push(
          parsed.data.retired ? `retired_at = COALESCE(retired_at, NOW())` : `retired_at = NULL`
        );
      }
      params.push(kindParsed.data, request.params.value);

      const updated = await query(
        `UPDATE vocab_options SET ${sets.join(', ')}
         WHERE kind = $${params.length - 1} AND value = $${params.length}
         RETURNING value`,
        params
      );
      if (!updated.rows[0]) return fail(reply, 404, 'Unknown option');

      await recordAudit({
        adminUserId: request.adminUser!.id,
        action: 'update',
        entity: 'vocab_option',
        entityId: `${kindParsed.data}/${request.params.value}`,
        detail: parsed.data,
      });
      return reply.status(200).send({ success: true, data: { value: request.params.value } });
    }
  );

  app.delete<{ Params: { kind: string; value: string } }>(
    '/options/:kind/:value',
    async (request, reply) => {
      const kindParsed = z.enum(VOCAB_KINDS).safeParse(request.params.kind);
      if (!kindParsed.success) return fail(reply, 404, 'Unknown option kind');
      const kind = kindParsed.data;

      const published = await everPublished({
        [KIND_TO_DOC_KEY[kind]]: [{ value: request.params.value }],
      });
      if (published) {
        return fail(
          reply,
          409,
          'This option appears in a published config version and cannot be deleted — retire it instead'
        );
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM aviary_vocab_options
           WHERE vocab_option_id = (SELECT id FROM vocab_options WHERE kind = $1 AND value = $2)`,
          [kind, request.params.value]
        );
        const deleted = await client.query(
          `DELETE FROM vocab_options WHERE kind = $1 AND value = $2 RETURNING value`,
          [kind, request.params.value]
        );
        if (!deleted.rows[0]) {
          await client.query('ROLLBACK');
          return fail(reply, 404, 'Unknown option');
        }
        await recordAudit(
          {
            adminUserId: request.adminUser!.id,
            action: 'delete',
            entity: 'vocab_option',
            entityId: `${kind}/${request.params.value}`,
          },
          client
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return reply.status(200).send({ success: true, data: { value: request.params.value } });
    }
  );

  // ===========================================================================
  // ENABLEMENT (replace-set per aviary — the matrix UI submits the whole set)
  // ===========================================================================

  app.put<{ Params: { slug: string } }>('/aviaries/:slug/enablement', async (request, reply) => {
    const parsed = z
      .object({
        behaviors: z.array(wireValueSchema),
        object: z.array(wireValueSchema),
        object_interaction: z.array(wireValueSchema),
        animal: z.array(wireValueSchema),
        animal_interaction: z.array(wireValueSchema),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'Provide behaviors plus all four option kinds as arrays of values');
    }
    const body = parsed.data;

    const aviary = await aviaryBySlug(request.params.slug);
    if (!aviary) return fail(reply, 404, 'Unknown aviary');

    // Validate every value exists in the catalog before touching junctions
    const behaviorValues = [...new Set(body.behaviors)];
    const known = await query<{ value: string }>(
      `SELECT value FROM behaviors WHERE value = ANY($1)`,
      [behaviorValues]
    );
    if (known.rows.length !== behaviorValues.length) {
      const knownSet = new Set(known.rows.map((r) => r.value));
      const unknown = behaviorValues.filter((v) => !knownSet.has(v));
      return fail(reply, 400, `Unknown behaviors: ${unknown.join(', ')}`);
    }
    for (const kind of VOCAB_KINDS) {
      const values = [...new Set(body[kind])];
      const knownOptions = await query<{ value: string }>(
        `SELECT value FROM vocab_options WHERE kind = $1 AND value = ANY($2)`,
        [kind, values]
      );
      if (knownOptions.rows.length !== values.length) {
        const knownSet = new Set(knownOptions.rows.map((r) => r.value));
        const unknown = values.filter((v) => !knownSet.has(v));
        return fail(reply, 400, `Unknown ${kind} options: ${unknown.join(', ')}`);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM aviary_behaviors WHERE aviary_id = $1`, [aviary.id]);
      await client.query(
        `INSERT INTO aviary_behaviors (aviary_id, behavior_id)
         SELECT $1, id FROM behaviors WHERE value = ANY($2)`,
        [aviary.id, behaviorValues]
      );
      await client.query(`DELETE FROM aviary_vocab_options WHERE aviary_id = $1`, [aviary.id]);
      for (const kind of VOCAB_KINDS) {
        await client.query(
          `INSERT INTO aviary_vocab_options (aviary_id, vocab_option_id)
           SELECT $1, id FROM vocab_options WHERE kind = $2 AND value = ANY($3)`,
          [aviary.id, kind, [...new Set(body[kind])]]
        );
      }
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: 'set_enablement',
          entity: 'aviary',
          entityId: aviary.slug,
          detail: {
            behaviors: behaviorValues.length,
            object: new Set(body.object).size,
            object_interaction: new Set(body.object_interaction).size,
            animal: new Set(body.animal).size,
            animal_interaction: new Set(body.animal_interaction).size,
          },
        },
        client
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return reply.status(200).send({ success: true, data: { slug: aviary.slug } });
  });
};
