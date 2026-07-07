-- Migration: 008_admin_editing.sql
-- Description: Phase 3 stage 3C — editing + publish support: the audit log
--              (P3-D5, every admin mutation is attributed) and
--              config_versions.published_by (NULL = published by an
--              engineering script, i.e. versions that predate the dashboard).
--              Design: ethogram-notes/01-ACTIVE/config-as-data-phase3-design.md §3
-- Date: 2026-07-07

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  action VARCHAR(50) NOT NULL,
  entity VARCHAR(50) NOT NULL,
  entity_id TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, created_at);

ALTER TABLE config_versions
  ADD COLUMN published_by UUID REFERENCES admin_users(id);

COMMENT ON COLUMN config_versions.published_by IS
  'Admin who published via the dashboard; NULL = engineering script (pre-dashboard versions)';
