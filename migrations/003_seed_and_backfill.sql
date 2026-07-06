-- Migration: 003_seed_and_backfill.sql
-- Description: Seed the config catalog from the frontend constants (as of 2026-07-06),
--              enable everything for Sayyida's Cove, publish config version 1, and
--              backfill observations.aviary_id + config_version_id.
--              Design: ethogram-notes/01-ACTIVE/config-as-data-phase1-design.md §7A
-- Date: 2026-07-06
--
-- Sources of the seeded values (single source of truth until stage E deletes them):
--   wbs-ethogram-form/src/constants/behaviors.js       (values, labels, groups, flags)
--   wbs-ethogram-form/src/constants/interactions.js    (four option lists)
--   wbs-ethogram-form/src/components/TimeSlotObservation.jsx  (perch labels/groups)
--   ethogram-api/src/services/excel.ts                 (excel row labels + order, incl. 5 legacy)

-- =============================================================================
-- BEHAVIOR GROUPS (order = BEHAVIOR_GROUP_ORDER)
-- =============================================================================

INSERT INTO behavior_groups (name, sort_order) VALUES
  ('Feeding', 1),
  ('Locomotion', 2),
  ('Resting', 3),
  ('Maintenance', 4),
  ('Social & Environmental', 5),
  ('Other', 6);

-- =============================================================================
-- BEHAVIORS (23 = 18 current + 5 legacy pre-cleanup values, retired).
-- excel_row_order preserves the exact insertion order of BEHAVIOR_ROW_MAPPING
-- so config-derived workbooks match the hardcoded generators row-for-row.
-- Legacy rows are retired as of the behavior cleanup (shipped 2026-07-05).
-- =============================================================================

INSERT INTO behaviors
  (value, label, group_id,
   requires_location, requires_object, requires_object_interaction,
   requires_animal, requires_animal_interaction, requires_description,
   excel_row_label, excel_row_order, retired_at)
VALUES
  ('eating', 'Eating',
   (SELECT id FROM behavior_groups WHERE name = 'Feeding'),
   true, false, false, false, false, false,
   'Eating (Note Location)', 1, NULL),
  ('walking', 'Locomotion - Walking',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   true, false, false, false, false, false,
   'Locomotion - Walking (Note Location)', 2, NULL),
  ('eating_food_platform', 'Eating - On Food Platform',
   (SELECT id FROM behavior_groups WHERE name = 'Feeding'),
   false, false, false, false, false, false,
   'Eating - On Food Platform', 3, '2026-07-05T00:00:00Z'),
  ('eating_elsewhere', 'Eating - Elsewhere (Note Location)',
   (SELECT id FROM behavior_groups WHERE name = 'Feeding'),
   true, false, false, false, false, false,
   'Eating - Elsewhere (Note Location)', 4, '2026-07-05T00:00:00Z'),
  ('walking_ground', 'Locomotion - Walking on Ground',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   false, false, false, false, false, false,
   'Locomotion - Walking on Ground', 5, '2026-07-05T00:00:00Z'),
  ('walking_perch', 'Locomotion - Walking on Perch (Note Location)',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   true, false, false, false, false, false,
   'Locomotion - Walking on Perch (Note Location)', 6, '2026-07-05T00:00:00Z'),
  ('aggression', 'Aggression or Defensive Posturing',
   (SELECT id FROM behavior_groups WHERE name = 'Social & Environmental'),
   false, false, false, false, false, false,
   'Aggression or Defensive Posturing', 7, '2026-07-05T00:00:00Z'),
  ('flying', 'Locomotion - Flying',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   false, false, false, false, false, false,
   'Locomotion - Flying', 8, NULL),
  ('jumping', 'Locomotion - Jumping',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   true, false, false, false, false, false,
   'Locomotion - Jumping', 9, NULL),
  ('repetitive_locomotion', 'Repetitive Locomotion (Same movement 3+ times)',
   (SELECT id FROM behavior_groups WHERE name = 'Locomotion'),
   true, false, false, false, false, false,
   'Repetitive Locomotion (Note Location)', 10, NULL),
  ('drinking', 'Drinking',
   (SELECT id FROM behavior_groups WHERE name = 'Maintenance'),
   false, false, false, false, false, false,
   'Drinking', 11, NULL),
  ('bathing', 'Bathing',
   (SELECT id FROM behavior_groups WHERE name = 'Maintenance'),
   false, false, false, false, false, false,
   'Bathing', 12, NULL),
  ('preening', 'Preening/Grooming',
   (SELECT id FROM behavior_groups WHERE name = 'Maintenance'),
   true, false, false, false, false, false,
   'Preening/Grooming (Note Location)', 13, NULL),
  ('repetitive_preening', 'Repetitive Preening/Feather Damage',
   (SELECT id FROM behavior_groups WHERE name = 'Maintenance'),
   true, false, false, false, false, false,
   'Repetitive Preening/Feather Damage (Note Location)', 14, NULL),
  ('nesting', 'Nesting',
   (SELECT id FROM behavior_groups WHERE name = 'Other'),
   false, false, false, false, false, false,
   'Nesting', 15, NULL),
  ('vocalizing', 'Vocalizing',
   (SELECT id FROM behavior_groups WHERE name = 'Social & Environmental'),
   true, false, false, false, false, false,
   'Vocalizing (Note Location)', 16, NULL),
  ('resting_alert', 'Resting on Perch/Ground - Alert',
   (SELECT id FROM behavior_groups WHERE name = 'Resting'),
   true, false, false, false, false, false,
   'Resting on Perch/Ground - Alert (Note Location)', 17, NULL),
  ('resting_not_alert', 'Resting on Perch/Ground - Not Alert',
   (SELECT id FROM behavior_groups WHERE name = 'Resting'),
   true, false, false, false, false, false,
   'Resting on Perch/Ground - Not Alert (Note Location)', 18, NULL),
  ('resting_unknown', 'Resting on Perch/Ground - Status Unknown',
   (SELECT id FROM behavior_groups WHERE name = 'Resting'),
   true, false, false, false, false, false,
   'Resting on Perch/Ground - Status Unknown (Note Location)', 19, NULL),
  ('interacting_object', 'Interacting with Inanimate Object',
   (SELECT id FROM behavior_groups WHERE name = 'Social & Environmental'),
   true, true, true, false, false, false,
   'Interacting with Inanimate Object (Note Location, Object & Interaction)', 20, NULL),
  ('interacting_animal', 'Interacting with Other Animal',
   (SELECT id FROM behavior_groups WHERE name = 'Social & Environmental'),
   true, false, false, true, true, false,
   'Interacting with Other Animal (Note Location, Animal & Interaction)', 21, NULL),
  ('not_visible', 'Not Visible',
   (SELECT id FROM behavior_groups WHERE name = 'Other'),
   false, false, false, false, false, false,
   'Not Visible', 22, NULL),
  ('other', 'Other',
   (SELECT id FROM behavior_groups WHERE name = 'Other'),
   false, false, false, false, false, true,
   'Other', 23, NULL);

-- =============================================================================
-- VOCAB OPTIONS (placeholders excluded — they are presentation, not domain)
-- =============================================================================

INSERT INTO vocab_options (kind, value, label) VALUES
  ('object', 'camera', 'Camera'),
  ('object', 'newspaper', 'Newspaper'),
  ('object', 'perch', 'Perch'),
  ('object', 'plant', 'Plant'),
  ('object', 'plastic_ball', 'Plastic Ball'),
  ('object', 'rope_ball', 'Rope Ball'),
  ('object', 'rubber_duck', 'Rubber Duck'),
  ('object', 'stump', 'Stump'),
  ('object', 'wooden_blocks', 'Wooden Blocks'),
  ('object', 'other', 'Other (specify below)'),
  ('object_interaction', 'biting', 'Biting/Chewing'),
  ('object_interaction', 'carrying', 'Carrying'),
  ('object_interaction', 'footing', 'Footing'),
  ('object_interaction', 'pouncing', 'Pouncing'),
  ('object_interaction', 'watching', 'Watching/Head Bobbing'),
  ('object_interaction', 'other', 'Other (specify below)'),
  ('animal', 'adult_aviary_occupant', 'Adult Aviary Occupant'),
  ('animal', 'human', 'Human'),
  ('animal', 'insect_within_aviary', 'Insect within Aviary'),
  ('animal', 'juvenile_aviary_occupant', 'Juvenile Aviary Occupant'),
  ('animal', 'potential_predator_outside', 'Potential Predator Outside Aviary'),
  ('animal', 'potential_prey_animal', 'Potential Prey Animal within Aviary'),
  ('animal', 'potential_prey_outside', 'Potential Prey Item Outside Aviary'),
  ('animal', 'same_species_outside', 'Same Species Outside Aviary'),
  ('animal', 'other', 'Other (specify below)'),
  ('animal_interaction', 'aggression_biting', 'Aggression: Biting'),
  ('animal_interaction', 'aggression_lunging', 'Aggression: Flying or Lunging At'),
  ('animal_interaction', 'aggression_footing', 'Aggression: Footing'),
  ('animal_interaction', 'aggression_other', 'Aggression: Other'),
  ('animal_interaction', 'defensive_posturing', 'Defensive Posturing or Beak Clacking'),
  ('animal_interaction', 'feeding', 'Feeding'),
  ('animal_interaction', 'non_aggressive_biting', 'Non-Aggressive Biting'),
  ('animal_interaction', 'non_aggressive_foot_grabbing', 'Non-Aggressive Foot Grabbing'),
  ('animal_interaction', 'playing', 'Playing'),
  ('animal_interaction', 'preening_grooming', 'Preening/Grooming'),
  ('animal_interaction', 'watching', 'Watching');

-- =============================================================================
-- SAYYIDA'S COVE + DIAGRAMS + PERCHES + SAYYIDA
-- =============================================================================

INSERT INTO aviaries (slug, name) VALUES ('sayyidas-cove', 'Sayyida''s Cove');

-- Diagram URLs are the form's existing same-origin assets for now; swapping to
-- R2 URLs later is an upload + republish, not a migration (design doc §8).
INSERT INTO aviary_perch_diagrams (aviary_id, url, label, sort_order) VALUES
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   '/images/perches-ne.png', 'NE Half (Perches 1-18)', 1),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   '/images/perches-sw.png', 'SW Half (Perches 19-31, BB, F, W)', 2);

-- Perches = union of VALID_PERCHES and the form's inline dropdown (which adds
-- 'Ground'); labels/groups mirror TimeSlotObservation.jsx exactly.
INSERT INTO perches (aviary_id, value, label, perch_group, sort_order) VALUES
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'Ground', 'Ground', 'Common Locations', 1);

INSERT INTO perches (aviary_id, value, label, perch_group, sort_order)
SELECT
  (SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
  n::text,
  'Perch ' || n,
  'Perches (1-31)',
  n + 1
FROM generate_series(1, 31) AS n;

INSERT INTO perches (aviary_id, value, label, perch_group, sort_order) VALUES
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'BB1', 'BB1 - North Baby Box', 'Baby Boxes', 33),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'BB2', 'BB2 - South Baby Box', 'Baby Boxes', 34),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'F1', 'F1 - Food Platform 1', 'Food Platforms', 35),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'F2', 'F2 - Food Platform 2', 'Food Platforms', 36),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'G', 'G - Ground', 'Other', 37),
  ((SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
   'W', 'W - Water Bowl', 'Other', 38);

-- COALESCE: fresh databases (dev clones, the CI Postgres service) have zero
-- observations, and a bare MIN() would be NULL. Any date <= the earliest
-- observation works; the floor matches the valid_date CHECK in 001.
INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on)
VALUES (
  (SELECT id FROM aviaries WHERE slug = 'sayyidas-cove'),
  'Sayyida',
  'Barred Owl',
  'foster_parent',
  COALESCE((SELECT MIN(observation_date) FROM observations), DATE '2024-01-01')
);

-- Enable the full catalog for Sayyida's Cove (retired entries included:
-- retirement hides them from menus, enablement scopes them to the aviary —
-- historical rows need legacy behaviors resolvable here).
INSERT INTO aviary_behaviors (aviary_id, behavior_id)
SELECT a.id, b.id FROM aviaries a CROSS JOIN behaviors b
WHERE a.slug = 'sayyidas-cove';

INSERT INTO aviary_vocab_options (aviary_id, vocab_option_id)
SELECT a.id, v.id FROM aviaries a CROSS JOIN vocab_options v
WHERE a.slug = 'sayyidas-cove';

-- =============================================================================
-- PUBLISH CONFIG VERSION 1
-- =============================================================================

INSERT INTO config_versions (notes, config)
VALUES ('Version 1 — seeded from frontend constants (config-as-data Phase 1 stage A)',
        compose_config());

-- =============================================================================
-- BACKFILL OBSERVATIONS
-- =============================================================================

UPDATE observations o
SET aviary_id = a.id
FROM aviaries a
WHERE o.aviary = a.name
  AND o.aviary_id IS NULL;

UPDATE observations
SET config_version_id = (SELECT MIN(id) FROM config_versions)
WHERE config_version_id IS NULL;

-- Surface any aviary strings the name-match missed (dev fixtures like
-- 'Test Aviary' land here by design — tolerated, not fatal). migrate.ts
-- forwards NOTICE output to the console.
DO $$
DECLARE
  unmatched_count integer;
  unmatched_values text;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT aviary, ', ')
  INTO unmatched_count, unmatched_values
  FROM observations WHERE aviary_id IS NULL;

  IF unmatched_count > 0 THEN
    RAISE NOTICE 'backfill: % observation row(s) with unmatched aviary value(s): %',
      unmatched_count, unmatched_values;
  ELSE
    RAISE NOTICE 'backfill: all observation rows matched an aviary';
  END IF;
END $$;
