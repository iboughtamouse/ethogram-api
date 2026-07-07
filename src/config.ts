import 'dotenv/config';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgres://test:test@localhost:5432/test'),
  RESEND_API_KEY: isTest ? z.string().default('test_key') : z.string().min(1),
  EMAIL_FROM: z.string().email().default('test@test.com'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  // Admin dashboard (Phase 3): base URL magic links point at. Required in
  // production (like RESEND_API_KEY) so a missing value fails boot loudly
  // instead of silently emailing dead http://localhost links to admins.
  ADMIN_APP_URL: isTest ? z.string().url().default('http://localhost:5174') : z.string().url(),
  // Session cookie SameSite policy — 'lax' once admin.<domain>/api.<domain>
  // share a registrable domain, 'none' for the documented cross-site fallback
  // (vercel.app admin + railway.app api). 'none' forces Secure.
  ADMIN_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const adminAppUrl = parsed.data.ADMIN_APP_URL.replace(/\/$/, '');

// The admin origin must be a CORS-allowed origin (design §1). Merge it in
// automatically and dedupe so a fresh clone / new deploy can't forget it.
const allowedOrigins = [
  ...new Set([...parsed.data.ALLOWED_ORIGINS.split(','), adminAppUrl]),
];

export const config = {
  port: parseInt(parsed.data.PORT, 10),
  host: parsed.data.HOST,
  databaseUrl: parsed.data.DATABASE_URL,
  resendApiKey: parsed.data.RESEND_API_KEY,
  emailFrom: parsed.data.EMAIL_FROM,
  allowedOrigins,
  adminAppUrl,
  adminCookieSameSite: parsed.data.ADMIN_COOKIE_SAMESITE,
  adminCookieSecure:
    parsed.data.ADMIN_COOKIE_SAMESITE === 'none' || process.env.NODE_ENV === 'production',
} as const;
