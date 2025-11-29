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

## Project Context

| Resource | Location |
|----------|----------|
| API Specification | `docs/api-specification.md` |
| Database Schema | `docs/database-schema.md` |
| Stack | TBD — Node.js and PostgreSQL confirmed |

## Session Log

_Updated at the end of each session._

**Last session:** Discussed project reset, established working agreement (this document).

**Next:** Decide on tech stack. Knowns: Node.js, PostgreSQL. Open questions: TypeScript vs JavaScript, Express vs Fastify vs Hono, ORM vs query builder, project structure.
