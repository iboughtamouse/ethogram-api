import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: isTest ? z.string().default('postgres://test:test@localhost:5432/test') : z.string().url(),
  RESEND_API_KEY: isTest ? z.string().default('test_key') : z.string().min(1),
  EMAIL_FROM: isTest ? z.string().default('test@test.com') : z.string().email(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parseInt(parsed.data.PORT, 10),
  host: parsed.data.HOST,
  databaseUrl: parsed.data.DATABASE_URL,
  resendApiKey: parsed.data.RESEND_API_KEY,
  emailFrom: parsed.data.EMAIL_FROM,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(','),
} as const;
