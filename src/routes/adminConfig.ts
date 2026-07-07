/**
 * Config diff + publish (Phase 3 stage 3C, P3-D3): POST /config/publish is
 * the ONLY write path to config_versions. It recomposes the resolved document
 * and validates the Phase 1 §3.1 append-only invariants against EVERY prior
 * published version — inside one transaction serialized by
 * pg_advisory_xact_lock, so two concurrent publishes can't both validate
 * against pre-race state and both insert.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/index.js';
import { recordAudit } from '../services/audit.js';
import {
  appendOnlyViolations,
  diffConfigs,
  type ConfigDoc,
} from '../services/configDiff.js';

const publishSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  confirmFlagChanges: z.boolean().optional(),
  confirmRowMapChanges: z.boolean().optional(),
});

export const adminConfigRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /config/diff — the review-step summary (§5 MVP): what publish would do
  // ---------------------------------------------------------------------------
  app.get('/config/diff', async (_request, reply) => {
    const [nextResult, priorsResult, identicalResult] = await Promise.all([
      query<{ config: ConfigDoc }>(`SELECT compose_config() AS config`),
      query<{ id: number; config: ConfigDoc }>(`SELECT id, config FROM config_versions ORDER BY id`),
      query<{ identical: boolean }>(
        `SELECT compose_config() IS NOT DISTINCT FROM
                (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1) AS identical`
      ),
    ]);

    const next = nextResult.rows[0]!.config;
    const priors = priorsResult.rows.map((row) => ({ version: row.id, config: row.config }));
    const latest = priors[priors.length - 1] ?? null;

    const violations = appendOnlyViolations(priors, next);
    const summary = diffConfigs(latest?.config ?? null, next);

    return reply.status(200).send({
      success: true,
      data: {
        identical: identicalResult.rows[0]!.identical,
        latestVersion: latest?.version ?? null,
        changes: summary.changes,
        flagChanges: summary.flagChanges,
        rowMapChanges: summary.rowMapChanges,
        violations,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/publish
  // ---------------------------------------------------------------------------
  app.post('/config/publish', async (request, reply) => {
    const parsed = publishSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid publish request' });
    }
    const { notes, confirmFlagChanges, confirmRowMapChanges } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize all publishes: without this, two concurrent requests could
      // both validate against pre-race state and both insert (design §3)
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('ethogram-config-publish'))`);

      const identical = await client.query<{ identical: boolean }>(
        `SELECT compose_config() IS NOT DISTINCT FROM
                (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1) AS identical`
      );
      if (identical.rows[0]!.identical) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          success: false,
          error: 'Nothing to publish — the editing tables match the latest published version',
        });
      }

      const nextResult = await client.query<{ config: ConfigDoc }>(
        `SELECT compose_config() AS config`
      );
      const priorsResult = await client.query<{ id: number; config: ConfigDoc }>(
        `SELECT id, config FROM config_versions ORDER BY id`
      );
      const next = nextResult.rows[0]!.config;
      const priors = priorsResult.rows.map((row) => ({ version: row.id, config: row.config }));
      const latest = priors[priors.length - 1] ?? null;

      const violations = appendOnlyViolations(priors, next);
      if (violations.length) {
        await client.query('ROLLBACK');
        return reply.status(422).send({
          success: false,
          error: 'Publish blocked: these changes would break already-published values',
          violations,
        });
      }

      const summary = diffConfigs(latest?.config ?? null, next);
      if (summary.flagChanges.length && !confirmFlagChanges) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          success: false,
          error:
            'Some behaviors changed which extra fields they need — this alters how FUTURE observations are entered. Re-publish with confirmFlagChanges: true to proceed.',
          flagChanges: summary.flagChanges,
        });
      }
      if (summary.rowMapChanges.length && !confirmRowMapChanges) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          success: false,
          error:
            'Some behaviors changed their Excel row label or position — this alters how FUTURE workbooks render. Re-publish with confirmRowMapChanges: true to proceed.',
          rowMapChanges: summary.rowMapChanges,
        });
      }

      const inserted = await client.query<{ id: number; published_at: string }>(
        `INSERT INTO config_versions (config, notes, published_by)
         VALUES ($1, $2, $3) RETURNING id, published_at`,
        [next, notes ?? null, request.adminUser!.id]
      );
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: 'publish',
          entity: 'config_version',
          entityId: String(inserted.rows[0]!.id),
          detail: { notes: notes ?? null, changeCount: summary.changes.length },
        },
        client
      );
      await client.query('COMMIT');

      return reply.status(201).send({
        success: true,
        data: {
          version: inserted.rows[0]!.id,
          publishedAt: inserted.rows[0]!.published_at,
          changes: summary.changes,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};
