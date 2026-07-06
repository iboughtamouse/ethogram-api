import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { observationsRoutes } from './routes/observations.js';
import { configRoutes } from './routes/config.js';

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // CORS
  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(observationsRoutes, { prefix: '/api/observations' });
  await app.register(configRoutes, { prefix: '/api/config' });

  return app;
}
