# CLAUDE.md - AI-Human Working Agreement

> This document governs how AI assistants work on this codebase.
> The goal: AI-driven development that produces code a human can actually review.

## Philosophy

This project is **AI-driven, human-assisted**. AI writes all code; humans review, provide feedback, and approve.

**Collaboration over completion.** It's better to check in early than to finish something wrong. Iteration is expected, not a sign of failure. When uncertain, ask.

## Ground Rules

### Scope
- **One logical change per session** — a feature, a fix, a refactor. Not all three.
- **Keep changes reviewable** — target ~200 lines or less as a guideline.
- Scaffolding or boilerplate may exceed this; if so, provide a summary the human can use to review efficiently.
- If a task feels large, **propose a breakdown first** and get approval.

### Verification
- **Run tests before committing.** If tests require infrastructure you don't have, say so and stop.
- **Never commit code you haven't seen run.**

### Communication
- After completing work, **summarize what was done** and wait for feedback.
- If requirements are unclear, **ask before implementing.**
- If multiple approaches exist, **present options** rather than picking silently.
- If stuck, **say so** — with context on what you tried.

### Code Style
- **Readable over clever.** Optimize for human review.
- **Explicit over implicit.** No magic.
- **Comments explain "why"**, not "what".

### Development Approach
- **Describe before building.** Before writing code, describe what it should do in plain English. Wait for approval.
- **Tests accompany code.** Every feature includes tests. Tests are required before committing, not before coding.
- **Tests verify requirements, not implementation.** Write tests that catch unmet requirements, not tests that mirror code structure.

## Git Workflow

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

**Types:**
- `feat` — adds or removes a feature
- `fix` — fixes a bug
- `refactor` — restructures code without changing behavior
- `test` — adds or corrects tests
- `docs` — documentation only
- `build` — build system, dependencies, CI/CD
- `chore` — miscellaneous (last resort)

**Rules:**
- Use imperative mood: "add" not "added" or "adds"
- Don't capitalize the first letter
- No period at the end
- Keep the first line under 72 characters

**Examples:**
```
feat: add share endpoint for emailing observations
fix: handle PostgreSQL Date objects in fetch
test: add coverage for empty email array
docs: update API spec with new endpoints
refactor: extract sanitizeFilename to utils
```

### Pull Requests
- **Small PRs** — One feature or fix per PR
- **Copilot review** — Request review, triage feedback (valid vs noise), address valid points
- **Separate commits for review feedback** — Don't amend; add new commits addressing feedback
- **Squash at merge** — Keep main history clean
- **No amending after push** — Once pushed, commits are immutable (preserves review context)

### Review Triage
Not all automated review comments are worth addressing. Valid feedback includes:
- Missing test coverage
- Actual bugs or edge cases
- Security concerns

Noise to skip (with justification):
- Style preferences already covered by existing patterns
- Suggestions that add complexity without clear benefit
- Comments on intentional design decisions (document why and move on)

## Testing

- **Tests live next to source** — `foo.ts` → `foo.test.ts`
- **Mock external services** — Don't hit real APIs in tests
- **Clean test output** — Logger disabled in test mode (`NODE_ENV=test`)
- **Integration tests use real DB** — Test database, cleaned between runs

## Project Context

| Resource | Location |
|----------|----------|
| API Specification | `docs/api-specification.md` |
| Database Schema | `docs/database-schema.md` |
| Production API | `https://api-production-24be.up.railway.app` |
| Stack | Node.js, TypeScript, Fastify, PostgreSQL (raw SQL), Zod, Vitest |
| Hosting | Railway (API + PostgreSQL) |
| Email | Resend |

## Project Structure

```
src/
  app.ts           — Fastify app builder
  server.ts        — Entry point
  config.ts        — Environment config (Zod validation)
  db/              — Database connection pool and query helper
  routes/          — Route handlers (one file per resource)
  services/        — Business logic (email, excel generation)
  utils/           — Shared utilities (rate limiting, sanitization)
```

## Session Log

See `notes/session-log.md` for detailed history (gitignored, local only).
