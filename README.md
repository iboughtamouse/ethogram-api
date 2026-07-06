# Ethogram API

Backend API for the WBS Ethogram observation system. This is the backend half of a
two-service app — the React frontend ([`wbs-ethogram-form`](../wbs-ethogram-form), on Vercel)
submits here. Cross-repo context and current focus live in [`ethogram-notes`](../ethogram-notes).

## Status

✅ **Deployed** — Production API live on Railway  
✅ **Observation storage** — Submit and store behavioral observations  
✅ **Excel generation** — Automatic Excel file creation  
✅ **Email delivery** — Send observations via Resend  
✅ **Share & Download** — Share observations or download Excel directly

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env  # Then edit with your credentials

# Run migrations
npm run db:migrate

# Start dev server
npm run dev

# Run tests
npm test
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/observations/submit` | Submit observation, auto-emails Excel |
| POST | `/api/observations/:id/share` | Email observation to user (rate limited) |
| GET | `/api/observations/:id/excel` | Download observation as Excel file |

## Documentation

- [API Specification](docs/api-specification.md) — Full endpoint docs
- [Database Schema](docs/database-schema.md) — PostgreSQL tables
- [CLAUDE.md](CLAUDE.md) — AI-human working agreement
