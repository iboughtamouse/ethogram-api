-- =============================================================================
-- Migration 011: drop the observation `mode` column (live/vod)
-- =============================================================================
-- `mode` recorded whether an observation was logged from a live stream or a
-- VOD. Since the December 2025 timezone-handling removal, both paths store the
-- video timestamp verbatim, so `mode` drives no data transform -- it was inert
-- metadata carried in the payload, stamped into this column, and surfaced only
-- in the admin Submissions list. The form's live/VOD selector was removed in
-- the metadata-cleanup pass; no app code writes or reads `mode` any longer.
--
-- DROP COLUMN also removes the dependent CHECK constraint (mode IN
-- ('live','vod')) automatically. Existing historical values are discarded by
-- design: confirmed inert against the date/time/observation data they
-- accompany (they never affected storage, Excel output, or email).

ALTER TABLE observations
  DROP COLUMN IF EXISTS mode;
