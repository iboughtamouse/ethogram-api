-- Migration: 001_initial_schema.sql
-- Description: Create observations table with all constraints, indexes, and triggers
-- Date: 2025-11-29

-- =============================================================================
-- OBSERVATIONS TABLE
-- =============================================================================

CREATE TABLE observations (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Observer metadata
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

COMMENT ON TABLE observations IS 'Behavioral observations of birds in aviaries, supporting multi-subject tracking';
COMMENT ON COLUMN observations.time_slots IS 'JSONB object structure: {"HH:MM": [subject observations]}';

-- =============================================================================
-- INDEXES
-- =============================================================================

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

-- General JSONB queries (containment, key existence)
CREATE INDEX idx_observations_time_slots_gin
  ON observations USING GIN (time_slots);

-- =============================================================================
-- TRIGGER FUNCTIONS
-- =============================================================================

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

-- Automatically update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE TRIGGER validate_time_slots_trigger
  BEFORE INSERT OR UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION validate_time_slots();

CREATE TRIGGER update_observations_updated_at
  BEFORE UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
