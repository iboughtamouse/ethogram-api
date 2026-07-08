/**
 * Perch-diagram upload URLs (Phase 3D, P3-D4). The endpoint validates the
 * request, picks the next versioned object key (never reusing a URL that any
 * published config version froze into history), and returns a short-lived
 * presigned PUT — the browser then uploads the image bytes straight to R2.
 *
 * Registered inside admin.ts's session-guarded scope. When the R2_* env group
 * is absent the endpoint degrades to a clear 503 instead of the API failing
 * at boot (see config.ts).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { recordAudit } from '../services/audit.js';
import {
  UPLOAD_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  nextDiagramKey,
  presignDiagramUpload,
  slugifyLabel,
} from '../services/r2.js';

const uploadSchema = z.object({
  aviary: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(100),
  label: z.string().trim().min(1).max(100),
  contentType: z.string(),
});

export const adminUploadsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads/perch-diagram', async (request, reply) => {
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'An upload needs an aviary slug, a diagram label, and a content type',
      });
    }
    const { aviary: slug, label, contentType } = parsed.data;

    const extension = UPLOAD_CONTENT_TYPES[contentType];
    if (!extension) {
      return reply.status(400).send({
        success: false,
        error: `Diagrams must be WebP, PNG, or JPEG images (got "${contentType}")`,
      });
    }

    if (!config.r2) {
      return reply.status(503).send({
        success: false,
        error:
          'Uploads are not configured on this server — the R2 credentials are missing. See the staff runbook.',
      });
    }

    if (!slugifyLabel(label)) {
      return reply
        .status(400)
        .send({ success: false, error: 'The label needs at least one letter or digit' });
    }

    const aviary = await query<{ id: string; slug: string }>(
      `SELECT id, slug FROM aviaries WHERE slug = $1`,
      [slug]
    );
    if (!aviary.rows[0]) {
      return reply.status(404).send({ success: false, error: 'Unknown aviary' });
    }

    // A URL is taken if a current draft row uses it OR any published version
    // froze it into history (frozen URLs must keep resolving forever, so a
    // re-upload of the same view gets the next version number instead)
    const isTaken = async (url: string): Promise<boolean> => {
      const current = await query(`SELECT 1 FROM aviary_perch_diagrams WHERE url = $1 LIMIT 1`, [
        url,
      ]);
      if (current.rows.length > 0) return true;
      const historical = await query(
        `SELECT 1 FROM config_versions WHERE config::text LIKE $1 LIMIT 1`,
        [`%${url}%`]
      );
      return historical.rows.length > 0;
    };

    const { key, publicUrl } = await nextDiagramKey(aviary.rows[0].slug, label, extension, isTaken);
    const uploadUrl = await presignDiagramUpload(key, contentType);

    await recordAudit({
      adminUserId: request.adminUser!.id,
      action: 'mint_upload_url',
      entity: 'perch_diagram',
      entityId: `${aviary.rows[0].slug}/${key}`,
      detail: { label, contentType },
    });

    return reply.status(201).send({
      success: true,
      data: {
        uploadUrl,
        publicUrl,
        key,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        maxBytes: UPLOAD_MAX_BYTES,
      },
    });
  });
};
