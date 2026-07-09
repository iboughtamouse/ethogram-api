import "dotenv/config";
import { z } from "zod";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;

const envSchema = z.object({
  PORT: z.string().default("3000"),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://test:test@localhost:5432/test"),
  RESEND_API_KEY: isTest ? z.string().default("test_key") : z.string().min(1),
  EMAIL_FROM: z.string().email().default("test@test.com"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  // Admin dashboard (Phase 3): base URL magic links point at. Required in
  // production (like RESEND_API_KEY) so a missing value fails boot loudly
  // instead of silently emailing dead http://localhost links to admins.
  ADMIN_APP_URL: isTest
    ? z.string().url().default("http://localhost:5174")
    : z.string().url(),
  // Session cookie SameSite policy — 'lax' once admin.<domain>/api.<domain>
  // share a registrable domain, 'none' for the documented cross-site fallback
  // (vercel.app admin + railway.app api). 'none' forces Secure.
  ADMIN_COOKIE_SAMESITE: z.enum(["lax", "none"]).default("lax"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const adminAppUrl = parsed.data.ADMIN_APP_URL.replace(/\/$/, "");

// The admin origin must be a CORS-allowed origin (design §1). Merge it in
// automatically and dedupe so a fresh clone / new deploy can't forget it.
const allowedOrigins = [
  ...new Set([...parsed.data.ALLOWED_ORIGINS.split(","), adminAppUrl]),
];

// R2 presigned uploads (Phase 3D). Validated OUTSIDE the fatal envSchema above:
// a missing/blank/malformed R2 group must degrade the upload endpoint to a
// clear 503, NEVER crash the whole API at boot (the 3A incident: a new
// required var set in only one Railway environment crash-looped the other).
// All five must be present and valid together, or uploads are disabled.
const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  // Must be a bare origin (or origin + path prefix) with no trailing slash —
  // diagram URLs are minted as `${base}/${key}`
  R2_PUBLIC_BASE_URL: z.string().url(),
});
// Treat empty strings as absent: a blank Railway variable or a `R2_BUCKET=`
// line is "unset", not "invalid" — otherwise it would look like a partial group
const blankToUndefined = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? undefined : value;
const r2Raw = {
  R2_ACCOUNT_ID: blankToUndefined(process.env.R2_ACCOUNT_ID),
  R2_ACCESS_KEY_ID: blankToUndefined(process.env.R2_ACCESS_KEY_ID),
  R2_SECRET_ACCESS_KEY: blankToUndefined(process.env.R2_SECRET_ACCESS_KEY),
  R2_BUCKET: blankToUndefined(process.env.R2_BUCKET),
  R2_PUBLIC_BASE_URL: blankToUndefined(process.env.R2_PUBLIC_BASE_URL),
};
const anyR2Set = Object.values(r2Raw).some((v) => v !== undefined);
const r2Parsed = r2Schema.safeParse(r2Raw);
const r2 = r2Parsed.success
  ? {
      accountId: r2Parsed.data.R2_ACCOUNT_ID,
      accessKeyId: r2Parsed.data.R2_ACCESS_KEY_ID,
      secretAccessKey: r2Parsed.data.R2_SECRET_ACCESS_KEY,
      bucket: r2Parsed.data.R2_BUCKET,
      // Strip ALL trailing slashes so a doubled-slash base ('…r2.dev//') can't
      // mint permanently-broken '…//perch-diagram-…' URLs into frozen history
      publicBaseUrl: r2Parsed.data.R2_PUBLIC_BASE_URL.replace(/\/+$/, ""),
    }
  : null;
if (!r2 && anyR2Set) {
  // Loud but non-fatal: someone set SOME R2 vars (typo'd name, blank value, or
  // malformed URL) — uploads 503 until it's fixed, the rest of the API boots
  console.warn(
    "⚠️  R2 upload configuration is incomplete or invalid — uploads disabled (503). " +
      "Set all five R2_* vars to valid values, or none.",
  );
}

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
    parsed.data.ADMIN_COOKIE_SAMESITE === "none" ||
    process.env.NODE_ENV === "production",
  r2,
} as const;
