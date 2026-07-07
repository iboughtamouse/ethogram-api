-- Migration: 007_admin_auth.sql
-- Description: Phase 3 stage 3A — admin auth foundation: allowlist, magic-link
--              tokens, server-side sessions, and durable auth-event counters
--              (DB-backed rate limiting; the in-memory limiter resets on redeploy).
--              Design: ethogram-notes/01-ACTIVE/config-as-data-phase3-design.md §2
-- Date: 2026-07-07

-- =============================================================================
-- ADMIN USERS (allowlist — no self-signup; rows added by migration/dashboard)
-- =============================================================================

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The app normalizes emails to lowercase before lookup; enforce it at rest
  CONSTRAINT admin_users_email_lowercase CHECK (email = LOWER(email))
);

-- Keep updated_at fresh on write, matching the convention from 001/002
-- (update_updated_at_column() is defined in 001_initial_schema.sql)
CREATE TRIGGER admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- MAGIC-LINK TOKENS (single-use, 15-minute expiry; only the SHA-256 hash is
-- stored — a DB leak must not yield redeemable links)
-- =============================================================================

CREATE TABLE admin_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  token_hash CHAR(64) UNIQUE NOT NULL,
  -- Stored verbatim from Fastify's request.ip (a proxy-derived string); TEXT,
  -- not INET, because that value can be a non-address token ('unknown', an
  -- ip:port pair) that a strict INET cast would reject at write time
  request_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX admin_login_tokens_expires_idx ON admin_login_tokens (expires_at);

-- =============================================================================
-- SESSIONS (cookie value is a random token; hash stored, sliding ~30-day expiry)
-- =============================================================================

CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  token_hash CHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

-- =============================================================================
-- AUTH EVENTS (durable counters for rate limiting: request-link caps per email
-- and per IP, and a verify-failure lockout per IP; rows expire after 24h via
-- opportunistic delete in the request-link handler)
-- =============================================================================

CREATE TABLE admin_auth_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind VARCHAR(30) NOT NULL,
  email VARCHAR(255),
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_auth_events_email_idx ON admin_auth_events (kind, email, created_at);
CREATE INDEX admin_auth_events_ip_idx ON admin_auth_events (kind, ip, created_at);

-- =============================================================================
-- SEED: the owner is the initial allowlist (§9 answer 1); dashboard-managed
-- allowlist administration arrives in stage 3E
-- =============================================================================

INSERT INTO admin_users (email, display_name)
VALUES ('iboughtamouse@gmail.com', 'iboughtamouse')
ON CONFLICT (email) DO NOTHING;
