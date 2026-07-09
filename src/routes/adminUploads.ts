/**
 * Perch-diagram upload URLs (Phase 3D, P3-D4). The endpoint validates the
 * request, reserves the next versioned object key, and returns a short-lived
 * presigned PUT — the browser then uploads the image bytes straight to R2.
 *
 * Registered inside admin.ts's session-guarded scope. When the R2_* env group
 * is absent/invalid the endpoint degrades to a clear 503 instead of the API
 * failing at boot (see config.ts).
 *
 * The never-overwrite invariant (a URL frozen into a published config version
 * must always resolve to the same bytes) is protected in three layers:
 *   1. the version scan skips any key already in a draft row, in published
 *      history, OR previously minted here (the reservation);
 *   2. per-aviary advisory lock serializes the check-then-reserve so two
 *      overlapping mints can't both pass the check and grab the same key;
 *   3. the presigned PUT carries If-None-Match:* (r2.ts), so even a replayed
 *      URL cannot overwrite an existing object at the storage layer.
 */

import type { FastifyPluginAsync } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "../db/index.js";
import { config } from "../config.js";
import { recordAudit } from "../services/audit.js";
import {
  UPLOAD_CONTENT_TYPES,
  UPLOAD_CONTENT_TYPE_VALUES,
  UPLOAD_MAX_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  nextDiagramKey,
  presignDiagramUpload,
  slugifyLabel,
} from "../services/r2.js";

const uploadSchema = z.object({
  aviary: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(100),
  // Same cap as the diagram replace-set (labelSchema, 255) so a label saved
  // there can always be re-minted; z.enum bounds contentType to the exact
  // allowed types (a plain string would let inherited object keys through)
  label: z.string().trim().min(1).max(255),
  contentType: z.enum(UPLOAD_CONTENT_TYPE_VALUES),
});

export const adminUploadsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/uploads/perch-diagram", async (request, reply) => {
    const parsed = uploadSchema.safeParse(request.body);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some(
        (i) => i.path[0] === "label" && i.code === "too_big",
      );
      return reply.status(400).send({
        success: false,
        error: tooLong
          ? "The diagram label is too long (max 255 characters)"
          : "An upload needs an aviary slug, a diagram label, and an image content type (WebP, PNG, or JPEG)",
      });
    }
    const { aviary: slug, label, contentType } = parsed.data;
    const extension = UPLOAD_CONTENT_TYPES[contentType]!;

    if (!config.r2) {
      return reply.status(503).send({
        success: false,
        error:
          "Uploads are not configured on this server — the R2 credentials are missing. See the staff runbook.",
      });
    }

    if (!slugifyLabel(label)) {
      return reply
        .status(400)
        .send({
          success: false,
          error: "The label needs at least one letter or digit",
        });
    }

    // A candidate key is taken if it appears in a current draft row, was frozen
    // into any published version, or was already minted here (reservation). All
    // three checks run inside one advisory-locked transaction so a concurrent
    // mint for the same aviary+label can't slip past to the same key.
    const isTaken =
      (client: PoolClient) =>
      async ({ key, url }: { key: string; url: string }): Promise<boolean> => {
        const draft = await client.query(
          `SELECT 1 FROM aviary_perch_diagrams WHERE url = $1 LIMIT 1`,
          [url],
        );
        if (draft.rows.length > 0) return true;
        const published = await client.query(
          `SELECT 1 FROM config_versions
         WHERE config @> $1::jsonb LIMIT 1`,
          [JSON.stringify({ aviaries: [{ perchDiagrams: [{ url }] }] })],
        );
        if (published.rows.length > 0) return true;
        const reserved = await client.query(
          `SELECT 1 FROM audit_log
         WHERE action = 'mint_upload_url' AND entity = 'perch_diagram' AND entity_id = $1 LIMIT 1`,
          [`${slug}/${key}`],
        );
        return reserved.rows.length > 0;
      };

    let picked: { key: string; publicUrl: string } | "unknown-aviary";
    try {
      picked = await withTransaction(async (client) => {
        const aviary = await client.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM aviaries WHERE slug = $1`,
          [slug],
        );
        if (!aviary.rows[0]) return "unknown-aviary" as const;

        // Serialize per aviary: the check-then-reserve below must be atomic
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `diagram-upload:${slug}`,
        ]);

        const chosen = await nextDiagramKey(
          aviary.rows[0].slug,
          label,
          extension,
          isTaken(client),
        );

        // The audit row IS the reservation — recorded before we hand out the
        // URL, so a later mint for the same label skips this version
        await recordAudit(
          {
            adminUserId: request.adminUser!.id,
            action: "mint_upload_url",
            entity: "perch_diagram",
            entityId: `${aviary.rows[0].slug}/${chosen.key}`,
            detail: { label, contentType },
          },
          client,
        );
        return chosen;
      });
    } catch {
      return reply
        .status(500)
        .send({
          success: false,
          error: "Could not reserve an upload — please try again",
        });
    }

    if (picked === "unknown-aviary") {
      return reply
        .status(404)
        .send({ success: false, error: "Unknown aviary" });
    }

    const uploadUrl = await presignDiagramUpload(picked.key, contentType);

    return reply.status(201).send({
      success: true,
      data: {
        uploadUrl,
        publicUrl: picked.publicUrl,
        key: picked.key,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        maxBytes: UPLOAD_MAX_BYTES,
      },
    });
  });
};
