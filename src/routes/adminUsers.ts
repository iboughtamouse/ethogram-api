/**
 * Admin allowlist management (Phase 3 stage 3E): list the allowlist, add an
 * admin, and deactivate/reactivate one — so staff onboarding no longer needs a
 * direct database write. Registered inside admin.ts's session-guarded scope, so
 * every caller is already an authenticated active admin. Flat trust model: any
 * active admin may manage the allowlist (there are no roles).
 *
 * Removal is a soft delete (is_active = false), never a row delete: audit_log
 * rows reference admin_users(id), and the whole system retires rather than
 * removes. The session guard's `AND u.is_active` join already locks a
 * deactivated admin out on their next request; we also drop their sessions for
 * immediate, explicit revocation. All allowlist mutations serialize on one
 * advisory lock so the "last active admin" guard can't be raced below one.
 */

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, withTransaction } from "../db/index.js";
import { recordAudit } from "../services/audit.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A permissive "looks like an email" shape. Unlike the public request-link
// boundary (which deliberately avoids format checks so it can't be used to
// probe address validity), this endpoint is trusted staff inviting a colleague
// — catching a typo here is a feature, because a wrong address never matches at
// sign-in and would fail silently.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ success: false, error });
}

/**
 * Build a response to send AFTER the transaction commits. A string body is an
 * error envelope; an object body is a success envelope. Handlers return this
 * from inside withTransaction instead of calling reply.send() there — sending
 * inside the callback flushes the response before COMMIT, letting a caller's
 * immediate follow-up read race the write.
 */
function sent(status: number, body: string | Record<string, unknown>) {
  return {
    status,
    body:
      typeof body === "string"
        ? { success: false, error: body }
        : { success: true, data: body },
  };
}

/** Serialize every allowlist mutation so the last-active-admin guard is safe. */
async function lockAllowlist(client: PoolClient): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('ethogram-admin-users'))`,
  );
}

export const adminUsersRoutes: FastifyPluginAsync = async (app) => {
  // Active first, then by name — the management list reads top-to-bottom as
  // "current staff, then removed"
  app.get("/admin-users", async (_request, reply) => {
    const result = await query(
      `SELECT id, email, display_name AS "displayName",
              is_active AS "isActive", created_at AS "createdAt"
       FROM admin_users
       ORDER BY is_active DESC, lower(display_name), email`,
    );
    return reply
      .status(200)
      .send({ success: true, data: { admins: result.rows } });
  });

  app.post("/admin-users", async (request, reply) => {
    const parsed = z
      .object({
        email: z.string().min(3).max(255),
        displayName: z.string().trim().min(1).max(255),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, "A new admin needs an email and a display name");
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { displayName } = parsed.data;
    if (!EMAIL_SHAPE.test(email)) {
      return fail(
        reply,
        400,
        "That doesn't look like an email address — check for typos",
      );
    }

    // Compute inside the transaction, send AFTER it commits — reply.send() run
    // inside the callback would flush the response before COMMIT, so a caller's
    // immediately-following read could race the write (matches adminWrite.ts).
    const result = await withTransaction(async (client) => {
      await lockAllowlist(client);
      const existing = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM admin_users WHERE email = $1`,
        [email],
      );
      if (existing.rows[0]) {
        return sent(
          409,
          existing.rows[0].is_active
            ? "That email is already an admin"
            : "That email was removed earlier — use Reactivate to restore access",
        );
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO admin_users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [email, displayName],
      );
      const id = inserted.rows[0]!.id;
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: "add:admin_user",
          entity: "admin_user",
          entityId: id,
          detail: { email, displayName },
        },
        client,
      );
      return sent(201, { id, email, displayName, isActive: true });
    });
    return reply.status(result.status).send(result.body);
  });

  app.patch("/admin-users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_PATTERN.test(id)) {
      return fail(reply, 404, "No such admin");
    }
    const parsed = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, "Set isActive to true or false");
    }
    const { isActive } = parsed.data;

    // Compute inside the transaction, send after commit (see POST above).
    const result = await withTransaction(async (client) => {
      await lockAllowlist(client);
      const target = await client.query<{
        email: string;
        displayName: string;
        isActive: boolean;
      }>(
        `SELECT email, display_name AS "displayName", is_active AS "isActive"
         FROM admin_users WHERE id = $1`,
        [id],
      );
      const row = target.rows[0];
      if (!row) {
        return sent(404, "No such admin");
      }

      const settled = {
        id,
        email: row.email,
        displayName: row.displayName,
        isActive,
      };

      // Already in the requested state — return it, don't write an audit row
      if (row.isActive === isActive) {
        return sent(200, settled);
      }

      // Guards apply only to a real active → inactive transition.
      if (!isActive) {
        // Friendly fast path for the common lockout attempt: you're using the
        // dashboard right now, so removing yourself is almost always a mistake.
        if (id === request.adminUser!.id) {
          return sent(
            400,
            "You can't remove your own access — ask another admin to do it",
          );
        }
        // The true "never empty" invariant. The self-guard already covers the
        // ordinary case (the actor is an active admin and stays active), so
        // this only bites the race where the actor was deactivated by someone
        // else after their session passed the preHandler but before this ran —
        // serialized by lockAllowlist so two such deactivations can't both win.
        const active = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM admin_users WHERE is_active`,
        );
        if ((active.rows[0]?.n ?? 0) <= 1) {
          return sent(400, "At least one admin must stay active");
        }
      }

      await client.query(
        `UPDATE admin_users SET is_active = $2 WHERE id = $1`,
        [id, isActive],
      );
      if (!isActive) {
        // Immediate revocation; the is_active join would block them next
        // request anyway, but this frees the session rows now
        await client.query(
          `DELETE FROM admin_sessions WHERE admin_user_id = $1`,
          [id],
        );
      }
      await recordAudit(
        {
          adminUserId: request.adminUser!.id,
          action: isActive ? "reactivate:admin_user" : "deactivate:admin_user",
          entity: "admin_user",
          entityId: id,
          detail: { email: row.email },
        },
        client,
      );
      return sent(200, settled);
    });
    return reply.status(result.status).send(result.body);
  });
};
