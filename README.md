# Ethogram Backend API

A production-ready REST API for behavioral observation data collection, built entirely by AI (Claude, Anthropic) as an experiment in AI-driven software development.

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat&logo=go)](https://golang.org)
[![Test Coverage](https://img.shields.io/badge/coverage-60.3%25-yellow)](https://github.com/iboughtamouse/ethogram-api)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Project Purpose

This repository serves as a case study in **AI-assisted development**, where every line of code, test, and documentation was written by Claude (Anthropic's AI assistant) under human guidance. The goal was to explore:

- **AI's ability to build production-quality software** with proper architecture, testing, and documentation
- **Human-AI collaboration patterns** for complex software projects
- **Code quality and maintainability** when AI is the primary developer

**Disclaimer**: This project is not affiliated with any organization. It is an educational/portfolio project demonstrating AI capabilities in software engineering.

---

## What This API Does

The Ethogram API stores and serves behavioral observation data for animal research. It provides:

- **Observation submission** - Accept behavioral data via REST API
- **Excel generation** - Convert observations to researcher-friendly spreadsheets
- **Email delivery** - Send Excel files via Resend API with retry logic
- **JSONB storage** - Flexible PostgreSQL schema for evolving data structures
- **Validation** - Comprehensive request validation and error handling

### Key Features

- ✅ **60.3% test coverage** with comprehensive unit and integration tests
- ✅ **Phase-aware architecture** - Built for single-subject (Phase 2), ready for multi-subject (Phase 4)
- ✅ **Production-ready** - CORS, rate limiting, structured logging, error handling
- ✅ **Type-safe** - Strong typing with Go, validated requests
- ✅ **Well-documented** - Extensive inline documentation and architecture guides

---

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Runtime** | Go 1.21+ | Backend language |
| **Framework** | Gin 1.9+ | HTTP router and middleware |
| **Database** | PostgreSQL 14+ | Data persistence with JSONB |
| **Query Builder** | sqlx | Database access layer |
| **Excel Generation** | excelize 2.8+ | Generate .xlsx files |
| **Email Service** | Resend API | Email delivery with attachments |
| **Validation** | go-playground/validator 10.x | Request validation |
| **Testing** | testify 1.8+ | Assertions and test utilities |
| **Migration** | golang-migrate 4.x | Database migrations |

---

## Quick Start

### Prerequisites

- Go 1.21 or higher
- PostgreSQL 14+
- Docker (optional, for local development)

### Installation

```bash
# Clone the repository
git clone https://github.com/iboughtamouse/ethogram-api.git
cd ethogram-api

# Install dependencies
go mod download

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
# IMPORTANT: Set RESEND_API_KEY and EMAIL_FROM with your verified domain
```

### Database Setup

```bash
# Start PostgreSQL (using Docker)
docker-compose up -d postgres

# Run migrations
migrate -path migrations -database "postgres://postgres:postgres@localhost:5432/ethogram?sslmode=disable" up
```

### Running the API

```bash
# Development mode (with hot reload)
go run cmd/api/main.go

# Or build and run
go build -o bin/api cmd/api/main.go
./bin/api
```

The API will start on `http://localhost:8080`.

### Running Tests

```bash
# Run all tests
go test ./...

# Run with coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Run specific package tests
go test ./internal/handlers/
go test ./internal/services/
```

---

## API Endpoints

### Health Check
```http
GET /api/health
```

### Submit Observation
```http
POST /api/observations
Content-Type: application/json

{
  "observerName": "Alice Smith",
  "observationDate": "2025-11-29",
  "startTime": "15:00",
  "endTime": "16:00",
  "aviary": "Main Aviary",
  "mode": "live",
  "babiesPresent": 0,
  "environmentalNotes": "Sunny, calm weather",
  "timeSlots": {
    "15:00": {
      "behavior": "resting_alert",
      "location": "12",
      "notes": "Perched on branch 12"
    },
    "15:05": {
      "behavior": "preening",
      "location": "12"
    }
  },
  "emails": ["researcher@example.com"]
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "observerName": "Alice Smith",
    "observationDate": "2025-11-29",
    "submittedAt": "2025-11-29T15:30:45Z",
    ...
  }
}
```

See [API Specification](docs/api-specification.md) for complete documentation.

---

## Project Structure

```
ethogram-api/
├── cmd/
│   └── api/
│       └── main.go                  # Application entry point
│
├── internal/                        # Private application code
│   ├── handlers/                    # HTTP request handlers
│   │   ├── observations.go
│   │   └── observations_test.go
│   │
│   ├── services/                    # Business logic
│   │   ├── observation_service.go   # Observation operations
│   │   ├── excel_service.go         # Excel generation
│   │   ├── email_service.go         # Email delivery
│   │   └── *_test.go                # Unit tests (60.3% coverage)
│   │
│   ├── database/                    # Database layer
│   │   ├── postgres.go              # Connection management
│   │   ├── observation_repo.go      # Observation queries
│   │   └── observation_repo_test.go
│   │
│   ├── middleware/                  # HTTP middleware
│   │   ├── cors.go                  # CORS configuration
│   │   └── cors_test.go
│   │
│   └── models/                      # Data models
│       └── observation.go
│
├── pkg/                             # Public packages
│   ├── config/                      # Configuration
│   └── utils/                       # Utility functions
│       ├── response.go
│       └── response_test.go
│
├── migrations/                      # Database migrations
│   ├── 000001_init_schema.up.sql
│   └── 000001_init_schema.down.sql
│
├── docs/                            # Documentation
│   ├── CLAUDE.md                    # AI assistant guide
│   ├── database-schema.md           # Database documentation
│   └── api-specification.md         # API documentation
│
├── .env.example                     # Environment variables template
├── docker-compose.yml               # Local development setup
├── go.mod                           # Go dependencies
└── README.md                        # This file
```

---

## Configuration

All configuration is done via environment variables. See `.env.example` for all available options.

### Required Configuration

```bash
# Database (required)
DATABASE_URL=postgres://user:password@localhost:5432/ethogram?sslmode=disable

# Email Service (required for email functionality)
RESEND_API_KEY=re_xxxxxxxxxxxx  # Get from https://resend.com
EMAIL_FROM=noreply@yourdomain.com  # Must be verified in Resend
```

### Optional Configuration

```bash
# Server
PORT=8080
GIN_MODE=release  # Use 'debug' for development

# CORS
ALLOWED_ORIGINS=http://localhost:5173,https://yourapp.com

# Rate Limiting
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW=3600
```

**⚠️ Security Note**: Never commit `.env` files. The `.env.example` file contains placeholder values only. Always use environment-specific secrets in production.

---

## Testing Philosophy

This project maintains **60.3% test coverage** with a focus on **behavior validation** over arbitrary coverage metrics:

### What's Tested (and Why)

- ✅ **HTTP Handlers (84.6%)** - All endpoints, validation, error handling
- ✅ **Excel Generation (96.8%)** - Critical business logic, format correctness
- ✅ **Database Repository (83.3%)** - Data integrity, JSONB handling
- ✅ **CORS Middleware (100%)** - Security-critical code
- ✅ **Response Utilities (100%)** - Used everywhere, must be correct
- ✅ **Email HTML Generation (100%)** - User-facing content

### What's Not Tested (and Why)

- ❌ **main.go** - Application wiring (hard to test, low value)
- ❌ **Config loading** - Environment-dependent
- ❌ **Email sending (retry logic)** - Requires HTTP mocking (complex, low ROI)
- ❌ **JSONB Value/Scan** - Integration tested via repository tests

### Running Tests

```bash
# All tests
go test ./...

# With coverage report
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out

# Specific package
go test -v ./internal/handlers/

# Integration tests (require database)
docker-compose up -d postgres
go test -v ./internal/database/
go test -v ./internal/handlers/
```

---

## Architecture Decisions

### 1. Phase-Aware Design

The API is built for **Phase 2** (single subject) but architectured for **Phase 4** (multi-subject):

- **Database**: Stores arrays of observations per time slot
- **API**: Accepts single objects in Phase 2
- **Transformation Layer**: Converts flat objects → arrays with hardcoded metadata
- **Future**: Frontend will send arrays directly in Phase 4

### 2. JSONB for Flexibility

Time slots are stored as JSONB in PostgreSQL:
- ✅ Schema evolution without migrations
- ✅ Queryable with PostgreSQL's JSONB operators
- ✅ Supports arbitrary nested structures
- ✅ Preserves exact frontend structure

### 3. Async Email Delivery

Email sending is non-blocking:
1. Save observation to database (data never lost)
2. Generate Excel file
3. Send email asynchronously via goroutine
4. Return response immediately

### 4. Standard Response Format

All endpoints return consistent JSON:

```json
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": ["Field 'name' is required"]
  }
}
```

---

## Development Workflow

### Adding a New Feature

1. **Read the guides**:
   - [`CLAUDE.md`](docs/CLAUDE.md) - Architecture and patterns
   - [`database-schema.md`](docs/database-schema.md) - Database structure
   - [`api-specification.md`](docs/api-specification.md) - API contracts

2. **Write tests first** (TDD approach):
   ```bash
   # Create test file
   touch internal/services/my_feature_test.go

   # Write failing tests
   go test ./internal/services/
   ```

3. **Implement the feature**:
   - Follow existing patterns (see similar code)
   - Use dependency injection
   - Pass `context.Context` through all layers

4. **Run tests**:
   ```bash
   go test ./...
   go test -coverprofile=coverage.out ./...
   ```

5. **Commit with descriptive message**:
   ```bash
   git add .
   git commit -m "feat: add new feature with tests

   - Implement feature X
   - Add comprehensive tests
   - Update documentation

   Coverage: services 66.7% → 70.2%"
   ```

---

## Database Schema

The database uses PostgreSQL with JSONB for flexible observation storage.

### Key Tables

**`observations`** (main table):
- `id` (uuid, primary key)
- `observer_name` (text)
- `observation_date` (date)
- `start_time`, `end_time` (text, HH:MM format)
- `aviary` (text)
- `mode` (text, enum: 'live' | 'vod')
- `babies_present` (integer)
- `environmental_notes` (text, nullable)
- `time_slots` (jsonb) - Behavioral observations
- `emails` (text[], array of email addresses)
- `submitted_at`, `created_at`, `updated_at` (timestamps)

### JSONB Structure

`time_slots` column stores observations as:

```json
{
  "15:00": [
    {
      "subjectType": "foster_parent",
      "subjectId": "Sayyida",
      "behavior": "resting_alert",
      "location": "12",
      "notes": "Perched quietly",
      "object": "",
      "animal": "",
      "interactionType": "",
      "description": ""
    }
  ],
  "15:05": [...]
}
```

See [`database-schema.md`](docs/database-schema.md) for complete documentation.

---

## Deployment

### Fly.io (Recommended)

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Launch app
fly launch

# Create and attach PostgreSQL
fly postgres create --name ethogram-db
fly postgres attach ethogram-db

# Set secrets
fly secrets set RESEND_API_KEY=your_key
fly secrets set EMAIL_FROM=noreply@yourdomain.com

# Deploy
fly deploy
```

### Docker

```bash
# Build image
docker build -t ethogram-api .

# Run container
docker run -p 8080:8080 \
  -e DATABASE_URL=postgres://... \
  -e RESEND_API_KEY=... \
  ethogram-api
```

### Environment Variables for Production

```bash
# Set in production environment
GIN_MODE=release
PORT=8080
DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
RESEND_API_KEY=re_live_xxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
ALLOWED_ORIGINS=https://yourapp.com
```

**⚠️ Production Checklist**:
- [ ] Use `GIN_MODE=release`
- [ ] Enable SSL for database (`sslmode=require`)
- [ ] Use production Resend API key
- [ ] Configure CORS for production domain
- [ ] Set up monitoring/logging
- [ ] Run database migrations
- [ ] Test email delivery

---

## Contributing

This is an **AI-generated project** serving as a case study. Contributions are welcome, but please understand:

- The primary goal is demonstrating AI capabilities
- All original code was written by Claude (Anthropic)
- Human contributions are accepted for improvements

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure tests pass (`go test ./...`)
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

---

## AI Development Notes

This entire codebase was written by Claude (Anthropic's AI) with human guidance. Key observations:

### What Worked Well

✅ **Architecture decisions** - Clean separation of concerns, proper dependency injection
✅ **Test coverage** - Comprehensive tests written alongside implementation
✅ **Documentation** - Extensive inline comments and external docs
✅ **Error handling** - Consistent error patterns throughout
✅ **Type safety** - Proper use of Go's type system

### Challenges Encountered

⚠️ **API signature mismatches** - Initially wrote tests with wrong function signatures
⚠️ **Type assertions** - Confusion between `gin.H` and `map[string]interface{}`
⚠️ **Database scanning** - JSONB array scanning required careful handling
⚠️ **Test isolation** - Needed explicit cleanup between database tests

### Lessons Learned

1. **Read before write** - AI should read actual implementation before writing tests
2. **One file at a time** - Better results when focusing on single test file
3. **Explicit validation** - Running tests immediately catches AI mistakes
4. **Human oversight essential** - AI needs feedback to correct course

See [`CLAUDE.md`](docs/CLAUDE.md) for AI-specific development guidance.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **Built by**: Claude (Anthropic AI)
- **Guided by**: [@iboughtamouse](https://github.com/iboughtamouse)
- **Purpose**: Educational case study in AI-driven software development

---

## Additional Resources

- [CLAUDE.md](docs/CLAUDE.md) - Complete guide for AI assistants working on this codebase
- [API Specification](docs/api-specification.md) - Detailed API documentation with examples
- [Database Schema](docs/database-schema.md) - Complete PostgreSQL schema documentation
- [Gin Framework](https://gin-gonic.com/docs/) - HTTP framework documentation
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html) - JSONB documentation

---

**Questions or Issues?** Open an issue on [GitHub](https://github.com/iboughtamouse/ethogram-api/issues).
