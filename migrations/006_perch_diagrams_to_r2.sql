-- =============================================================================
-- Migration 006: point Sayyida's Cove perch diagrams at R2 + publish config v3
-- =============================================================================
-- The perch-diagram images moved from the form's bundled /images/perches-*.png
-- assets to a public Cloudflare R2 bucket (Phase 1 design §8 / the R2 runbook).
-- Done as a migration rather than the runbook's hand-run SQL, for the same
-- reproducibility reason as migration 005 (the juvenile roster): a fresh
-- `db:migrate` rebuilds the published R2 config exactly, so prod/dev/CI don't
-- diverge and the state is versioned in source.
--
-- Serving format: webp (~7x smaller than the png; universal browser support).
-- The matching png is uploaded alongside it in R2 as a fallback but is not
-- referenced here — PerchDiagramModal renders the single config URL as-is
-- (Phase 2 §1), so the config carries one URL per labeled diagram.
--
-- Idempotent by content: the UPDATEs are no-ops once a url already matches, and
-- the publish only fires when compose_config() differs from the latest
-- published version (a no-op on any DB already at this config).

UPDATE aviary_perch_diagrams d
  SET url = 'https://pub-f2f3822bc5384a4a9b824b196e990a21.r2.dev/perch-diagram-sayyidas-cove-ne-half-v1.webp'
  FROM aviaries a
  WHERE d.aviary_id = a.id
    AND a.slug = 'sayyidas-cove'
    AND d.label = 'NE Half (Perches 1-18)';

UPDATE aviary_perch_diagrams d
  SET url = 'https://pub-f2f3822bc5384a4a9b824b196e990a21.r2.dev/perch-diagram-sayyidas-cove-sw-half-v1.webp'
  FROM aviaries a
  WHERE d.aviary_id = a.id
    AND a.slug = 'sayyidas-cove'
    AND d.label = 'SW Half (Perches 19-31, BB, F, W)';

INSERT INTO config_versions (notes, config)
SELECT 'perch diagrams -> R2 (webp)', compose_config()
WHERE compose_config() IS DISTINCT FROM
      (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1);
