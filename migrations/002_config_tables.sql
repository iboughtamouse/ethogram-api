-- Migration: 002_config_tables.sql
-- Description: Config-as-data foundation (Phase 1 stage A) — aviaries, subjects,
--              vocabulary catalog + per-aviary enablement, perches, config versions.
--              Design: ethogram-notes/01-ACTIVE/config-as-data-phase1-design.md §2
-- Date: 2026-07-06

-- btree_gist provides GiST equality operators for the subjects overlap guard below
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =============================================================================
-- AVIARIES
-- =============================================================================

CREATE TABLE aviaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An aviary has multiple labeled perch diagrams (e.g. NE/SW halves)
CREATE TABLE aviary_perch_diagrams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aviary_id UUID NOT NULL REFERENCES aviaries(id),
  url TEXT NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (aviary_id, label)
);

-- =============================================================================
-- SUBJECTS (residency episodes — half-open [arrived_on, departed_on))
-- =============================================================================

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aviary_id UUID NOT NULL REFERENCES aviaries(id),
  name VARCHAR(255) NOT NULL,
  species VARCHAR(255) NOT NULL,
  subject_type VARCHAR(20) NOT NULL
    CHECK (subject_type IN ('foster_parent', 'juvenile', 'baby')),
  arrived_on DATE NOT NULL,
  departed_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_episode CHECK (departed_on IS NULL OR departed_on > arrived_on),
  UNIQUE (aviary_id, name, arrived_on, subject_type),
  -- One bird cannot have overlapping episodes in the same aviary.
  -- daterange() is half-open [), so a same-day transition
  -- (old departed_on = D, new arrived_on = D) does not collide.
  CONSTRAINT no_overlapping_episodes EXCLUDE USING gist (
    aviary_id WITH =,
    name WITH =,
    daterange(arrived_on, departed_on) WITH &&
  )
);

-- =============================================================================
-- VOCABULARY CATALOG (global; aviaries enable subsets via junctions)
-- =============================================================================

CREATE TABLE behavior_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE behaviors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value VARCHAR(100) UNIQUE NOT NULL,
  label VARCHAR(255) NOT NULL,
  group_id UUID NOT NULL REFERENCES behavior_groups(id),
  requires_location BOOLEAN NOT NULL DEFAULT false,
  requires_object BOOLEAN NOT NULL DEFAULT false,
  requires_object_interaction BOOLEAN NOT NULL DEFAULT false,
  requires_animal BOOLEAN NOT NULL DEFAULT false,
  requires_animal_interaction BOOLEAN NOT NULL DEFAULT false,
  requires_description BOOLEAN NOT NULL DEFAULT false,
  excel_row_label VARCHAR(255) NOT NULL,
  excel_row_order INTEGER NOT NULL,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vocab_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(30) NOT NULL
    CHECK (kind IN ('object', 'object_interaction', 'animal', 'animal_interaction')),
  value VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, value)
);

-- Per-aviary enablement junctions
CREATE TABLE aviary_behaviors (
  aviary_id UUID NOT NULL REFERENCES aviaries(id),
  behavior_id UUID NOT NULL REFERENCES behaviors(id),
  PRIMARY KEY (aviary_id, behavior_id)
);

CREATE TABLE aviary_vocab_options (
  aviary_id UUID NOT NULL REFERENCES aviaries(id),
  vocab_option_id UUID NOT NULL REFERENCES vocab_options(id),
  PRIMARY KEY (aviary_id, vocab_option_id)
);

-- =============================================================================
-- PERCHES (per-aviary)
-- =============================================================================

CREATE TABLE perches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aviary_id UUID NOT NULL REFERENCES aviaries(id),
  value VARCHAR(20) NOT NULL,
  label VARCHAR(255) NOT NULL,
  perch_group VARCHAR(100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (aviary_id, value)
);

-- =============================================================================
-- CONFIG VERSIONS (published, append-only snapshots of the resolved document)
-- =============================================================================

CREATE TABLE config_versions (
  id SERIAL PRIMARY KEY,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  config JSONB NOT NULL
);

-- =============================================================================
-- OBSERVATIONS: additive columns (both nullable — see design doc §7A/§7B)
-- =============================================================================

ALTER TABLE observations
  ADD COLUMN aviary_id UUID REFERENCES aviaries(id),
  ADD COLUMN config_version_id INTEGER REFERENCES config_versions(id);

-- =============================================================================
-- updated_at TRIGGERS (function defined in 001)
-- =============================================================================

CREATE TRIGGER update_aviaries_updated_at
  BEFORE UPDATE ON aviaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_aviary_perch_diagrams_updated_at
  BEFORE UPDATE ON aviary_perch_diagrams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subjects_updated_at
  BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_behavior_groups_updated_at
  BEFORE UPDATE ON behavior_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_behaviors_updated_at
  BEFORE UPDATE ON behaviors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vocab_options_updated_at
  BEFORE UPDATE ON vocab_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_perches_updated_at
  BEFORE UPDATE ON perches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- compose_config(): the resolved config document (read-API response body,
-- minus the version/publishedAt envelope which the endpoint adds from the row).
-- Single source of truth for both the seed (003) and scripts/publish-config.ts.
-- =============================================================================

-- Helpers first: sql-language function bodies are validated at CREATE time,
-- so these must exist before compose_config() references them.
CREATE OR REPLACE FUNCTION vocab_kind_json(p_kind text) RETURNS jsonb AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'value', v.value,
    'label', v.label,
    'retired', v.retired_at IS NOT NULL
  ) ORDER BY v.value), '[]'::jsonb)
  FROM vocab_options v WHERE v.kind = p_kind;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION aviary_vocab_kind_json(p_aviary_id uuid, p_kind text) RETURNS jsonb AS $$
  SELECT COALESCE(jsonb_agg(v.value ORDER BY v.value), '[]'::jsonb)
  FROM aviary_vocab_options av
  JOIN vocab_options v ON v.id = av.vocab_option_id
  WHERE av.aviary_id = p_aviary_id AND v.kind = p_kind;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION compose_config() RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'behaviorGroups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', g.name, 'sortOrder', g.sort_order)
                       ORDER BY g.sort_order)
      FROM behavior_groups g
    ), '[]'::jsonb),
    'behaviors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'value', b.value,
        'label', b.label,
        'group', g.name,
        'requiresLocation', b.requires_location,
        'requiresObject', b.requires_object,
        'requiresObjectInteraction', b.requires_object_interaction,
        'requiresAnimal', b.requires_animal,
        'requiresAnimalInteraction', b.requires_animal_interaction,
        'requiresDescription', b.requires_description,
        'excelRowLabel', b.excel_row_label,
        'excelRowOrder', b.excel_row_order,
        'retired', b.retired_at IS NOT NULL
      ) ORDER BY b.excel_row_order)
      FROM behaviors b JOIN behavior_groups g ON g.id = b.group_id
    ), '[]'::jsonb),
    'objects', vocab_kind_json('object'),
    'objectInteractionTypes', vocab_kind_json('object_interaction'),
    'animals', vocab_kind_json('animal'),
    'animalInteractionTypes', vocab_kind_json('animal_interaction'),
    'aviaries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', a.slug,
        'name', a.name,
        'isActive', a.is_active,
        'perchDiagrams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('url', d.url, 'label', d.label)
                           ORDER BY d.sort_order)
          FROM aviary_perch_diagrams d WHERE d.aviary_id = a.id
        ), '[]'::jsonb),
        'perches', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'value', p.value,
            'label', p.label,
            'group', p.perch_group,
            'sortOrder', p.sort_order,
            'retired', p.retired_at IS NOT NULL
          ) ORDER BY p.sort_order)
          FROM perches p WHERE p.aviary_id = a.id
        ), '[]'::jsonb),
        'subjects', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', s.name,
            'species', s.species,
            'type', s.subject_type,
            'arrivedOn', to_char(s.arrived_on, 'YYYY-MM-DD'),
            'departedOn', to_char(s.departed_on, 'YYYY-MM-DD')
          ) ORDER BY s.arrived_on, s.name)
          FROM subjects s WHERE s.aviary_id = a.id
        ), '[]'::jsonb),
        'vocabulary', jsonb_build_object(
          'behaviors', COALESCE((
            SELECT jsonb_agg(b.value ORDER BY b.value)
            FROM aviary_behaviors ab JOIN behaviors b ON b.id = ab.behavior_id
            WHERE ab.aviary_id = a.id
          ), '[]'::jsonb),
          'objects', aviary_vocab_kind_json(a.id, 'object'),
          'objectInteractionTypes', aviary_vocab_kind_json(a.id, 'object_interaction'),
          'animals', aviary_vocab_kind_json(a.id, 'animal'),
          'animalInteractionTypes', aviary_vocab_kind_json(a.id, 'animal_interaction')
        )
      ) ORDER BY a.slug)
      FROM aviaries a
    ), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION compose_config() IS
  'Resolved config document served by GET /api/config; frozen into config_versions.config at publish';
