import { z } from 'zod';

/**
 * A calendar-valid YYYY-MM-DD zod schema. Shape AND validity: '2026-02-30'
 * passes the regex but must be rejected before it reaches Postgres and 500s.
 * Date.parse alone is NOT enough — V8 rolls out-of-range days over
 * (Feb 30 → Mar 2) — so round-trip the parsed date back to a string.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(value); // date-only ISO strings parse as UTC midnight
    return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
  });
