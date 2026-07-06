# API Specification — Ethogram API

> **Scope:** the endpoints that actually exist today. The **authoritative contract** is the
> Zod schema in [`src/routes/observations.ts`](../src/routes/observations.ts) — this doc
> describes and points at it rather than duplicating it (schemas here would drift). For
> unbuilt/future endpoints see [Roadmap](#roadmap-not-yet-built) at the bottom.

## Stack

- **Runtime/framework:** Node.js + TypeScript, [Fastify 5](https://fastify.dev/)
- **Database:** PostgreSQL (raw parameterized SQL via `pg`, no ORM) — see [`database-schema.md`](database-schema.md)
- **Excel:** [ExcelJS](https://github.com/exceljs/exceljs) — see [`src/services/excel.ts`](../src/services/excel.ts)
- **Email:** [Resend](https://resend.com/) — see [`src/services/email.ts`](../src/services/email.ts)
- **Hosting:** Railway (API + PostgreSQL); auto-runs `npm run db:migrate` on deploy (`railway.json`)

## Conventions

- All requests/responses are JSON (except the Excel download, which returns a binary `.xlsx`).
- CORS origins come from `ALLOWED_ORIGINS` (`src/config.ts`); methods GET/POST/PUT/DELETE.
- **Response envelope:**
  - Success: `{ "success": true, ...payload }`
  - Error: `{ "success": false, "error": { "code": "...", "message": "...", "details?": [...] } }`
- Observation routes are registered under the `/api/observations` prefix (`src/app.ts`).

## Endpoints (4)

### `GET /api/health`
Liveness check. → `200 { success: true, data: { status: "ok", timestamp } }`.
Source: [`src/routes/health.ts`](../src/routes/health.ts).

### `POST /api/observations/submit`
Store one observation session; if `emails` are provided, generate an Excel and email it
(best-effort — email failures do **not** fail the request).

- **Body:** `submitObservationSchema` — `{ observation: { metadata, observations, submittedAt }, emails? }`.
  See [`observations.ts`](../src/routes/observations.ts) for the exact shape; highlights:
  - `metadata`: `observerName` (2–32 chars), `date` (`YYYY-MM-DD`, strict — a real calendar date, `2024-01-01`..tomorrow), `startTime`/`endTime` (`HH:MM`, `endTime > startTime`), `aviary` (display name **or** slug — the server resolves either to the display name for storage/rendering; an *unknown* value passes through as sent, warn-only), `patient` (1–255 chars, **optional** since Phase 2 stage 2A; still required when any slot uses the flat shape), `mode` (`"live" | "vod"`). The combination `date` + `startTime` must not be in the future.
  - `observations`: object keyed by `HH:MM` → per slot, **either** a non-empty array of per-subject objects (`subjectType` (`foster_parent|baby|juvenile`), `subjectId` (the subject name), plus the field set below) **or** the legacy flat single-subject object (`behavior`, `location`, `notes`, and optional `object`/`animal` + `objectInteractionType`/`animalInteractionType` (+`*Other`), `description`). Flat slots are wrapped server-side via `normalizeTimeSlots()` using `metadata.patient`; the flat branch is removed in Phase 2 stage 2D. Subject-residency and aviary mismatches are **warn-only** (P2-D5) — a submission is never rejected for them.
  - `submittedAt`: ISO 8601 datetime. `emails`: up to 10 addresses.
- **Responses:** `201 { success: true, submissionId, message, emailsSent }` · `400 VALIDATION_ERROR` (with `details: [{ field, message }]`) · `500 DATABASE_ERROR`.

### `POST /api/observations/:id/share`
Email the stored observation's Excel to 1–10 recipients. **Rate-limited to 3 requests per
observation per hour** (in-memory; see [Rate limiting](#rate-limiting)).

- **Body:** `{ emails: string[] }` (min 1, max 10, valid emails).
- **Responses:** `200 { success: true, message, emailsSent }` · `400 VALIDATION_ERROR` · `404 NOT_FOUND` · `429 RATE_LIMIT_EXCEEDED` · `500 EMAIL_ERROR` (all recipients failed) / `SERVER_ERROR`.

### `GET /api/observations/:id/excel`
Download the stored observation as an Excel file.

- **Responses:** `200` binary `.xlsx` (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="ethogram_<date>_<observer>.xlsx"`) · `404 NOT_FOUND` · `500 SERVER_ERROR`.
- The workbook has **one worksheet per subject** (named after the subject, sanitized/truncated to Excel's 31-char rules), each the same behaviors-as-rows × 5-minute-time-slots-as-columns matrix with a `Subject(s): <name>` header — see [`excel.ts`](../src/services/excel.ts). Rows = the aviary's enabled behaviors plus any behavior present in the data.

## Error codes

`VALIDATION_ERROR` (400) · `NOT_FOUND` (404) · `RATE_LIMIT_EXCEEDED` (429) ·
`DATABASE_ERROR` / `EMAIL_ERROR` / `SERVER_ERROR` (500). Validation errors additionally carry
`details: [{ field, message }]`.

## Rate limiting

Only `POST /:id/share` is rate-limited: 3 requests per observation id per hour, via a simple
in-memory sliding window ([`src/utils/rateLimit.ts`](../src/utils/rateLimit.ts)). **Caveat:**
it is per-process and resets on restart — it is not shared across multiple Railway instances.

## Roadmap (not yet built)

None of the following exist in the code today. They are recorded here so intent isn't lost;
some have example SQL in [`database-schema.md`](database-schema.md).

- **Query/read endpoints:** `GET /api/observations` (list) and `GET /api/observations/:id` (single, as JSON).
- **Dashboard/analytics:** behavior frequency, location heatmap, time-of-day patterns, enrichment engagement, aggression rate, foster-parent presence, leaderboard.
- **Authentication:** users table + `user_id` FK (the column exists but is always null today), tokens/roles.
- **Idempotency keys**, IP-based rate limiting, and `X-RateLimit-*` / `Retry-After` headers.
- **Multi-subject (in progress — Phase 2):** the array slot shape is accepted since stage 2A; the flat branch and `metadata.patient` are removed at stage 2D — see [`config-as-data-phase2-design.md`](../../ethogram-notes/01-ACTIVE/config-as-data-phase2-design.md).
