# Ethogram API

Backend API for the WBS Ethogram observation system.

## Status

✅ **Observation storage** — `POST /api/observations/submit` accepts and stores observations  
✅ **Excel generation** — Service ready, matches frontend format  
✅ **Email sending** — Resend integration working  
🚧 **Wiring up** — Connect Excel + Email to submit endpoint

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env  # Then edit with your Postgres credentials

# Run migrations
npm run migrate

# Start dev server
npm run dev

# Run tests
npm run test
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/observations/submit` | Submit observation session |

## Documentation

- [API Specification](docs/api-specification.md)
- [Database Schema](docs/database-schema.md)
- [CLAUDE.md](CLAUDE.md) — AI-human working agreement
