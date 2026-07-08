/**
 * Token helpers for admin magic-link auth (Phase 3 §2).
 *
 * Tokens are 256-bit random values; only their SHA-256 hash is persisted, so a
 * database leak never yields a redeemable link or a usable session cookie.
 */

import { randomBytes, createHash } from 'crypto';

/** 256-bit random token, base64url (43 chars, URL/cookie safe). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — the only form ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
