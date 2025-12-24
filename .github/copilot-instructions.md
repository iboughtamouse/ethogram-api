# Copilot Instructions — ethogram-api

## Quick Orientation

This is a Node.js/TypeScript REST API for storing and retrieving ethogram observations.

**Start here:**
- `CLAUDE.md` — AI-human working agreement, project philosophy, ground rules
- `docs/api-specification.md` — API endpoints and response formats
- `docs/database-schema.md` — PostgreSQL table definitions

**Stack:** Fastify, TypeScript, PostgreSQL (raw SQL via `pg`), Zod, Vitest, Resend, ExcelJS

## Project Structure

See `CLAUDE.md` for full structure. Key directories:

- `src/routes/` — Route handlers (one file per resource)
- `src/services/` — Business logic (email, excel)
- `src/utils/` — Shared utilities (rate limiting, sanitization)
- `src/db/` — Database connection and query helper

## Key Patterns

### Data Transformation (Multi-Subject)

**Important:** Database uses array structure to support future multi-subject observations, even though current frontend sends flat objects for single-subject (Sayyida).

**Frontend sends (current implementation):**
```typescript
{
  "14:00": {
    behavior: "resting_alert",
    location: "12",
    notes: "Alert"
  }
}
```

**Backend stores (array format for future expansion):**
```typescript
{
  "14:00": [{
    subjectType: "foster_parent",
    subjectId: "Sayyida",
    behavior: "resting_alert",
    location: "12",
    notes: "Alert"
  }]
}
```

**Transform in `routes/observations.ts`:**
```typescript
// Wrap flat observation in array with subject metadata
Object.entries(observations).reduce((acc, [time, obs]) => {
  acc[time] = [{
    subjectType: 'foster_parent',
    subjectId: metadata.patient, // "Sayyida" in Phase 2
    ...obs
  }];
  return acc;
}, {});
```

### Routes

- Each route file exports a Fastify plugin function
- Validate request bodies with Zod schemas
- Use `query()` from `src/db` for database access

**Example route pattern:**
```typescript
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';

const requestSchema = z.object({
  field: z.string().min(1),
});

const route: FastifyPluginAsync = async (fastify) => {
  fastify.post('/endpoint', async (request, reply) => {
    const validated = requestSchema.parse(request.body);
    const result = await query('SELECT * FROM table WHERE id = $1', [validated.field]);
    return { success: true, data: result.rows };
  });
};

export default route;
```

### Zod Validation Patterns

**Custom refinements for strict validation:**
```typescript
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (val) => isValidISODate(val), // Custom validator prevents Feb 30
    { message: 'Invalid date: month must be 01-12 and day must be valid' }
  );

const timeSchema = z.string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
  .refine((val) => {
    const [h, m] = val.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, { message: 'Invalid time: hours 00-23, minutes 00-59' });
```

### JSONB Queries

**Querying array elements in time_slots:**
```sql
-- Count behaviors for foster parent
SELECT
  subject->>'behavior' AS behavior,
  COUNT(*) AS count
FROM observations,
  jsonb_each(time_slots) AS ts(time_key, subjects),
  jsonb_array_elements(subjects) AS subject
WHERE subject->>'subjectType' = 'foster_parent'
  AND observation_date BETWEEN '2025-11-01' AND '2025-11-30'
GROUP BY subject->>'behavior';
```

**Check if foster parent present:**
```sql
SELECT id
FROM observations
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each(time_slots) AS ts(time_key, subjects)
  WHERE subjects @> '[{"subjectType": "foster_parent"}]'
);
```

### Services

- Pure functions, no Fastify dependencies
- Mock in tests to avoid external API calls

**Email service pattern:**
```typescript
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: config.emailFrom,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
```

### Excel Generation

**Update behavior labels when adding/changing behaviors:**

File: `src/services/excel.ts`

```typescript
const BEHAVIOR_ROW_MAPPING: Record<string, string> = {
  eating_food_platform: 'Eating - On Food Platform',
  eating_elsewhere: 'Eating - Elsewhere (Note Location)',
  // ... add new behaviors here
};
```

**Excel formatting (frozen panes, column widths):**
```typescript
worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
worksheet.getColumn('A').width = 35.0;
worksheet.getColumn('B').width = 8.0;
worksheet.getRow(1).font = { bold: true };
```

### Testing

- Tests live next to source files (`*.test.ts`)
- Use Vitest's `vi.mock()` for external services
- Clean up test data in `beforeEach`

**Mock pattern for external services:**
```typescript
import { vi } from 'vitest';
import * as emailService from '../services/email.js';

vi.mock('../services/email.js', () => ({
  sendObservationEmail: vi.fn().mockResolvedValue({
    success: true,
    messageId: 'test-id'
  }),
}));
```

**Database test cleanup:**
```typescript
beforeEach(async () => {
  await query('DELETE FROM observations WHERE id = $1', [testId]);
});
```

### Error Handling

- Return `{ success: false, error: "message" }` for errors
- Use appropriate HTTP status codes (400, 404, 429, 500)

**Error response pattern:**
```typescript
if (!result.rows[0]) {
  return reply.code(404).send({
    success: false,
    error: 'Observation not found'
  });
}
```

### Rate Limiting

**Pattern (share endpoint):**
```typescript
import { checkRateLimit } from '../utils/rateLimit.js';

const RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
};

// Before processing request
const rateLimitKey = `share:${observationId}`;
const allowed = await checkRateLimit(rateLimitKey, RATE_LIMIT);

if (!allowed) {
  return reply.code(429).send({
    success: false,
    error: 'Rate limit exceeded. Try again later.'
  });
}
```

## How to Make Common Changes

### Add a New Behavior

1. **Frontend first:** Update `wbs-ethogram-form/src/constants/behaviors.js`
2. **Backend Excel mapping:** Update `BEHAVIOR_ROW_MAPPING` in `src/services/excel.ts`
3. **No database changes needed** — JSONB stores any behavior value

### Add a New Endpoint

1. Create route file in `src/routes/yourroute.ts`
2. Define Zod schemas for validation
3. Export Fastify plugin
4. Register in `src/index.ts`: `await server.register(yourRoute, { prefix: '/api' })`
5. Add tests in `src/routes/yourroute.test.ts`

### Add Email Field Validation

Update Zod schema with sanitization:
```typescript
const emailSchema = z.string().email()
  .transform(email => email.toLowerCase().trim());
```

Add XSS prevention in email service:
```typescript
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m] ?? m);
}
```

## Git Workflow

See `CLAUDE.md` for full conventional commits guide. Quick reference:

```
<type>(<optional scope>): <description>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `chore`

**Rules:**
- Imperative mood ("add" not "added")
- No capital, no period
- Under 72 characters

**Important:**
- **No amending after push** — add new commits for fixes
- **Squash and merge** PRs to keep main clean

## Files to Check First

- `src/routes/observations.ts` — Main endpoint, data transformation
- `src/services/excel.ts` — Excel generation, BEHAVIOR_ROW_MAPPING
- `src/services/email.ts` — Email delivery
- `src/db/index.ts` — Database query helper
- `docs/database-schema.md` — JSONB structure, constraints

## Related Repositories

- **wbs-ethogram-form** — React frontend (sends observations)
- **ethogram-notes** — Project documentation and study feedback

When making changes that affect multiple repos (e.g., behavior consolidation), coordinate updates across all three.
