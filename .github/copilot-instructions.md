# Copilot Instructions — ethogram-api

## Quick Orientation

This is a Node.js/TypeScript REST API for storing and retrieving ethogram observations.

**Start here:**
- `CLAUDE.md` — AI-human working agreement, project philosophy, ground rules
- `docs/api-specification.md` — API endpoints and response formats
- `docs/database-schema.md` — PostgreSQL table definitions

**Stack:** Fastify, TypeScript, PostgreSQL (raw SQL via `pg`), Zod, Vitest

## Project Structure

```
src/
  app.ts        — Fastify app builder
  server.ts     — Entry point
  config.ts     — Environment config with Zod validation
  db/           — Database connection pool and query helper
  routes/       — Route handlers (one file per resource)
```

## Patterns

_This section will grow as the codebase develops. For now, follow the patterns established in existing files._

- Route handlers go in `src/routes/`, one file per resource
- Tests live next to source files (`*.test.ts`)
- Use `query()` from `src/db` for database access
- Validate request bodies with Zod schemas
