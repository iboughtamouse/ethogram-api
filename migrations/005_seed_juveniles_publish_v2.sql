-- =============================================================================
-- Migration 005: seed the 2026 juvenile fosters + publish config version 2
-- =============================================================================
-- Review finding R1 (Phase 2 review checklist): the juveniles 187(B), 216(O),
-- and 253(R) and config v2 were applied to production by owner-authorized
-- hand-run SQL on 2026-07-06, leaving prod and the committed frontend
-- snapshot unreproducible from source. This migration makes a fresh
-- `db:migrate` rebuild that state exactly.
--
-- Rosters are operational data and will move to the Phase 3 admin dashboard;
-- until then, migrations are the only version-controlled channel (the same
-- precedent as migration 003 seeding Sayyida). This migration is IDEMPOTENT
-- BY CONTENT so it is a no-op against production, where the rows already
-- exist:
--   - the subject inserts skip on the (aviary_id, name, arrived_on,
--     subject_type) unique constraint;
--   - the publish only fires when compose_config() differs from the latest
--     published document (on prod, v2 already matches).

INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
SELECT a.id, j.name, 'Barred Owl', 'juvenile', DATE '2026-06-01'
FROM aviaries a,
     (VALUES ('187(B)'), ('216(O)'), ('253(R)')) AS j(name)
WHERE a.slug = 'sayyidas-cove'
ON CONFLICT (aviary_id, name, arrived_on, subject_type) DO NOTHING;

INSERT INTO config_versions (notes, config)
SELECT 'add juveniles 187(B), 216(O), 253(R) with Sayyida (arrived 2026-06-01)',
       compose_config()
WHERE compose_config() IS DISTINCT FROM
      (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1);
