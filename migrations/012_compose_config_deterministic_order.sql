-- Migration: 012_compose_config_deterministic_order.sql
-- Description: Make compose_config() array order a pure function of content by
--              giving every jsonb_agg a UNIQUE sort key. Several ORDER BYs used
--              non-unique columns (sort_order / excel_row_order, and subjects'
--              arrived_on+name), so tied rows were emitted in scan/heap order —
--              not part of the row content. That made compose_config()::text
--              (hence FU-9's md5 fingerprint) and the order-sensitive
--              identical / append-only gates non-deterministic once a tie
--              existed (e.g. two perches or two behavior groups sharing a
--              sort_order). No data change: the live catalog has no ties, so
--              this reproduces byte-identical output today and only prevents
--              future drift. CREATE OR REPLACE only — no schema/data migration.
-- Date: 2026-07-09

CREATE OR REPLACE FUNCTION compose_config() RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'behaviorGroups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', g.name, 'sortOrder', g.sort_order)
                       ORDER BY g.sort_order, g.name)
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
      ) ORDER BY b.excel_row_order, b.value)
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
                           ORDER BY d.sort_order, d.label)
          FROM aviary_perch_diagrams d WHERE d.aviary_id = a.id
        ), '[]'::jsonb),
        'perches', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'value', p.value,
            'label', p.label,
            'group', p.perch_group,
            'sortOrder', p.sort_order,
            'retired', p.retired_at IS NOT NULL
          ) ORDER BY p.sort_order, p.value)
          FROM perches p WHERE p.aviary_id = a.id
        ), '[]'::jsonb),
        'subjects', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', s.name,
            'species', s.species,
            'type', s.subject_type,
            'arrivedOn', to_char(s.arrived_on, 'YYYY-MM-DD'),
            'departedOn', to_char(s.departed_on, 'YYYY-MM-DD')
          ) ORDER BY s.arrived_on, s.name, s.subject_type)
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
