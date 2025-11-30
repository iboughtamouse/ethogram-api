import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { observationsRoutes } from './routes/observations.js';

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // CORS
  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(observationsRoutes, { prefix: '/api/observations' });

  return app;
}
