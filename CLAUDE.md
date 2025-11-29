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

## Project Context

| Resource | Location |
|----------|----------|
| API Specification | `docs/api-specification.md` |
| Database Schema | `docs/database-schema.md` |
| Stack | Node.js, TypeScript, Fastify, PostgreSQL (raw SQL), Zod, Vitest |

## Session Log

_Updated at the end of each session._

**Last session (Nov 29):** Reset project, established working agreement, scaffolded Fastify + TypeScript project with health endpoint and tests.

**Next:** Database connection, POST /api/observations endpoint.
