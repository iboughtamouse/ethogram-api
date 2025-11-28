# Database Schema Documentation

**Last Updated:** November 24, 2025
**Status:** Phase 2 Design - Ready for Implementation
**Database:** PostgreSQL 14+
**Purpose:** Multi-subject behavioral observation data for WBS ethogram project

---

## Table of Contents

1. [Overview](#overview)
2. [Core Schema](#core-schema)
3. [Supporting Tables](#supporting-tables)
4. [Indexes](#indexes)
5. [Constraints & Validation](#constraints--validation)
6. [Design Decisions](#design-decisions)
7. [Query Examples](#query-examples)
8. [Data Examples](#data-examples)
9. [Future Extensions](#future-extensions)
10. [Migration Strategy](#migration-strategy)

---

## Overview

### Purpose

This database stores behavioral observations of birds in aviaries at World Bird Sanctuary (WBS). The schema supports:

- **Multi-subject observations** - Track foster parent + multiple babies simultaneously
- **Time-series data** - 5-minute interval observations over extended periods
- **Flexible structure** - JSONB allows schema evolution without migrations
- **Anonymous submissions** - Authentication optional, core functionality public
- **Multiple aviaries** - Extensible for future multi-aviary deployments

### Key Design Principles

1. **Multi-subject from day 1** - Even though Phase 2 only tracks Sayyida, structure supports multiple subjects per time slot
2. **JSONB for flexibility** - Time slot observations are semi-structured and will evolve
3. **Searchable metadata in columns** - Common query fields (date, aviary, observer) are indexed columns
4. **Extensible** - Easy to add features (auth, baby tracking) without breaking changes
5. **PostgreSQL-native** - Leverage JSONB, GIN indexes, constraints, and triggers

### Phases

- **Phase 2** (Current): Foster parent only (Sayyida), anonymous submissions
- **Phase 3** (Future): Optional authentication, user accounts
- **Phase 4** (Future): Multi-subject observations (foster parent + babies)
- **Phase 5+** (Future): Multi-aviary management, admin CRUD

---

## Core Schema

### Table: `observations`

Primary table storing all behavioral observation sessions.

```sql
CREATE TABLE observations (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Observer metadata (searchable columns)
  observer_name VARCHAR(255) NOT NULL,
  observation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,

  -- Location context
  aviary VARCHAR(255) NOT NULL,
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('live', 'vod')),

  -- Population context (for baby season - Phase 4+)
  babies_present INTEGER NOT NULL DEFAULT 0 CHECK (babies_present >= 0),
  environmental_notes TEXT,

  -- Multi-subject observation data (JSONB structure)
  time_slots JSONB NOT NULL,

  -- Email delivery
  emails TEXT[],

  -- Timestamps (server time in UTC)
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- For Phase 3+ (auth) - ALWAYS NULLABLE (anonymous submissions supported)
  -- Note: Foreign key constraint will be added in Phase 3 migration
  user_id UUID,

  -- Constraints
  CONSTRAINT valid_time_range CHECK (end_time > start_time),
  CONSTRAINT valid_date CHECK (
    observation_date >= '2024-01-01'
    AND observation_date <= CURRENT_DATE + INTERVAL '1 day'
  ),
  CONSTRAINT valid_observer_name_length CHECK (
    length(observer_name) BETWEEN 2 AND 32
  ),
  CONSTRAINT valid_environmental_notes_length CHECK (
    environmental_notes IS NULL
    OR length(environmental_notes) <= 5000
  ),
  CONSTRAINT valid_emails CHECK (
    emails IS NULL
    OR (array_length(emails, 1) BETWEEN 1 AND 10)
  ),
  CONSTRAINT time_slots_is_object CHECK (jsonb_typeof(time_slots) = 'object')
);

-- Add table comment
COMMENT ON TABLE observations IS 'Behavioral observations of birds in aviaries, supporting multi-subject tracking';
```

### Column Descriptions

| Column                | Type         | Nullable | Description                                                                   |
| --------------------- | ------------ | -------- | ----------------------------------------------------------------------------- |
| `id`                  | UUID         | No       | Unique observation session identifier                                         |
| `observer_name`       | VARCHAR(255) | No       | Observer's name or username (Discord/Twitch handle), 2-32 characters          |
| `observation_date`    | DATE         | No       | Date of observation (not submission date)                                     |
| `start_time`          | TIME         | No       | Observation session start time (24-hour format)                               |
| `end_time`            | TIME         | No       | Observation session end time (24-hour format)                                 |
| `aviary`              | VARCHAR(255) | No       | Aviary name (e.g., "Sayyida's Cove")                                          |
| `mode`                | VARCHAR(10)  | No       | Observation mode: `live` or `vod`                                             |
| `babies_present`      | INTEGER      | No       | Total number of babies in aviary (0 if none)                                  |
| `environmental_notes` | TEXT         | Yes      | Freeform notes about context (weather, events, triggers), max 5000 characters |
| `time_slots`          | JSONB        | No       | Multi-subject observation data (see structure below)                          |
| `emails`              | TEXT[]       | Yes      | Array of email addresses for Excel delivery (1-10)                            |
| `submitted_at`        | TIMESTAMPTZ  | No       | When observation was submitted to backend (UTC)                               |
| `created_at`          | TIMESTAMPTZ  | No       | When database record was created (UTC)                                        |
| `updated_at`          | TIMESTAMPTZ  | No       | When database record was last updated (UTC)                                   |
| `user_id`             | UUID         | Yes      | User ID (Phase 3+, NULL = anonymous, FK added later)                          |

### `time_slots` JSONB Structure

The `time_slots` column stores multi-subject observations as a JSONB object:

```javascript
{
  "12:00": [
    {
      "subjectType": "foster_parent",
      "subjectId": "Sayyida",
      "behavior": "eating_food_platform",
      "location": "",
      "notes": "Alert, watching stream",
      "object": "",
      "objectOther": "",
      "animal": "",
      "animalOther": "",
      "interactionType": "",
      "interactionTypeOther": "",
      "description": ""
    },
    {
      "subjectType": "baby",
      "subjectId": "Baby",
      "behavior": "nesting",
      "location": "BB1",
      "notes": ""
    }
  ],
  "12:05": [ ... ],
  "12:10": [ ... ]
}
```

**Structure rules:**

- **Top-level keys**: Time strings in `HH:MM` format (24-hour)
- **Values**: Arrays of subject observations
- **Phase 2**: Each array contains 1 element (Sayyida only)
- **Phase 4+**: Each array contains N elements (foster parent + babies)

**Subject observation fields:**

- `subjectType`: `"foster_parent"` | `"baby"` | `"juvenile"`
- `subjectId`: Subject identifier (e.g., `"Sayyida"`, `"Baby"`)
- `behavior`: Behavior code (e.g., `"resting_alert"`, `"eating_food_platform"`)
- `location`: Location code (e.g., `"12"`, `"BB1"`, `"GROUND"`, or `""` if not required)
- `notes`: Freeform notes
- `object`: Inanimate object (when `behavior` is `"interacting_object"`)
- `objectOther`: Custom object description (when `object` is `"other"`)
- `animal`: Animal type (when `behavior` is `"interacting_animal"`)
- `animalOther`: Custom animal description (when `animal` is `"other"`)
- `interactionType`: Interaction type (when `behavior` is `"interacting_animal"`)
- `interactionTypeOther`: Custom interaction (when `interactionType` is `"other"`)
- `description`: Detailed description (for behaviors requiring description)

---

## Supporting Tables

### Table: `users` (Phase 3+)

User accounts for optional authentication.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE,
  full_name VARCHAR(255),

  -- Role-based access
  role VARCHAR(50) NOT NULL DEFAULT 'observer' CHECK (
    role IN ('observer', 'admin', 'researcher')
  ),

  -- Authentication (managed by Clerk/Supabase)
  external_auth_id VARCHAR(255) UNIQUE,

  -- Preferences
  preferred_email_delivery BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);

COMMENT ON TABLE users IS 'User accounts for authenticated observers (Phase 3+)';
COMMENT ON COLUMN users.external_auth_id IS 'Clerk user ID or Supabase auth.users.id';
```

**Notes:**

- Authentication is **optional** - anonymous submissions always supported
- `user_id` in `observations` table is **always nullable**
- Only authenticated users appear on leaderboard

---

## Indexes

### Primary Indexes

```sql
-- Date range queries (most common)
CREATE INDEX idx_observations_date_desc
  ON observations (observation_date DESC);

-- Aviary + date (for aviary-specific dashboards)
CREATE INDEX idx_observations_aviary_date
  ON observations (aviary, observation_date DESC);

-- Observer + date (for "my submissions" page - Phase 3+)
CREATE INDEX idx_observations_observer_date
  ON observations (observer_name, observation_date DESC);

-- Baby population queries (only index when babies present)
CREATE INDEX idx_observations_babies_present
  ON observations (babies_present)
  WHERE babies_present > 0;

-- User submissions (only index when authenticated)
CREATE INDEX idx_observations_user
  ON observations (user_id)
  WHERE user_id IS NOT NULL;
```

### JSONB Indexes

```sql
-- General JSONB queries (containment, key existence)
CREATE INDEX idx_observations_time_slots_gin
  ON observations USING GIN (time_slots);

-- Note: Partial indexes on JSONB with complex WHERE clauses are not supported.
-- The GIN index above covers all JSONB queries efficiently.
```

### Index Rationale

| Index                             | Purpose                     | Query Pattern                                                       |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| `idx_observations_date_desc`      | Fast date range queries     | `WHERE observation_date BETWEEN ... ORDER BY observation_date DESC` |
| `idx_observations_aviary_date`    | Aviary-specific dashboards  | `WHERE aviary = 'X' AND observation_date BETWEEN ...`               |
| `idx_observations_observer_date`  | Observer history            | `WHERE observer_name = 'X' ORDER BY observation_date DESC`          |
| `idx_observations_babies_present` | Population density analysis | `WHERE babies_present > 0`                                          |
| `idx_observations_time_slots_gin` | JSONB containment queries   | `WHERE time_slots @> '...'`                                         |

**Performance notes:**

- GIN indexes are larger but fast for JSONB queries
- Partial indexes (`WHERE` clause) save space by only indexing relevant rows
- Descending indexes (`DESC`) optimize `ORDER BY ... DESC LIMIT N` queries

---

## Constraints & Validation

### Check Constraints

```sql
-- Mode must be 'live' or 'vod'
CHECK (mode IN ('live', 'vod'))

-- End time must be after start time
CHECK (end_time > start_time)

-- Date must be in valid range (no future observations, reasonable past limit)
CHECK (
  observation_date >= '2024-01-01'
  AND observation_date <= CURRENT_DATE + INTERVAL '1 day'
)

-- Number of babies cannot be negative
CHECK (babies_present >= 0)

-- Email count must be 1-10 (or NULL for download-only submissions)
CHECK (
  emails IS NULL
  OR (array_length(emails, 1) BETWEEN 1 AND 10)
)

-- time_slots must be a JSON object (not array or primitive)
CHECK (jsonb_typeof(time_slots) = 'object')
```

### Trigger-Based Validation

```sql
-- Validate time_slots structure (array values, non-empty)
CREATE OR REPLACE FUNCTION validate_time_slots()
RETURNS TRIGGER AS $$
DECLARE
  slot_key TEXT;
  slot_value JSONB;
BEGIN
  -- Iterate through each time slot
  FOR slot_key, slot_value IN SELECT * FROM jsonb_each(NEW.time_slots)
  LOOP
    -- Check that value is an array
    IF jsonb_typeof(slot_value) != 'array' THEN
      RAISE EXCEPTION 'Time slot % must be an array of subjects', slot_key;
    END IF;

    -- Check that array is not empty
    IF jsonb_array_length(slot_value) = 0 THEN
      RAISE EXCEPTION 'Time slot % cannot have empty subject array', slot_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_time_slots_trigger
  BEFORE INSERT OR UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION validate_time_slots();
```

### Auto-Update Timestamp

```sql
-- Automatically update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_observations_updated_at
  BEFORE UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Design Decisions

### Why JSONB for `time_slots`?

**Decision:** Store multi-subject observations in JSONB rather than normalized tables.

**Rationale:**

- ✅ **Flexibility** - Behavior schema can evolve without migrations
- ✅ **Natural structure** - Matches frontend data shape (easy serialization)
- ✅ **Single query** - Fetch entire observation session in one SELECT
- ✅ **PostgreSQL optimization** - JSONB is binary, indexed, and queryable

**Tradeoff:**

- ❌ Harder to enforce strict schema validation (trigger needed)
- ❌ More complex queries (need to unnest arrays)

**Why we chose it:** Flexibility > strict schema for evolving behavioral catalog.

### Why Flat Metadata Columns?

**Decision:** Store `observer_name`, `observation_date`, `aviary`, etc. as top-level columns (not in JSONB).

**Rationale:**

- ✅ **Fast queries** - B-tree indexes on columns are faster than JSONB indexes
- ✅ **Sorting** - `ORDER BY observation_date DESC` is optimized
- ✅ **Aggregation** - `GROUP BY aviary` is trivial

**Tradeoff:**

- ❌ More columns to maintain

**Why we chose it:** Common query fields deserve first-class columns.

### Why UUIDs for IDs?

**Decision:** Use UUIDs (`gen_random_uuid()`) instead of serial integers.

**Rationale:**

- ✅ **Globally unique** - No collision risk across databases
- ✅ **Distributed-friendly** - Can generate IDs client-side (if needed)
- ✅ **Non-sequential** - Harder to guess/enumerate (minor security)

**Tradeoff:**

- ❌ Slightly larger (16 bytes vs 4-8 bytes)
- ❌ Less human-readable

**Why we chose it:** Standard for modern apps, worth the minor overhead.

### Why Optional Authentication?

**Decision:** `user_id` is always nullable, anonymous submissions always supported.

**Rationale:**

- ✅ **Low barrier to entry** - Anyone can submit observations
- ✅ **Community-friendly** - Twitch viewers don't need accounts
- ✅ **Future-proof** - Can add auth later without breaking anonymous flow

**Tradeoff:**

- ❌ Leaderboard can't verify identity (anonymous users excluded)

**Why we chose it:** Maximize participation > strict identity tracking.

### Why Infer Foster Parent Presence?

**Decision:** No `foster_parent_present` boolean column, infer from `time_slots` data.

**Rationale:**

- ✅ **Single source of truth** - Data tells us if foster parent present
- ✅ **Can't desync** - No risk of column saying "true" but data showing none
- ✅ **One less field** - Simpler schema

**Tradeoff:**

- ❌ Slightly slower queries (need to check JSONB)

**Why we chose it:** Data integrity > minor performance hit.

**Query example:**

```sql
-- Check if foster parent present (correct JSONB syntax)
SELECT
  id,
  EXISTS (
    SELECT 1
    FROM jsonb_each(time_slots) AS ts(time_key, subjects)
    WHERE subjects @> '[{"subjectType": "foster_parent"}]'
  ) AS foster_parent_present
FROM observations;
```

### Phase 2 Frontend-Backend Data Transformation

**Decision:** Database uses array structure `{"12:00": [{...}]}` even though Phase 2 frontend sends flat objects `{"12:00": {...}}`.

**Context:**

- **Phase 2 (Current):** Frontend only supports single-subject observations (Sayyida). Data is sent as flat objects per time slot:

  ```javascript
  {
    "12:00": {
      behavior: "resting_alert",
      location: "12",
      notes: "Alert, watching stream"
    }
  }
  ```

- **Phase 4 (Future):** Frontend will support multi-subject observations (foster parent + babies). Data will be sent as arrays:
  ```javascript
  {
    "12:00": [
      {
        subjectType: "foster_parent",
        subjectId: "Sayyida",
        behavior: "resting_alert",
        location: "12"
      },
      {
        subjectType: "baby",
        subjectId: "Baby",
        behavior: "eating_elsewhere",
        location: "BB1"
      }
    ]
  }
  ```

**Why Use Array Structure Now?**

- ✅ **No schema migration needed** - Phase 4 just adds more array elements
- ✅ **Future-proof** - Database ready for multi-subject from day 1
- ✅ **Clean separation** - Backend owns data shape, frontend adapts
- ✅ **Simpler queries** - All queries work the same for Phase 2 and Phase 4

**Transformation Strategy:**

**Phase 2 (MVP - Single Subject):**

- Frontend sends flat observation objects (no code changes required)
- Backend API wraps each observation in array before storing:

  ```javascript
  // API receives from frontend:
  { "12:00": { behavior: "resting_alert", location: "12" } }

  // API transforms before storing:
  {
    "12:00": [{
      subjectType: "foster_parent",
      subjectId: "Sayyida",  // Hardcoded for Phase 2
      behavior: "resting_alert",
      location: "12"
    }]
  }
  ```

- Backend API unwraps array when returning data to frontend:

  ```javascript
  // Database stores:
  { "12:00": [{ subjectType: "foster_parent", ... }] }

  // API returns to frontend:
  { "12:00": { behavior: "resting_alert", location: "12" } }
  ```

**Phase 4 (Multi-Subject):**

- Frontend updated to send array structure directly
- Backend removes transformation layer
- No database migration required

**Frontend Changes Needed (Phase 4):**

1. **Update `formStateManager.js`:**
   - Change `createEmptyObservation()` to return object with `subjectType`, `subjectId`
   - Update `observations` state structure to support arrays per time slot

2. **Update UI components:**
   - Support multiple subject observations per time slot
   - Add subject selector UI (foster parent vs babies)
   - Handle dynamic subject addition/removal

3. **Update validation:**
   - Validate each subject in array independently
   - Ensure at least one subject per time slot

4. **Update Excel export:**
   - One row per subject per time slot (instead of one row per time slot)

**Migration Path:**

```
Phase 2: Frontend (flat) → API (transform) → Database (array)
Phase 3: (No changes, add auth)
Phase 4: Frontend (array) → API (passthrough) → Database (array)
```

**Why We Deferred Frontend Changes:**

- ❌ **Breaking change** - Would require rewriting state management, validation, UI
- ❌ **No current need** - Phase 2 only has one subject (Sayyida)
- ❌ **Testing burden** - Comprehensive test suite would need updates
- ✅ **Backend ready** - Database schema already supports multi-subject
- ✅ **Clean cutover** - Phase 4 frontend changes are isolated, low risk

**Tradeoff:**

- ❌ Backend transformation adds complexity (wrapping/unwrapping)
- ❌ Two different data shapes during transition period

**Why we chose it:** Minimize Phase 2 risk, defer complexity until needed.

---

## Query Examples

### 1. Get All Observations for Date Range

```sql
SELECT
  id,
  observer_name,
  observation_date,
  start_time,
  end_time,
  aviary,
  babies_present
FROM observations
WHERE aviary = 'Sayyida''s Cove'
  AND observation_date BETWEEN '2025-11-01' AND '2025-11-30'
ORDER BY observation_date DESC, start_time DESC;
```

### 2. Count Behaviors for Foster Parent

```sql
SELECT
  subject->>'behavior' AS behavior,
  COUNT(*) AS count
FROM observations,
  jsonb_each(time_slots) AS ts(time_key, subjects),
  jsonb_array_elements(subjects) AS subject
WHERE aviary = 'Sayyida''s Cove'
  AND observation_date BETWEEN '2025-11-01' AND '2025-11-30'
  AND subject->>'subjectType' = 'foster_parent'
GROUP BY subject->>'behavior'
ORDER BY count DESC;
```

### 3. Location Heatmap (Most-Used Perches)

```sql
SELECT
  subject->>'location' AS location,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM observations,
  jsonb_each(time_slots) AS ts(time_key, subjects),
  jsonb_array_elements(subjects) AS subject
WHERE aviary = 'Sayyida''s Cove'
  AND observation_date BETWEEN '2025-11-01' AND '2025-11-30'
  AND subject->>'subjectType' = 'foster_parent'
  AND subject->>'location' IS NOT NULL
GROUP BY subject->>'location'
ORDER BY count DESC;
```

### 4. Aggression Rate by Population Density

```sql
WITH aggression_slots AS (
  SELECT
    o.babies_present,
    COUNT(*) AS total_slots,
    COUNT(*) FILTER (
      WHERE subject->>'behavior' LIKE '%aggression%'
         OR subject->>'behavior' LIKE '%conflict%'
    ) AS aggression_events
  FROM observations o,
    jsonb_each(o.time_slots) AS ts(time_key, subjects),
    jsonb_array_elements(subjects) AS subject
  WHERE o.aviary = 'Sayyida''s Cove'
    AND o.babies_present > 0
    AND subject->>'subjectType' = 'baby'
  GROUP BY o.babies_present
)
SELECT
  babies_present,
  total_slots,
  aggression_events,
  ROUND(100.0 * aggression_events / NULLIF(total_slots, 0), 2) AS aggression_rate
FROM aggression_slots
ORDER BY babies_present;
```

### 5. Observations with Foster Parent Present

```sql
SELECT
  id,
  observer_name,
  observation_date,
  babies_present
FROM observations
WHERE aviary = 'Sayyida''s Cove'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(time_slots) AS ts(time_key, subjects)
    WHERE subjects @> '[{"subjectType": "foster_parent"}]'
  )
ORDER BY observation_date DESC;
```

### 6. Enrichment Engagement Frequency

```sql
SELECT
  subject->>'object' AS enrichment_item,
  COUNT(*) AS interactions,
  COUNT(DISTINCT o.observation_date) AS days_observed
FROM observations o,
  jsonb_each(o.time_slots) AS ts(time_key, subjects),
  jsonb_array_elements(subjects) AS subject
WHERE o.aviary = 'Sayyida''s Cove'
  AND subject->>'behavior' = 'interacting_object'
  AND subject->>'object' IS NOT NULL
  AND subject->>'object' != ''
GROUP BY subject->>'object'
ORDER BY interactions DESC;
```

### 7. Leaderboard (Authenticated Users Only)

```sql
SELECT
  u.username,
  u.full_name,
  COUNT(o.id) AS total_observations,
  MIN(o.observation_date) AS first_submission,
  MAX(o.observation_date) AS latest_submission
FROM users u
JOIN observations o ON o.user_id = u.id
WHERE o.aviary = 'Sayyida''s Cove'
GROUP BY u.id, u.username, u.full_name
ORDER BY total_observations DESC
LIMIT 10;
```

---

## Data Examples

### Phase 2 Example (Sayyida Only)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "observer_name": "Alice",
  "observation_date": "2025-11-23",
  "start_time": "15:00",
  "end_time": "15:30",
  "aviary": "Sayyida's Cove",
  "mode": "live",
  "babies_present": 0,
  "environmental_notes": null,
  "time_slots": {
    "15:00": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "resting_alert",
        "location": "12",
        "notes": "Alert, watching stream chat",
        "object": "",
        "animal": "",
        "interactionType": "",
        "description": ""
      }
    ],
    "15:05": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "preening",
        "location": "12",
        "notes": ""
      }
    ],
    "15:10": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "flying",
        "location": "BB1",
        "notes": "Short flight to bird bath"
      }
    ]
  },
  "emails": ["observer@example.com"],
  "submitted_at": "2025-11-23T20:15:00Z",
  "created_at": "2025-11-23T20:15:05Z",
  "updated_at": "2025-11-23T20:15:05Z",
  "user_id": null
}
```

### Phase 4 Example (Sayyida + 2 Babies)

**Note on Baby Identifiers:** All babies use generic `subjectId: "Baby"` because observers cannot reliably distinguish individual babies across time slots within a session. Using distinct identifiers (Baby1, Baby2) would imply tracking capability that doesn't exist, leading to inconsistent or misleading data. The `babies_present` count captures the total number without requiring individual identification.

```json
{
  "id": "660f9511-f3ac-52e5-b827-557766551111",
  "observer_name": "Bob",
  "observation_date": "2025-04-15",
  "start_time": "10:00",
  "end_time": "10:10",
  "aviary": "Sayyida's Cove",
  "mode": "live",
  "babies_present": 2,
  "environmental_notes": "First day babies out of nest box, sunny weather",
  "time_slots": {
    "10:00": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "resting_alert",
        "location": "BB1",
        "notes": "Keeping eye on babies"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "resting_alert",
        "location": "5",
        "notes": "First time on this perch"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "nesting",
        "location": "BB1",
        "notes": "Still hesitant to leave"
      }
    ],
    "10:05": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "interacting_animal",
        "location": "BB1",
        "animal": "juvenile_aviary_occupant",
        "interactionType": "feeding",
        "notes": "Feeding hesitant baby"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "walking_ground",
        "location": "GROUND",
        "notes": "Jumped down, first time on ground"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "eating_elsewhere",
        "location": "BB1",
        "notes": "Being fed by Sayyida"
      }
    ],
    "10:10": [
      {
        "subjectType": "foster_parent",
        "subjectId": "Sayyida",
        "behavior": "resting_unknown",
        "location": "12",
        "notes": "Back to favorite perch"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "vocalizing",
        "location": "GROUND",
        "notes": "Calling for parent"
      },
      {
        "subjectType": "baby",
        "subjectId": "Baby",
        "behavior": "resting_not_alert",
        "location": "BB1",
        "notes": "Full and sleepy after feeding"
      }
    ]
  },
  "emails": ["observer@example.com", "wbs@worldbirdsanctuary.org"],
  "submitted_at": "2025-04-15T10:15:00Z",
  "created_at": "2025-04-15T10:15:05Z",
  "updated_at": "2025-04-15T10:15:05Z",
  "user_id": "770e8511-a2bc-62f6-c937-668877662222"
}
```

---

## Future Extensions

### Phase 3: Authentication

Add user accounts (optional):

```sql
-- Already defined in Supporting Tables section
CREATE TABLE users ( ... );

-- observations.user_id already exists (nullable)
```

### Phase 4: Baby Season

Current schema already supports multi-subject! No migration needed, just:

- Frontend sends multiple subjects per time slot
- Backend validates array structure (already done via trigger)
- Dashboard queries unnest arrays (examples provided)

### Phase 5+: Multi-Aviary Management

When admin CRUD for aviaries is needed:

```sql
-- Create aviaries reference table
CREATE TABLE aviaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Populate with existing aviaries
INSERT INTO aviaries (name)
SELECT DISTINCT aviary FROM observations;

-- Add foreign key constraint
ALTER TABLE observations
  ADD CONSTRAINT fk_aviary
  FOREIGN KEY (aviary) REFERENCES aviaries(name);
```

### Potential Future Tables

**`enrichment_items`** (catalog of available enrichment):

```sql
CREATE TABLE enrichment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aviary VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  introduced_date DATE,
  removed_date DATE,
  is_active BOOLEAN DEFAULT true
);
```

**`subjects`** (individual baby tracking, if needed):

```sql
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  subject_type VARCHAR(50) NOT NULL,
  species VARCHAR(100) NOT NULL,
  birth_date DATE,
  current_aviary VARCHAR(255),
  is_active BOOLEAN DEFAULT true
);
```

---

## Migration Strategy

### Initial Migration (Phase 2)

```sql
-- File: migrations/001_initial_schema.sql

-- Create observations table
CREATE TABLE observations ( ... );  -- Full schema from Core Schema section

-- Create indexes
CREATE INDEX idx_observations_date_desc ON observations (observation_date DESC);
CREATE INDEX idx_observations_aviary_date ON observations (aviary, observation_date DESC);
-- ... (all indexes from Indexes section)

-- Create validation triggers
CREATE OR REPLACE FUNCTION validate_time_slots() RETURNS TRIGGER AS $$ ... $$;
CREATE TRIGGER validate_time_slots_trigger ...

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ ... $$;
CREATE TRIGGER update_observations_updated_at ...

-- Add comments
COMMENT ON TABLE observations IS 'Behavioral observations of birds in aviaries';
COMMENT ON COLUMN observations.time_slots IS 'JSONB array structure: {time: [subject observations]}';
-- ... (all comments)
```

### Phase 3 Migration (Add Users)

```sql
-- File: migrations/002_add_users.sql

-- Create users table
CREATE TABLE users ( ... );  -- Full schema from Supporting Tables section

-- Create indexes
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_external_auth ON users (external_auth_id);

-- Add foreign key constraint to existing user_id column
ALTER TABLE observations
  ADD CONSTRAINT fk_observations_user
  FOREIGN KEY (user_id) REFERENCES users(id)
  ON DELETE SET NULL;  -- Preserve observation if user deleted
```

### Phase 5+ Migration (Add Aviaries Table)

```sql
-- File: migrations/003_add_aviaries.sql

-- Create aviaries table
CREATE TABLE aviaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Populate with existing aviaries from observations
INSERT INTO aviaries (name)
SELECT DISTINCT aviary FROM observations;

-- Add foreign key (data already valid, so constraint won't fail)
ALTER TABLE observations
  ADD CONSTRAINT fk_observations_aviary
  FOREIGN KEY (aviary) REFERENCES aviaries(name);
```

### Migration Best Practices

1. **Incremental migrations** - One logical change per file
2. **Named files** - `NNN_descriptive_name.sql` (e.g., `001_initial_schema.sql`)
3. **Idempotent where possible** - Use `CREATE IF NOT EXISTS` when supported
4. **Test on copy** - Always test migrations on database copy first
5. **Backup before migrate** - Always backup production before running migrations
6. **Document breaking changes** - If API contract changes, document in migration

---

## Validation Layers

This schema implements **defense in depth** with three validation layers:

### Layer 1: Client-Side Validation (UX)

- Immediate feedback to user
- Prevents bad UX (waiting for server error)
- **Can be bypassed** (not security)

### Layer 2: Server-Side Validation (Security)

- Enforces business rules
- Returns structured error messages
- **Cannot be bypassed** (trusted layer)

### Layer 3: Database Validation (Safety Net)

- Data integrity guarantees
- Protects against API bugs
- **Last line of defense**

**Example:**

```
User submits future date (2030-01-01):
  ❌ Client: Catches it, shows error
  (If client bypassed)
  ❌ Server: Catches it, returns 400
  (If server buggy)
  ❌ Database: CHECK constraint fails, prevents INSERT
```

---

## Schema Strengths

✅ **Flexible** - JSONB allows schema evolution
✅ **Performant** - Indexed columns for common queries
✅ **Extensible** - Easy to add auth, aviaries, subjects
✅ **Safe** - Multi-layer validation prevents bad data
✅ **Future-proof** - Supports Phase 2 → Phase 4+ without breaking changes
✅ **PostgreSQL-optimized** - Leverages JSONB, GIN indexes, triggers

---

## Schema Limitations

⚠️ **JSONB validation is complex** - Trigger needed for strict validation
⚠️ **Unnesting arrays is verbose** - Queries need multiple joins/unnests
⚠️ **No schema enforcement** - JSONB structure can drift (mitigated by trigger)
⚠️ **Individual baby tracking limited** - Babies not individually identified (by design)

---

## Conclusion

This schema provides a solid foundation for the WBS Ethogram project:

- **Phase 2-ready** - Can implement immediately with PostgreSQL 14+
- **Phase 4-ready** - Multi-subject structure already in place
- **Extensible** - Clean migration path for future features
- **Performant** - Proper indexes for dashboard queries
- **Safe** - Multi-layer validation protects data integrity

For questions or proposed changes, update this document and bump the "Last Updated" date.

---

**Document Version:** 1.0.0
**Next Review:** After Phase 2 implementation complete
