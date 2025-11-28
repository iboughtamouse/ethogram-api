-- Rollback initial schema

-- Drop triggers
DROP TRIGGER IF EXISTS update_observations_updated_at ON observations;
DROP TRIGGER IF EXISTS validate_time_slots_trigger ON observations;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS validate_time_slots();

-- Drop indexes
DROP INDEX IF EXISTS idx_observations_time_slots_gin;
DROP INDEX IF EXISTS idx_observations_user;
DROP INDEX IF EXISTS idx_observations_babies_present;
DROP INDEX IF EXISTS idx_observations_observer_date;
DROP INDEX IF EXISTS idx_observations_aviary_date;
DROP INDEX IF EXISTS idx_observations_date_desc;

-- Drop table
DROP TABLE IF EXISTS observations;
