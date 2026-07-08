import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { observationsRoutes } from './routes/observations.js';
import { configRoutes } from './routes/config.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Railway terminates TLS at a single proxy hop; trusting exactly one hop
    // makes request.ip the real client for the admin rate limits. Trusting
    // more would let clients spoof X-Forwarded-For.
    trustProxy: 1,
  });

  // CORS — credentials:true lets the admin session cookie ride API requests;
  // it only applies to the explicit ALLOWED_ORIGINS list (never a wildcard)
  await app.register(cors, {
    origin: config.allowedOrigins,
    // PATCH: the 3C editing endpoints are the API's first PATCH routes —
    // without it here, every browser preflight for them is refused
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  await app.register(cookie);

  // Routes
  await app.register(healthRoutes);
  await app.register(observationsRoutes, { prefix: '/api/observations' });
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}
