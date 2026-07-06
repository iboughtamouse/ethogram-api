-- =============================================================================
-- Migration 005: seed the 2026 juvenile fosters + publish config version 2
-- =============================================================================
-- Review finding R1 (Phase 2 review checklist): the juveniles 187(B), 216(O),
-- and 253(R) and config v2 were applied to production by owner-authorized
-- hand-run SQL on 2026-07-06, leaving prod and the committed frontend
-- snapshot unreproducible from source. This migration makes a fresh
-- `db:migrate` rebuild that state.
--
-- Rosters are operational data and will move to the Phase 3 admin dashboard;
-- until then, migrations are the only version-controlled channel (the same
-- precedent as migration 003 seeding Sayyida).
--
-- Guard semantics (fix-review hardening): a bird already present under ANY
-- episode is skipped ENTIRELY — hand-managed prod state always wins, and the
-- insert can never collide with the no-overlapping-episodes EXCLUDE
-- constraint (which keys on name + date range, not the full unique tuple, so
-- an exact-tuple ON CONFLICT guard would not survive a hand-corrected
-- arrival date). This migration seeds fresh databases; it never reconciles
-- or resurrects existing rows.

INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
SELECT a.id, j.name, 'Barred Owl', 'juvenile', DATE '2026-06-01'
FROM aviaries a,
     (VALUES ('187(B)'), ('216(O)'), ('253(R)')) AS j(name)
WHERE a.slug = 'sayyidas-cove'
  AND NOT EXISTS (
    SELECT 1 FROM subjects s
    WHERE s.aviary_id = a.id AND s.name = j.name
  );

-- Publish only when the composed document actually differs from the latest
-- published version (a no-op on prod, where v2 already matches).
INSERT INTO config_versions (notes, config)
SELECT 'add juveniles 187(B), 216(O), 253(R) with Sayyida (arrived 2026-06-01)',
       compose_config()
WHERE compose_config() IS DISTINCT FROM
      (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1);
