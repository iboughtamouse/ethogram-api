/**
 * Audit log (P3-D5): every admin mutation writes one attributed row.
 * Cheap, append-only, and answers "who changed what" for rotating staff.
 */

import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/index.js';

export interface AuditEntry {
  adminUserId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: unknown;
}

/**
 * Pass `client` to make the audit row part of an open transaction (e.g. the
 * publish transaction) so the mutation and its audit record commit together.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: Pool | PoolClient = pool
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (admin_user_id, action, entity, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.adminUserId,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
    ]
  );
}
