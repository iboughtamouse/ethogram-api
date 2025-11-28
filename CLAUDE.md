# CLAUDE.md - Backend AI Assistant Guide

> **Purpose**: This document provides AI coding assistants (like Claude) with essential context about the WBS Ethogram Backend API, its architecture, implementation patterns, and development workflows.
>
> **Last Updated**: November 28, 2025
> **Status**: Phase 2 Ready for Implementation
> **Target**: Go 1.21+ with Gin framework on Fly.io

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Quick Start for AI Assistants](#quick-start-for-ai-assistants)
3. [Architecture at a Glance](#architecture-at-a-glance)
4. [Tech Stack](#tech-stack)
5. [Key Design Decisions](#key-design-decisions)
6. [Repository Structure](#repository-structure)
7. [Development Workflows](#development-workflows)
8. [Testing Strategy](#testing-strategy)
9. [Deployment](#deployment)
10. [Integration with Frontend](#integration-with-frontend)
11. [Common Tasks](#common-tasks)
12. [Things to Avoid](#things-to-avoid)
13. [Where to Find Information](#where-to-find-information)

---

## Project Overview

### What This Is

The **WBS Ethogram Backend API** is a Go-based REST API that stores and serves behavioral observation data for birds at World Bird Sanctuary. It receives observations from the frontend React application, stores them in PostgreSQL, and provides analytics/dashboard endpoints for researchers.

### Key Characteristics

- **RESTful API**: Standard HTTP/JSON endpoints
- **PostgreSQL + JSONB**: Flexible schema for multi-subject observations
- **Email Delivery**: Sends Excel files via Resend API
- **Anonymous First**: No authentication required in Phase 2
- **Multi-Phase Design**: Built to support future authentication and multi-subject tracking
- **Stateless**: No sessions, all data in database
- **Production Ready**: Designed for deployment on Fly.io

### Tech Stack

| Category              | Technology     | Version | Purpose                     |
| --------------------- | -------------- | ------- | --------------------------- |
| **Runtime**           | Go             | 1.21+   | Backend language            |
| **Framework**         | Gin            | 1.9+    | HTTP router and middleware  |
| **Database**          | PostgreSQL     | 14+     | Data persistence with JSONB |
| **ORM/Query Builder** | sqlx or pgx    | Latest  | Database access layer       |
| **Excel Generation**  | excelize       | 2.8+    | Generate .xlsx files        |
| **Email Service**     | Resend API     | -       | Email delivery              |
| **Validation**        | go-playground  | 10.x    | Request validation          |
| **Testing**           | testify        | 1.8+    | Assertions and mocking      |
| **Migration**         | golang-migrate | 4.x     | Database migrations         |
| **Deployment**        | Fly.io         | -       | Hosting platform            |
| **Containerization**  | Docker         | -       | Local dev and deployment    |

---

## Quick Start for AI Assistants

### First-Time Orientation (5 minutes)

If you're working on this codebase for the first time:

1. **Read this document** (you are here)
2. **Read [database-schema.md](database-schema.md)** - Complete PostgreSQL schema
3. **Read [api-specification.md](api-specification.md)** - All endpoints and examples
4. **Understand the phase strategy** - Phase 2 (single subject) → Phase 3 (auth) → Phase 4 (multi-subject)

### Mental Model (30 seconds)

```
Frontend POST /api/observations →
Validate request →
Convert camelCase to snake_case →
Store in PostgreSQL (JSONB) →
Generate Excel via excelize →
Send email via Resend →
Return success response
```

### Bootstrap Commands (Empty Repository)

```bash
# Initialize Go module
go mod init github.com/yourusername/wbs-ethogram-api

# Install core dependencies
go get github.com/gin-gonic/gin
go get github.com/lib/pq
go get github.com/jmoiron/sqlx
go get github.com/xuri/excelize/v2
go get github.com/go-playground/validator/v10
go get github.com/joho/godotenv

# Install dev dependencies
go get github.com/stretchr/testify
go get -tags 'postgres' github.com/golang-migrate/migrate/v4

# Create basic structure
mkdir -p cmd/api
mkdir -p internal/{handlers,models,services,database,middleware,validators}
mkdir -p migrations
mkdir -p pkg/{utils,config}
mkdir -p scripts
```

### Environment Variables

Create `.env` file:

```env
# Server
PORT=8080
GIN_MODE=debug

# Database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ethogram?sslmode=disable

# Email (Resend)
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=noreply@yourdomain.com

# CORS
ALLOWED_ORIGINS=http://localhost:5173,https://your-frontend.vercel.app

# Rate Limiting
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW=3600
```

---

## Architecture at a Glance

### Directory Structure

```
wbs-ethogram-api/
├── cmd/
│   └── api/
│       └── main.go                  # Application entry point
│
├── internal/                        # Private application code
│   ├── handlers/                    # HTTP request handlers
│   │   ├── observations.go          # Observation CRUD endpoints
│   │   ├── dashboard.go             # Analytics endpoints
│   │   └── health.go                # Health check endpoint
│   │
│   ├── models/                      # Data models
│   │   ├── observation.go           # Observation struct
│   │   ├── request.go               # Request DTOs
│   │   └── response.go              # Response DTOs
│   │
│   ├── services/                    # Business logic
│   │   ├── observation_service.go   # Observation operations
│   │   ├── excel_service.go         # Excel generation
│   │   ├── email_service.go         # Email sending via Resend
│   │   └── analytics_service.go     # Dashboard analytics
│   │
│   ├── database/                    # Database layer
│   │   ├── postgres.go              # Connection management
│   │   ├── observation_repo.go      # Observation queries
│   │   └── queries.go               # SQL queries
│   │
│   ├── middleware/                  # HTTP middleware
│   │   ├── cors.go                  # CORS configuration
│   │   ├── rate_limit.go            # Rate limiting (IP-based)
│   │   ├── error_handler.go         # Global error handling
│   │   └── logger.go                # Request/response logging
│   │
│   └── validators/                  # Custom validation
│       ├── observation.go           # Observation validation
│       └── fields.go                # Field-level validators
│
├── pkg/                             # Public packages
│   ├── config/                      # Configuration
│   │   └── config.go                # Load environment variables
│   └── utils/                       # Utility functions
│       ├── case_converter.go        # camelCase ↔ snake_case
│       ├── time.go                  # Time zone handling
│       └── response.go              # Standard response wrapper
│
├── migrations/                      # Database migrations
│   ├── 000001_init_schema.up.sql   # Initial schema
│   ├── 000001_init_schema.down.sql # Rollback
│   └── ... (future migrations)
│
├── scripts/                         # Helper scripts
│   ├── migrate.sh                   # Run migrations
│   └── seed.sh                      # Seed test data
│
├── .env.example                     # Environment variables template
├── .gitignore                       # Git ignore patterns
├── Dockerfile                       # Production container
├── docker-compose.yml               # Local development
├── fly.toml                         # Fly.io deployment config
├── go.mod                           # Go dependencies
├── go.sum                           # Dependency checksums
├── Makefile                         # Build and dev commands
└── README.md                        # Public documentation

```

### Request Flow

```
HTTP Request
  ↓
Middleware Chain (CORS, Rate Limit, Logger)
  ↓
Router (Gin) → Handler Function
  ↓
Request Validation (go-playground/validator)
  ↓
Service Layer (Business Logic)
  ↓
Repository Layer (Database Queries)
  ↓
PostgreSQL (JSONB Storage)
  ↓
Response (Standard JSON Format)
```

---

## Tech Stack

### Why Go + Gin?

- **Performance**: Fast HTTP handling, low memory footprint
- **Simplicity**: Easy to read, maintain, and deploy
- **Concurrency**: Built-in goroutines for async operations (email sending)
- **Type Safety**: Compile-time error catching
- **Ecosystem**: Great libraries for PostgreSQL, Excel, validation

### Why PostgreSQL + JSONB?

- **Flexibility**: JSONB allows schema evolution without migrations
- **Queryability**: Can index and query inside JSONB fields
- **Reliability**: ACID transactions, proven at scale
- **Compatibility**: Works well with Fly.io's managed PostgreSQL

### Why Fly.io?

- **Simplicity**: Easy deployment via `fly deploy`
- **PostgreSQL Integration**: Built-in managed database
- **Free Tier**: Sufficient for Phase 2 (low traffic)
- **Auto Domains**: `yourapp.fly.dev` provided automatically
- **Scaling**: Easy to scale up when needed

---

## Key Design Decisions

### 1. Phase Progression Strategy

**Phase 2 (Current):**

- Single subject observations (Sayyida only)
- Anonymous submissions (no authentication)
- Email delivery for Excel files
- IP-based rate limiting

**Phase 3 (Future):**

- Optional authentication (JWT via Clerk/Supabase)
- User history and leaderboard
- Higher rate limits for authenticated users

**Phase 4 (Future):**

- Multi-subject observations (foster parent + babies)
- Frontend sends arrays directly (no transformation layer)

**Design Implication:** Database schema supports arrays from day 1, even though Phase 2 only uses single-element arrays.

### 2. Field Name Conversion (camelCase ↔ snake_case)

**Frontend sends:** `observerName`, `timeSlots`, `babiesPresent`
**Database stores:** `observer_name`, `time_slots`, `babies_present`

**Why?**

- Go convention: snake_case for database columns
- JavaScript convention: camelCase for JSON
- Conversion happens in service layer using utility functions

### 3. JSONB for Time Slots

**Structure:**

```json
{
  "15:00": [
    {
      "subjectType": "foster_parent",
      "subjectId": "Sayyida",
      "behavior": "resting_alert",
      "location": "12",
      "notes": "",
      "object": "",
      "objectOther": "",
      "animal": "",
      "animalOther": "",
      "interactionType": "",
      "interactionTypeOther": "",
      "description": ""
    }
  ]
}
```

**Why JSONB instead of relational?**

- Flexible schema (behaviors can change without migrations)
- Simpler queries (one row = one observation session)
- Preserves exact frontend structure
- Supports multi-subject in Phase 4+ without schema changes

### 4. Standard Response Wrapper

All responses use consistent format:

```go
// Success
{
  "success": true,
  "data": { /* endpoint-specific data */ },
  "message": "Optional message"
}

// Error
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": [ /* validation errors */ ]
  }
}
```

### 5. Email Delivery with Retry Logic

**Process:**

1. Save observation to database first
2. Generate Excel file in memory
3. Attempt email send via Resend (3 retries with exponential backoff)
4. If email fails, return download link instead

**Why this order?**

- Data never lost (saved before email attempt)
- User gets response even if email fails
- Retry logic handles transient network errors

### 6. Validation Layers

**Two validation layers:**

1. **Struct Validation (go-playground/validator):**
   - Basic type checking
   - Required fields
   - Format validation (email, date, time)

2. **Business Logic Validation (custom validators):**
   - Conditional field requirements (based on behavior)
   - Observer name format (Discord/Twitch usernames)
   - Date range constraints (>= 2024-01-01, <= tomorrow)
   - Time slot generation validation

---

## Repository Structure

### Core Files

**`cmd/api/main.go`** - Application entry point

```go
func main() {
    // Load config
    // Connect to database
    // Initialize services
    // Setup router
    // Start server
}
```

**`internal/handlers/observations.go`** - HTTP handlers

```go
func CreateObservation(c *gin.Context)
func GetObservations(c *gin.Context)
func GetObservationByID(c *gin.Context)
```

**`internal/services/observation_service.go`** - Business logic

```go
type ObservationService interface {
    Create(ctx context.Context, req *CreateObservationRequest) (*Observation, error)
    GetByID(ctx context.Context, id uuid.UUID) (*Observation, error)
    List(ctx context.Context, filters ObservationFilters) (*ObservationList, error)
}
```

**`internal/database/observation_repo.go`** - Database queries

```go
type ObservationRepository interface {
    Insert(ctx context.Context, obs *Observation) error
    FindByID(ctx context.Context, id uuid.UUID) (*Observation, error)
    FindAll(ctx context.Context, filters Filters) ([]*Observation, error)
}
```

### Configuration Pattern

Use environment variables with sensible defaults:

```go
type Config struct {
    Port         string
    DatabaseURL  string
    ResendAPIKey string
    EmailFrom    string
    AllowedOrigins []string
    RateLimitRequests int
    RateLimitWindow   int
}

func LoadConfig() (*Config, error) {
    godotenv.Load()
    return &Config{
        Port:         getEnv("PORT", "8080"),
        DatabaseURL:  getEnv("DATABASE_URL", ""),
        // ... rest of config
    }, nil
}
```

---

## Development Workflows

### Starting Development

```bash
# 1. Start PostgreSQL (Docker)
docker-compose up -d postgres

# 2. Run migrations
make migrate-up

# 3. (Optional) Seed test data
make seed

# 4. Start development server (with hot reload)
make dev

# 5. Run tests
make test
```

### Adding a New Endpoint

**Example: Add GET /api/health**

1. **Define handler** (`internal/handlers/health.go`):

```go
func HealthCheck(c *gin.Context) {
    c.JSON(200, gin.H{
        "success": true,
        "data": gin.H{
            "status": "healthy",
            "timestamp": time.Now().UTC(),
        },
    })
}
```

2. **Register route** (`cmd/api/main.go`):

```go
router.GET("/api/health", handlers.HealthCheck)
```

3. **Test it**:

```bash
curl http://localhost:8080/api/health
```

### Adding a Database Migration

```bash
# Create migration files
migrate create -ext sql -dir migrations -seq add_user_table

# Edit migrations/000002_add_user_table.up.sql
# Edit migrations/000002_add_user_table.down.sql

# Run migration
make migrate-up

# Rollback if needed
make migrate-down
```

### Working with JSONB

**Querying time slots:**

```sql
-- Find observations with specific behavior
SELECT * FROM observations
WHERE time_slots @> '{"15:00": [{"behavior": "resting_alert"}]}'::jsonb;

-- Extract specific time slot
SELECT time_slots->'15:00' as slot_data
FROM observations
WHERE id = $1;
```

**Go struct tags for JSONB:**

```go
type Observation struct {
    ID         uuid.UUID              `db:"id" json:"id"`
    TimeSlots  map[string][]TimeSlot  `db:"time_slots" json:"timeSlots"`
    // Use custom scanner/valuer for JSONB ↔ Go struct conversion
}
```

---

## Testing Strategy

### Unit Tests

Test each layer independently:

**Service Layer:**

```go
func TestObservationService_Create(t *testing.T) {
    // Mock repository
    mockRepo := &MockObservationRepo{}
    service := NewObservationService(mockRepo, nil, nil)

    // Test creation
    obs, err := service.Create(ctx, validRequest)
    assert.NoError(t, err)
    assert.NotNil(t, obs)
}
```

**Repository Layer:**

```go
func TestObservationRepo_Insert(t *testing.T) {
    // Use test database
    db := setupTestDB(t)
    defer db.Close()

    repo := NewObservationRepository(db)
    err := repo.Insert(ctx, observation)
    assert.NoError(t, err)
}
```

### Integration Tests

Test HTTP endpoints with real database:

```go
func TestCreateObservation_Integration(t *testing.T) {
    // Setup test server with test DB
    router := setupTestRouter(t)

    // Make request
    req := httptest.NewRequest("POST", "/api/observations", body)
    w := httptest.NewRecorder()
    router.ServeHTTP(w, req)

    // Assert response
    assert.Equal(t, 201, w.Code)
}
```

### Test Database

Use separate test database:

```go
func setupTestDB(t *testing.T) *sqlx.DB {
    db := sqlx.MustConnect("postgres", os.Getenv("TEST_DATABASE_URL"))

    // Run migrations
    runMigrations(db)

    // Cleanup after test
    t.Cleanup(func() {
        db.Exec("TRUNCATE observations CASCADE")
    })

    return db
}
```

---

## Deployment

### Fly.io Setup

1. **Install Fly CLI:**

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

2. **Initialize app:**

```bash
fly launch
# Choose app name: wbs-ethogram-api
# Choose region (closest to users)
# Don't deploy yet
```

3. **Create PostgreSQL:**

```bash
fly postgres create --name wbs-ethogram-db
fly postgres attach wbs-ethogram-db
```

4. **Set secrets:**

```bash
fly secrets set RESEND_API_KEY=your_key
fly secrets set EMAIL_FROM=noreply@yourdomain.com
fly secrets set ALLOWED_ORIGINS=https://your-frontend.vercel.app
```

5. **Deploy:**

```bash
fly deploy
```

### Dockerfile

```dockerfile
# Build stage
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/api ./cmd/api

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/api .
EXPOSE 8080
CMD ["./api"]
```

### fly.toml

```toml
app = "wbs-ethogram-api"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  GIN_MODE = "release"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    method = "GET"
    path = "/api/health"
```

---

## Integration with Frontend

### CORS Configuration

Allow frontend domains:

```go
func CORSMiddleware(allowedOrigins []string) gin.HandlerFunc {
    return func(c *gin.Context) {
        origin := c.Request.Header.Get("Origin")

        for _, allowed := range allowedOrigins {
            if origin == allowed {
                c.Header("Access-Control-Allow-Origin", origin)
                c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key")
                break
            }
        }

        if c.Request.Method == "OPTIONS" {
            c.AbortWithStatus(204)
            return
        }

        c.Next()
    }
}
```

### Frontend Updates Required

**Before backend deployment:**

1. Update frontend to send array structure:

```javascript
// Change from:
timeSlots: { "15:00": { behavior: "resting_alert", ... } }

// To:
timeSlots: {
  "15:00": [{
    subjectType: "foster_parent",
    subjectId: "Sayyida",
    behavior: "resting_alert",
    ...
  }]
}
```

2. Update API endpoint in frontend:

```javascript
// .env
VITE_API_URL=https://wbs-ethogram-api.fly.dev
```

---

## Common Tasks

### Task 1: Add New Validation Rule

**Example: Validate observer name format**

1. Create custom validator:

```go
func ValidateObserverName(fl validator.FieldLevel) bool {
    name := fl.Field().String()
    if len(name) < 2 || len(name) > 32 {
        return false
    }
    // Check Discord/Twitch format
    matched, _ := regexp.MatchString(`^[\p{L}\p{N}\s._-]+$`, name)
    return matched
}
```

2. Register validator:

```go
if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
    v.RegisterValidation("observername", ValidateObserverName)
}
```

3. Use in struct:

```go
type CreateObservationRequest struct {
    ObserverName string `json:"observerName" binding:"required,observername"`
}
```

### Task 2: Add New Dashboard Endpoint

**Example: GET /api/dashboard/behaviors**

1. Create service method:

```go
func (s *AnalyticsService) GetBehaviorFrequency(ctx context.Context, filters BehaviorFilters) (*BehaviorStats, error) {
    // Query database
    // Aggregate behavior counts
    // Calculate percentages
    return stats, nil
}
```

2. Create handler:

```go
func (h *DashboardHandler) GetBehaviorFrequency(c *gin.Context) {
    var filters BehaviorFilters
    if err := c.ShouldBindQuery(&filters); err != nil {
        c.JSON(400, ErrorResponse(err))
        return
    }

    stats, err := h.analyticsService.GetBehaviorFrequency(c, filters)
    if err != nil {
        c.JSON(500, ErrorResponse(err))
        return
    }

    c.JSON(200, SuccessResponse(stats))
}
```

3. Register route:

```go
api.GET("/dashboard/behaviors", dashboardHandler.GetBehaviorFrequency)
```

### Task 3: Debug Database Query

**Check PostgreSQL logs:**

```bash
# Fly.io
fly logs

# Local Docker
docker-compose logs postgres

# Enable query logging in PostgreSQL
ALTER DATABASE ethogram SET log_statement = 'all';
```

**Test query directly:**

```bash
# Connect to database
fly postgres connect -a wbs-ethogram-db

# Or locally
psql $DATABASE_URL

# Run query
SELECT * FROM observations WHERE id = '...';
```

---

## Things to Avoid

### ❌ Don't: Use ORM for complex queries

**Why**: JSONB queries are easier with raw SQL

```go
// ❌ BAD - ORM struggling with JSONB
db.Where("time_slots @> ?", jsonData).Find(&observations)

// ✅ GOOD - Raw SQL with sqlx
db.Select(&observations, `
    SELECT * FROM observations
    WHERE time_slots @> $1::jsonb
`, jsonData)
```

### ❌ Don't: Block on email sending

**Why**: Email sending can be slow, use goroutine

```go
// ❌ BAD - Blocks request
err := emailService.Send(observation)

// ✅ GOOD - Async with error handling
go func() {
    if err := emailService.Send(observation); err != nil {
        log.Printf("Email send failed: %v", err)
    }
}()
```

### ❌ Don't: Forget to close database connections

**Why**: Connection leaks crash your app

```go
// ❌ BAD
rows, _ := db.Query(query)

// ✅ GOOD
rows, err := db.Query(query)
if err != nil {
    return err
}
defer rows.Close()
```

### ❌ Don't: Expose internal errors to clients

**Why**: Security risk, confusing messages

```go
// ❌ BAD
c.JSON(500, gin.H{"error": err.Error()})

// ✅ GOOD
log.Printf("Database error: %v", err)
c.JSON(500, gin.H{
    "success": false,
    "error": {
        "code": "DATABASE_ERROR",
        "message": "An internal error occurred",
    },
})
```

### ❌ Don't: Skip input validation

**Why**: SQL injection, XSS, data corruption

```go
// ❌ BAD
query := fmt.Sprintf("SELECT * FROM observations WHERE id = '%s'", id)

// ✅ GOOD
query := "SELECT * FROM observations WHERE id = $1"
db.Get(&obs, query, id)
```

---

## Where to Find Information

### Documentation

| Question                               | Document                                     |
| -------------------------------------- | -------------------------------------------- |
| What's the complete database schema?   | [database-schema.md](database-schema.md)     |
| What endpoints do I need to implement? | [api-specification.md](api-specification.md) |
| What's the JSONB structure?            | Both docs above, see time_slots examples     |
| How do I deploy to Fly.io?             | This file - Deployment section               |
| What validation rules exist?           | api-specification.md - Validation Rules      |

### External Resources

| Resource          | URL                                        |
| ----------------- | ------------------------------------------ |
| **Gin Framework** | https://gin-gonic.com/docs/                |
| **excelize**      | https://xuri.me/excelize/                  |
| **Resend API**    | https://resend.com/docs                    |
| **Fly.io Docs**   | https://fly.io/docs/                       |
| **PostgreSQL**    | https://www.postgresql.org/docs/           |
| **sqlx**          | https://github.com/jmoiron/sqlx            |
| **validator**     | https://github.com/go-playground/validator |

### Code Examples

**Standard response wrapper:**

```go
func SuccessResponse(data interface{}) gin.H {
    return gin.H{
        "success": true,
        "data": data,
    }
}

func ErrorResponse(err error) gin.H {
    return gin.H{
        "success": false,
        "error": gin.H{
            "code": "INTERNAL_ERROR",
            "message": err.Error(),
        },
    }
}
```

**Database connection:**

```go
func ConnectDB(url string) (*sqlx.DB, error) {
    db, err := sqlx.Connect("postgres", url)
    if err != nil {
        return nil, err
    }

    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(5)
    db.SetConnMaxLifetime(5 * time.Minute)

    return db, nil
}
```

---

## Makefile Examples

Create `Makefile` for common tasks:

```makefile
.PHONY: dev test migrate-up migrate-down seed

dev:
	air

test:
	go test -v ./...

migrate-up:
	migrate -path migrations -database $(DATABASE_URL) up

migrate-down:
	migrate -path migrations -database $(DATABASE_URL) down 1

seed:
	go run scripts/seed.go

build:
	go build -o bin/api cmd/api/main.go

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

lint:
	golangci-lint run
```

---

## Final Tips for AI Assistants

### When Starting a New Task

1. **Read the spec first** - Check api-specification.md for exact requirements
2. **Check the schema** - Verify database structure in database-schema.md
3. **Write tests first** - TDD approach catches issues early
4. **Start small** - Build incrementally, test each piece
5. **Use standards** - Follow Go conventions, REST principles

### When Stuck

1. **Check existing patterns** - How is similar code structured?
2. **Read the docs** - External library documentation
3. **Test in isolation** - Use `go test` for specific functions
4. **Check logs** - Enable debug logging, read PostgreSQL logs
5. **Ask specific questions** - Provide context and what you've tried

### Best Practices

- ✅ **Use context.Context** - Pass through all layers for cancellation
- ✅ **Handle errors** - Don't ignore, log and return appropriate responses
- ✅ **Validate input** - Never trust client data
- ✅ **Use transactions** - For multi-step database operations
- ✅ **Write comments** - Explain why, not what
- ✅ **Use constants** - No magic strings or numbers
- ✅ **Follow 12-factor** - Config in env, stateless, logs to stdout

---

## Document Maintenance

**Last Updated**: November 28, 2025
**Updated By**: Claude (Anthropic AI)
**Version**: 1.0.0
**Status**: Initial creation for Phase 2 implementation

**When to Update This Document:**

- Major architectural changes
- New patterns emerge
- Deployment strategy changes
- External services change (Resend, Fly.io, etc.)
- Common issues discovered

**How to Update:**

1. Edit this file directly
2. Keep sections focused and scannable
3. Add examples where helpful
4. Remove outdated information
5. Update "Last Updated" timestamp
6. Commit with message: `docs: update CLAUDE.md with [changes]`

---

**End of CLAUDE.md**
