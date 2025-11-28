# API Specification - WBS Ethogram Backend

**Version:** 1.0.0
**Last Updated:** November 24, 2025
**Status:** Draft - Phase 2 Implementation Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Base Configuration](#base-configuration)
3. [Authentication](#authentication)
4. [Core Endpoints](#core-endpoints)
5. [Dashboard & Analytics Endpoints](#dashboard--analytics-endpoints)
6. [Request/Response Schemas](#requestresponse-schemas)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [Email Delivery](#email-delivery)
10. [Validation Rules](#validation-rules)
11. [CORS Configuration](#cors-configuration)
12. [Idempotency](#idempotency)
13. [Phase Roadmap](#phase-roadmap)

---

## Overview

### Purpose

This API serves the WBS Ethogram frontend application, enabling citizen scientists to submit behavioral observations of birds at the World Bird Sanctuary and researchers to query aggregated data for analysis.

### Design Principles

- **RESTful architecture** - Standard HTTP methods, resource-based URLs
- **JSON-first** - All requests and responses use JSON (except file downloads)
- **Stateless** - No server-side sessions, authentication via tokens (Phase 3+)
- **Validation layers** - Server-side validation mirrors frontend rules
- **Rate limiting** - Protect against abuse while allowing citizen science
- **Email-first delivery** - Excel files sent via email (Phase 2) or downloadable (Phase 3+)

### Technology Stack

- **Runtime:** Go 1.21+
- **Framework:** Gin (https://gin-gonic.com/)
- **Database:** PostgreSQL 14+ with JSONB support
- **Email Service:** Resend (https://resend.com/)
- **Hosting:** Fly.io (https://fly.io/)

---

## Base Configuration

### Base URL

```
Production:  https://api.ethogram.worldbirdsanctuary.org
Staging:     https://staging-api.ethogram.worldbirdsanctuary.org
Development: http://localhost:8080
```

### API Versioning

**Current approach:** No versioning in Phase 2 (breaking changes will be avoided).

**Future approach (Phase 3+):** Version prefix in URL:

- `/v1/observations`
- `/v2/observations` (if breaking changes needed)

### Content Types

**Request:**

- `Content-Type: application/json`

**Response:**

- `Content-Type: application/json` (default)
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (Excel downloads)

---

## Authentication

### Phase 2: No Authentication Required

- All endpoints are **publicly accessible**
- Anonymous submissions always supported
- Rate limiting by IP address

### Phase 3+: Optional Authentication

**Authentication method:** JWT tokens (via Clerk or Supabase)

**Request header:**

```
Authorization: Bearer <jwt_token>
```

**Authenticated users benefits:**

- Higher rate limits
- Appear on leaderboard
- Access to personal submission history
- Future features (notifications, saved searches)

**Anonymous users:**

- Can still submit observations
- Can view public dashboards
- Cannot access leaderboard or history

---

## Core Endpoints

### 1. Submit Observation

**Endpoint:** `POST /api/observations`

**Purpose:** Submit a new behavioral observation session.

**Authentication:** Optional (Phase 3+)

**Request Body:**

```json
{
  "observerName": "Alice",
  "observationDate": "2025-11-24",
  "startTime": "15:00",
  "endTime": "15:30",
  "aviary": "Sayyida's Cove",
  "mode": "live",
  "babiesPresent": 0,
  "environmentalNotes": null,
  "timeSlots": {
    "15:00": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "resting_alert",
        "location": "12",
        "notes": "Alert, watching stream",
        "object": "",
        "objectOther": "",
        "animal": "",
        "animalOther": "",
        "interactionType": "",
        "interactionTypeOther": "",
        "description": ""
      }
    ],
    "15:05": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "preening",
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
  },
  "emails": ["alice@example.com", "wbs@worldbirdsanctuary.org"]
}
```

**Phase 2 Notes:**

1. **Array Structure:** The frontend will be updated to send observations in the array structure shown above. Each time slot contains an array of subject observations, even though Phase 2 only supports single-subject observations (Sayyida only). This structure supports future multi-subject observations (Phase 4+) without requiring schema migrations.

2. **Future Fields:** The fields `babiesPresent` and `environmentalNotes` are defined in the database schema but not yet implemented in the frontend. Phase 2 submissions will default `babiesPresent` to `0` and `environmentalNotes` to `null`. Frontend implementation planned for Phase 3+.

3. **Field Name Conversion:** The API uses camelCase field names which the backend converts to snake_case for database storage:
   - `observerName` → `observer_name`
   - `observationDate` → `observation_date`
   - `startTime` → `start_time`
   - `endTime` → `end_time`
   - `babiesPresent` → `babies_present`
   - `environmentalNotes` → `environmental_notes`
   - `timeSlots` → `time_slots`

**Response (Success):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "observerName": "Alice",
    "observationDate": "2025-11-24",
    "startTime": "15:00",
    "endTime": "15:30",
    "submittedAt": "2025-11-24T15:35:22Z",
    "emailsSent": true,
    "emailRecipients": ["alice@example.com", "wbs@worldbirdsanctuary.org"]
  },
  "message": "Observation submitted successfully. Excel file sent to 2 recipients."
}
```

**Response (Error - Validation Failed):**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "timeSlots.15:00[0].behavior",
        "message": "Behavior is required"
      },
      {
        "field": "observerName",
        "message": "Observer name must be at least 2 characters"
      }
    ]
  }
}
```

**HTTP Status Codes:**

- `201 Created` - Observation successfully submitted
- `400 Bad Request` - Validation errors or malformed request
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error (email sending failed, database error)

**Idempotency:**

Include `Idempotency-Key` header to prevent duplicate submissions:

```
POST /api/observations
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

Server will return existing observation if same key submitted within 24 hours.

---

### 2. Get Observations (Query)

**Endpoint:** `GET /api/observations`

**Purpose:** Query observations with filters (for research/analytics).

**Authentication:** Optional (Phase 3+)

**Query Parameters:**

| Parameter       | Type    | Required | Description                                     | Example           |
| --------------- | ------- | -------- | ----------------------------------------------- | ----------------- |
| `aviary`        | string  | No       | Filter by aviary name                           | `Sayyida's Cove`  |
| `startDate`     | date    | No       | Start of date range (inclusive)                 | `2025-11-01`      |
| `endDate`       | date    | No       | End of date range (inclusive)                   | `2025-11-30`      |
| `observerName`  | string  | No       | Filter by observer name (partial match)         | `Alice`           |
| `mode`          | string  | No       | Filter by mode (`live` or `vod`)                | `live`            |
| `babiesPresent` | integer | No       | Filter by baby count                            | `2`               |
| `limit`         | integer | No       | Max results to return (default: 50, max: 500)   | `100`             |
| `offset`        | integer | No       | Pagination offset (default: 0)                  | `50`              |
| `sortBy`        | string  | No       | Sort field (default: `submittedAt`)             | `observationDate` |
| `sortOrder`     | string  | No       | Sort direction: `asc` or `desc` (default: desc) | `desc`            |

**Example Request:**

```
GET /api/observations?aviary=Sayyida%27s+Cove&startDate=2025-11-01&endDate=2025-11-30&limit=10
```

**Response:**

```json
{
  "success": true,
  "data": {
    "observations": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "observerName": "Alice",
        "observationDate": "2025-11-24",
        "startTime": "15:00",
        "endTime": "15:30",
        "aviary": "Sayyida's Cove",
        "mode": "live",
        "babiesPresent": 0,
        "submittedAt": "2025-11-24T15:35:22Z"
      }
      // ... more observations
    ],
    "pagination": {
      "total": 127,
      "limit": 10,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

**HTTP Status Codes:**

- `200 OK` - Successfully retrieved observations
- `400 Bad Request` - Invalid query parameters
- `500 Internal Server Error` - Database error

**Note:** Full observation data (including `timeSlots` JSONB) is **not** included in list responses to reduce payload size. Use `GET /api/observations/:id` for complete data.

---

### 3. Get Single Observation

**Endpoint:** `GET /api/observations/:id`

**Purpose:** Retrieve complete observation data including all time slots.

**Authentication:** Optional (Phase 3+)

**Path Parameters:**

- `:id` - UUID of the observation

**Example Request:**

```
GET /api/observations/550e8400-e29b-41d4-a716-446655440000
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "observerName": "Alice",
    "observationDate": "2025-11-24",
    "startTime": "15:00",
    "endTime": "15:30",
    "aviary": "Sayyida's Cove",
    "mode": "live",
    "babiesPresent": 0,
    "environmentalNotes": null,
    "timeSlots": {
      "15:00": [
        {
          "subjectType": "foster_parent",
          "subjectId": "Sayyida",
          "behavior": "resting_alert",
          "location": "12",
          "notes": "Alert, watching stream",
          "object": "",
          "objectOther": "",
          "animal": "",
          "animalOther": "",
          "interactionType": "",
          "interactionTypeOther": "",
          "description": ""
        }
      ],
      "15:05": [
        {
          "subjectType": "foster_parent",
          "subjectId": "Sayyida",
          "behavior": "preening",
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
    },
    "emails": ["alice@example.com"],
    "submittedAt": "2025-11-24T15:35:22Z",
    "createdAt": "2025-11-24T15:35:22Z",
    "updatedAt": "2025-11-24T15:35:22Z",
    "userId": null
  }
}
```

**HTTP Status Codes:**

- `200 OK` - Observation found
- `404 Not Found` - Observation ID doesn't exist
- `500 Internal Server Error` - Database error

---

## Dashboard & Analytics Endpoints

These endpoints support the research questions identified by WBS staff. All endpoints are **read-only** and publicly accessible.

### 4. Behavior Frequency

**Endpoint:** `GET /api/dashboard/behaviors`

**Purpose:** Count occurrences of each behavior for a given subject and date range.

**Query Parameters:**

| Parameter       | Type    | Required | Description                           | Example          |
| --------------- | ------- | -------- | ------------------------------------- | ---------------- |
| `aviary`        | string  | Yes      | Aviary name                           | `Sayyida's Cove` |
| `subjectType`   | string  | No       | Filter by subject type (default: all) | `foster_parent`  |
| `startDate`     | date    | Yes      | Start of date range                   | `2025-11-01`     |
| `endDate`       | date    | Yes      | End of date range                     | `2025-11-30`     |
| `babiesPresent` | integer | No       | Filter by baby count                  | `2`              |

**Example Request:**

```
GET /api/dashboard/behaviors?aviary=Sayyida%27s+Cove&subjectType=foster_parent&startDate=2025-11-01&endDate=2025-11-30
```

**Response:**

```json
{
  "success": true,
  "data": {
    "behaviors": [
      {
        "behavior": "resting_alert",
        "count": 487,
        "percentage": 35.2
      },
      {
        "behavior": "preening",
        "count": 312,
        "percentage": 22.6
      },
      {
        "behavior": "eating_food_platform",
        "count": 189,
        "percentage": 13.7
      }
      // ... more behaviors
    ],
    "totalSlots": 1383,
    "dateRange": {
      "start": "2025-11-01",
      "end": "2025-11-30"
    },
    "filters": {
      "aviary": "Sayyida's Cove",
      "subjectType": "foster_parent",
      "babiesPresent": null
    }
  }
}
```

---

### 5. Location Heatmap

**Endpoint:** `GET /api/dashboard/locations`

**Purpose:** Show most-used perches/locations for a subject.

**Query Parameters:** Same as Behavior Frequency endpoint

**Response:**

```json
{
  "success": true,
  "data": {
    "locations": [
      {
        "location": "12",
        "count": 234,
        "percentage": 25.8
      },
      {
        "location": "BB1",
        "count": 187,
        "percentage": 20.6
      },
      {
        "location": "GROUND",
        "count": 143,
        "percentage": 15.7
      }
      // ... more locations
    ],
    "totalSlots": 908
  }
}
```

---

### 6. Time-of-Day Patterns

**Endpoint:** `GET /api/dashboard/time-patterns`

**Purpose:** Analyze behavior frequency by hour of day.

**Query Parameters:**

| Parameter   | Type   | Required | Description                  | Example                |
| ----------- | ------ | -------- | ---------------------------- | ---------------------- |
| `aviary`    | string | Yes      | Aviary name                  | `Sayyida's Cove`       |
| `behavior`  | string | Yes      | Specific behavior to analyze | `eating_food_platform` |
| `startDate` | date   | Yes      | Start of date range          | `2025-11-01`           |
| `endDate`   | date   | Yes      | End of date range            | `2025-11-30`           |

**Response:**

```json
{
  "success": true,
  "data": {
    "behavior": "eating_food_platform",
    "hourlyDistribution": [
      { "hour": 6, "count": 12, "percentage": 2.1 },
      { "hour": 7, "count": 45, "percentage": 7.8 },
      { "hour": 8, "count": 89, "percentage": 15.5 },
      { "hour": 9, "count": 134, "percentage": 23.3 }
      // ... hours 10-20
    ],
    "peakHours": [9, 10, 18],
    "totalOccurrences": 574
  }
}
```

---

### 7. Enrichment Engagement

**Endpoint:** `GET /api/dashboard/enrichment`

**Purpose:** Track which enrichment objects are most engaged with.

**Query Parameters:**

| Parameter   | Type   | Required | Description         | Example          |
| ----------- | ------ | -------- | ------------------- | ---------------- |
| `aviary`    | string | Yes      | Aviary name         | `Sayyida's Cove` |
| `startDate` | date   | Yes      | Start of date range | `2025-11-01`     |
| `endDate`   | date   | Yes      | End of date range   | `2025-11-30`     |

**Response:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "object": "newspaper",
        "interactions": 127,
        "daysObserved": 18,
        "avgInteractionsPerDay": 7.1
      },
      {
        "object": "rope_ball",
        "interactions": 89,
        "daysObserved": 22,
        "avgInteractionsPerDay": 4.0
      }
      // ... more items
    ],
    "totalInteractions": 456
  }
}
```

---

### 8. Aggression Rate by Population Density

**Endpoint:** `GET /api/dashboard/aggression`

**Purpose:** Correlate aggression frequency with number of babies present.

**Query Parameters:**

| Parameter   | Type   | Required | Description         | Example          |
| ----------- | ------ | -------- | ------------------- | ---------------- |
| `aviary`    | string | Yes      | Aviary name         | `Sayyida's Cove` |
| `startDate` | date   | Yes      | Start of date range | `2025-04-01`     |
| `endDate`   | date   | Yes      | End of date range   | `2025-06-30`     |

**Response:**

```json
{
  "success": true,
  "data": {
    "densityLevels": [
      {
        "babiesPresent": 0,
        "totalSlots": 2847,
        "aggressionEvents": 12,
        "aggressionRate": 0.42
      },
      {
        "babiesPresent": 1,
        "totalSlots": 1523,
        "aggressionEvents": 45,
        "aggressionRate": 2.95
      },
      {
        "babiesPresent": 2,
        "totalSlots": 987,
        "aggressionEvents": 78,
        "aggressionRate": 7.9
      }
      // ... more density levels
    ],
    "correlation": {
      "trend": "positive",
      "strength": "strong",
      "note": "Aggression rate increases with population density"
    }
  }
}
```

---

### 9. Foster Parent Presence

**Endpoint:** `GET /api/dashboard/foster-parent`

**Purpose:** List observations where foster parent was present (for Phase 4+ analysis).

**Query Parameters:**

| Parameter   | Type    | Required | Description         | Example          |
| ----------- | ------- | -------- | ------------------- | ---------------- |
| `aviary`    | string  | Yes      | Aviary name         | `Sayyida's Cove` |
| `startDate` | date    | Yes      | Start of date range | `2025-04-01`     |
| `endDate`   | date    | Yes      | End of date range   | `2025-06-30`     |
| `limit`     | integer | No       | Max results         | `50`             |
| `offset`    | integer | No       | Pagination offset   | `0`              |

**Response:**

```json
{
  "success": true,
  "data": {
    "observations": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "observerName": "Alice",
        "observationDate": "2025-04-15",
        "babiesPresent": 2,
        "fosterParentPresent": true,
        "timeSlotCount": 12
      }
      // ... more observations
    ],
    "pagination": {
      "total": 234,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    },
    "summary": {
      "totalObservations": 234,
      "totalTimeSlots": 2847,
      "avgBabiesPresent": 1.8
    }
  }
}
```

---

### 10. Leaderboard (Phase 3+)

**Endpoint:** `GET /api/dashboard/leaderboard`

**Purpose:** Show top contributors by observation count (authenticated users only).

**Authentication:** Optional (shows all users if no auth, current user's rank if authenticated)

**Query Parameters:**

| Parameter   | Type    | Required | Description                  | Example |
| ----------- | ------- | -------- | ---------------------------- | ------- |
| `timeframe` | string  | No       | Time period (default: `all`) | `month` |
| `limit`     | integer | No       | Max results (default: 10)    | `25`    |

**Response:**

```json
{
  "success": true,
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "username": "Alice",
        "fullName": "Alice Johnson",
        "totalObservations": 127,
        "firstSubmission": "2025-01-15",
        "latestSubmission": "2025-11-24"
      },
      {
        "rank": 2,
        "username": "Bob",
        "fullName": "Bob Smith",
        "totalObservations": 98,
        "firstSubmission": "2025-02-01",
        "latestSubmission": "2025-11-23"
      }
      // ... more users
    ],
    "currentUser": {
      "rank": 15,
      "totalObservations": 23
    },
    "timeframe": "all"
  }
}
```

**Note:** Anonymous submissions are not included in the leaderboard.

---

## Request/Response Schemas

### Common Response Wrapper

All API responses follow this structure:

**Success:**

```json
{
  "success": true,
  "data": {
    /* endpoint-specific data */
  },
  "message": "Optional human-readable message"
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": [
      /* optional array of validation errors */
    ]
  }
}
```

---

## Error Handling

### Standard Error Codes

| Code                  | HTTP Status | Description                                     |
| --------------------- | ----------- | ----------------------------------------------- |
| `VALIDATION_ERROR`    | 400         | Request validation failed (see `details`)       |
| `INVALID_REQUEST`     | 400         | Malformed JSON or missing required fields       |
| `NOT_FOUND`           | 404         | Resource not found                              |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests from this IP                  |
| `EMAIL_SEND_FAILED`   | 500         | Email delivery failed (observation still saved) |
| `DATABASE_ERROR`      | 500         | Database operation failed                       |
| `INTERNAL_ERROR`      | 500         | Unexpected server error                         |

### Validation Error Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "timeSlots.15:00[0].behavior",
        "message": "Behavior is required",
        "value": ""
      },
      {
        "field": "emails[0]",
        "message": "Invalid email format",
        "value": "not-an-email"
      }
    ]
  }
}
```

### Retry-After Header

Rate limit responses include `Retry-After` header (in seconds):

```
HTTP/1.1 429 Too Many Requests
Retry-After: 3600
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 3600 seconds.",
    "retryAfter": 3600
  }
}
```

---

## Rate Limiting

### Phase 2: IP-Based Rate Limiting

| User Type | Limit                  | Window | Burst Allowance  |
| --------- | ---------------------- | ------ | ---------------- |
| Anonymous | 10 submissions         | 1 hour | 15 (short spike) |
| Anonymous | 100 dashboard requests | 1 hour | 150              |

### Phase 3+: Token-Based Rate Limiting

| User Type     | Limit                  | Window | Burst Allowance |
| ------------- | ---------------------- | ------ | --------------- |
| Authenticated | 50 submissions         | 1 hour | 75              |
| Authenticated | 500 dashboard requests | 1 hour | 750             |
| Anonymous     | Same as Phase 2        | -      | -               |

**Rate Limit Headers (all responses):**

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1700000000
```

**Implementation:** Use sliding window algorithm with Redis (or in-memory cache for Phase 2).

---

## Email Delivery

### Service Provider: Resend

**API:** https://resend.com/docs/api-reference

**From Address:** `noreply@ethogram.worldbirdsanctuary.org`

**Email Template:**

```
Subject: Your WBS Ethogram Observation - [Date] [Time]

Hi [Observer Name],

Thank you for submitting your behavioral observation of [Patient] at [Aviary]!

Observation Details:
- Date: [Observation Date]
- Time: [Start Time] - [End Time]
- Mode: [Live/VOD]
- Submitted: [Timestamp]

Your Excel file is attached. This file contains your observation data in the standard WBS ethogram format with metadata header rows and a behavioral matrix layout.

If you have any questions or notice any issues, please contact us at support@worldbirdsanctuary.org.

Thank you for contributing to our research!

World Bird Sanctuary Ethogram Team
```

### Excel File Generation

**File naming:** `WBS-Ethogram-[Observer]-[Date]-[ID].xlsx`

**Example:** `WBS-Ethogram-Alice-2025-11-24-550e8400.xlsx`

**Format:**

Single worksheet with a matrix layout matching the current WBS ethogram format that observers use:

- **Header rows:** Observer name, date, start/end time, mode, aviary
- **Time slot columns:** One column per 5-minute time slot (e.g., 15:00, 15:05, 15:10)
- **Behavior rows:** One row per field (behavior, location, notes, etc.)
- **Values:** Cell values show the observation data for each time slot

This format allows researchers to easily review data in a familiar spreadsheet layout and matches the existing manual ethogram forms.

**Process:**

1. Frontend submits observation → Backend saves to database
2. Backend generates Excel file using excelize (Go library: github.com/xuri/excelize)
3. Backend uploads Excel to Resend (as attachment)
4. Backend sends email via Resend API to all recipients
5. Backend returns success response to frontend

**Error Handling:**

- If email fails, observation is **still saved** to database
- Response indicates email failure, provides download link instead
- User can retry email delivery from "My Observations" page (Phase 3+)

### Email Retry Logic

**Retries:** 3 attempts with exponential backoff (1s, 2s, 4s)

**Failure response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "emailsSent": false,
    "downloadUrl": "/api/observations/550e8400-e29b-41d4-a716-446655440000/download"
  },
  "message": "Observation saved, but email delivery failed. Download link provided."
}
```

---

## Validation Rules

Server-side validation **must** match frontend rules for consistency.

### Metadata Validation

| Field                | Rule                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `observerName`       | Required, 2-32 characters, supports Discord/Twitch usernames and full names (letters, numbers, spaces, and symbols: . \_ -)           |
| `observationDate`    | Required, valid date, >= 2024-01-01, <= tomorrow                                                                                      |
| `startTime`          | Required, valid HH:MM (24-hour)                                                                                                       |
| `endTime`            | Required, valid HH:MM, must be > startTime                                                                                            |
| `aviary`             | Required, 1-255 characters                                                                                                            |
| `mode`               | Required, must be "live" or "vod"                                                                                                     |
| `babiesPresent`      | Required, integer >= 0                                                                                                                |
| `environmentalNotes` | Optional, max 5000 characters                                                                                                         |
| `emails`             | Can be omitted, set to `null`, or set to empty array `[]`. If provided as a non-empty array, must contain 1-10 valid email addresses. |

### Time Slots Validation

**Time Slot Generation:**

Time slots are generated in 5-minute intervals from `startTime` to `endTime`, **inclusive on both ends**. For example:

- Start: 10:00 AM, End: 10:10 AM → Generates 3 slots: 10:00, 10:05, 10:10

**Rules:**

- Must have at least 1 time slot
- Each time slot must have a `behavior` value
- Behavior must be a valid code from the frontend's `BEHAVIORS` constant
- Conditional fields validated based on behavior:
  - `location`: Required if behavior has `requiresLocation: true`
  - `object`: Required if behavior is `interacting_object`
  - `objectOther`: Required if `object === "other"`
  - `animal`: Required if behavior is `interacting_animal`
  - `animalOther`: Required if `animal === "other"`
  - `interactionType`: Required if behavior is `interacting_animal`
  - `interactionTypeOther`: Required if `interactionType === "other"`
  - `description`: Required if behavior has `requiresDescription: true`

### JSONB Structure Validation

**Database trigger validates:**

- `time_slots` must be a JSON object (not array or primitive)
- Each time slot must have an array of subjects
- Each subject must have required fields: `subjectType`, `subjectId`, `behavior`

---

## CORS Configuration

### Allowed Origins

**Production:**

```
https://ethogram.worldbirdsanctuary.org
```

**Development:**

```
http://localhost:5173
http://localhost:3000
```

### CORS Headers

```
Access-Control-Allow-Origin: https://ethogram.worldbirdsanctuary.org
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, Idempotency-Key
Access-Control-Max-Age: 86400
```

### Preflight Requests

**OPTIONS requests** return `204 No Content` with appropriate CORS headers.

---

## Idempotency

### Purpose

Prevent duplicate observation submissions due to:

- Network timeouts
- User clicking "Submit" multiple times
- Browser retries

### Implementation

**Client sends:**

```
POST /api/observations
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

**Server behavior:**

1. Check if `Idempotency-Key` exists in cache (Redis or in-memory)
2. If exists **and within 24 hours**, return cached response (200 OK, not 201)
3. If not exists, process request, cache response with key
4. Response includes `X-Idempotent-Replay: true` header if replayed

**Response (replayed):**

```
HTTP/1.1 200 OK
X-Idempotent-Replay: true
Content-Type: application/json

{
  "success": true,
  "data": { /* original response */ }
}
```

**TTL:** 24 hours (after which key is purged)

---

## Phase Roadmap

### Phase 2 (Current)

**Scope:** Anonymous submissions, email delivery, public dashboards

**Endpoints:**

- ✅ POST /api/observations (with email delivery)
- ✅ GET /api/observations (query with filters)
- ✅ GET /api/observations/:id (single observation)
- ✅ GET /api/dashboard/\* (all analytics endpoints)

**Features:**

- Single-subject observations (Sayyida only)
- Backend transformation (flat → array)
- Email delivery via Resend
- IP-based rate limiting
- CORS for frontend domain

---

### Phase 3 (Authentication)

**Scope:** Optional user accounts, leaderboard, submission history

**New Endpoints:**

- POST /api/auth/login (via Clerk/Supabase)
- POST /api/auth/logout
- GET /api/users/me (current user profile)
- GET /api/users/me/observations (personal history)

**Changes:**

- JWT authentication support
- User ID association with observations
- Leaderboard endpoint becomes functional
- Higher rate limits for authenticated users

---

### Phase 4 (Multi-Subject)

**Scope:** Support for foster parent + babies simultaneously

**Changes:**

- Frontend sends array structure directly (no more transformation layer)
- Backend removes transformation logic
- All endpoints support multi-subject queries
- New analytics for baby behavior patterns

**No new endpoints** - existing endpoints handle arrays natively

---

### Phase 5+ (Future)

**Potential features:**

- Multi-aviary support (more than just Sayyida's Cove)
- Real-time dashboard updates (WebSockets or SSE)
- Bulk data export (CSV, JSON)
- Mobile app support (additional CORS origins)
- Advanced filtering (date ranges, behavior combinations)

---

## Appendix

### Example cURL Commands

**Submit observation:**

```bash
curl -X POST https://api.ethogram.worldbirdsanctuary.org/api/observations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "observerName": "Alice",
    "observationDate": "2025-11-24",
    "startTime": "15:00",
    "endTime": "15:30",
    "aviary": "Sayyida'\''s Cove",
    "mode": "live",
    "babiesPresent": 0,
    "environmentalNotes": null,
    "timeSlots": {
      "15:00": [{
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
      }]
    },
    "emails": ["alice@example.com"]
  }'
```

**Query observations:**

```bash
curl "https://api.ethogram.worldbirdsanctuary.org/api/observations?aviary=Sayyida%27s+Cove&startDate=2025-11-01&endDate=2025-11-30&limit=10"
```

**Get behavior frequency:**

```bash
curl "https://api.ethogram.worldbirdsanctuary.org/api/dashboard/behaviors?aviary=Sayyida%27s+Cove&startDate=2025-11-01&endDate=2025-11-30"
```

---

**End of API Specification**
