-- =============================================================================
-- Migration 004: drop dormant observation columns (Phase 2 stage 2E, P2-D6)
-- =============================================================================
-- babies_present and environmental_notes were designed into the original
-- schema but never written by any app code. Verified dormant against
-- production twice (all rows 0/NULL — Phase 1 §7A pre-release verification
-- and the 2026-07-06 post-release check). Multi-subject entry (Phase 2)
-- records babies as first-class subjects instead of a count, and contextual
-- notes live per-observation in time_slots.
--
-- DROP COLUMN also removes the dependent index
-- (idx_observations_babies_present) and CHECK constraints automatically.

ALTER TABLE observations
  DROP COLUMN IF EXISTS babies_present,
  DROP COLUMN IF EXISTS environmental_notes;
