import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { query } from '../db/index.js';

/**
 * Public read API for the config-as-data document (Phase 1 stage B).
 *
 * Serves published rows from config_versions verbatim — composition happens at
 * publish time (compose_config(), migration 002), never at request time. The
 * response envelope adds version/publishedAt from the row.
 */

interface ConfigVersionRow {
  id: number;
  published_at: string;
  config: Record<string, unknown>;
}

// Latest published version: short client cache, long stale-while-revalidate —
// config changes rarely and staleness is tolerated by design (append-only values).
const LATEST_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';

// A specific version is immutable forever once published.
const VERSION_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function etagFor(versionId: number): string {
  return `"${versionId}"`;
}

/** True when the request's If-None-Match matches this version's ETag. */
function etagMatches(ifNoneMatch: string | undefined, versionId: number): boolean {
  if (!ifNoneMatch) return false;
  const target = etagFor(versionId);
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .includes(target);
}

function sendConfig(
  reply: FastifyReply,
  row: ConfigVersionRow,
  cacheControl: string,
  notModified: boolean
) {
  reply.header('ETag', etagFor(row.id)).header('Cache-Control', cacheControl);

  if (notModified) {
    return reply.status(304).send();
  }

  return reply.status(200).send({
    version: row.id,
    publishedAt: row.published_at,
    ...row.config,
  });
}

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/config — the latest published config
  fastify.get('/', async (request, reply) => {
    const result = await query<ConfigVersionRow>(
      'SELECT id, published_at, config FROM config_versions ORDER BY id DESC LIMIT 1'
    );

    const row = result.rows[0];
    if (!row) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No published config version exists' },
      });
    }

    const notModified = etagMatches(request.headers['if-none-match'], row.id);
    return sendConfig(reply, row, LATEST_CACHE_CONTROL, notModified);
  });

  // GET /api/config/versions/:id — a specific published version (immutable)
  fastify.get<{ Params: { id: string } }>('/versions/:id', async (request, reply) => {
    const { id } = request.params;

    // config_versions.id is int4: values past 2147483647 would overflow the
    // parameterized query and surface as a Postgres error (500 + leaked pg
    // message) instead of this route's clean 404.
    if (!/^\d+$/.test(id) || Number(id) > 2147483647) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Config version not found' },
      });
    }

    const result = await query<ConfigVersionRow>(
      'SELECT id, published_at, config FROM config_versions WHERE id = $1',
      [Number(id)]
    );

    const row = result.rows[0];
    if (!row) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Config version not found' },
      });
    }

    const notModified = etagMatches(request.headers['if-none-match'], row.id);
    return sendConfig(reply, row, VERSION_CACHE_CONTROL, notModified);
  });
};
