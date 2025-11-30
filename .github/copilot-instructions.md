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

## Patterns

### Routes
- Each route file exports a Fastify plugin function
- Validate request bodies with Zod schemas
- Use `query()` from `src/db` for database access

### Services
- Pure functions, no Fastify dependencies
- Mock in tests to avoid external API calls

### Testing
- Tests live next to source files (`*.test.ts`)
- Use Vitest's `vi.mock()` for external services
- Clean up test data in `beforeEach`

### Error Handling
- Return `{ success: false, error: "message" }` for errors
- Use appropriate HTTP status codes (400, 404, 429, 500)

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

- **No amending after push** — add new commits for fixes
- **Squash and merge** PRs to keep main clean
