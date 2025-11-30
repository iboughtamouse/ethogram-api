/**
 * Simple in-memory rate limiter.
 *
 * Limits requests per key (e.g., observation ID) within a time window.
 * For production at scale, consider Redis-based rate limiting.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries every 10 minutes
// .unref() prevents this timer from keeping Node.js alive during shutdown
const CLEANUP_INTERVAL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > CLEANUP_INTERVAL) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL).unref();

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param key - Unique identifier for the rate limit (e.g., "share:uuid")
 * @param options - Rate limit configuration
 * @returns Whether the request is allowed and remaining quota
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // No existing entry or window expired - start fresh
  if (!entry || now - entry.windowStart >= options.windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetAt: now + options.windowMs,
    };
  }

  // Window still active - check count
  if (entry.count >= options.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + options.windowMs,
    };
  }

  // Increment count
  entry.count++;
  return {
    allowed: true,
    remaining: options.maxRequests - entry.count,
    resetAt: entry.windowStart + options.windowMs,
  };
}

/**
 * Reset rate limit for a key (useful for testing).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Clear all rate limits (useful for testing).
 */
export function clearAllRateLimits(): void {
  store.clear();
}
