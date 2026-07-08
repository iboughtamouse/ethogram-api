-- =============================================================================
-- Migration 007: re-catalog Sayyida's Cove perches + 3 new diagrams, publish v4
-- =============================================================================
-- WBS added perches and re-issued the perch diagrams (owner, 2026-07-08). The
-- new set: numbered perches 1-37 with descriptive labels, the hyphenated
-- specials (F-1/F-2, BB-1/BB-2, FB-1/FB-2, RoW-U/M/L, TH-R/TH-T), and three
-- diagram views (Eastern Perimeter / North-Western & Central / South-Western &
-- Central) replacing the old two (NE Half / SW Half).
--
-- Append-only compliant (configDiff.appendOnlyViolations):
--   * values 1-31 are RELABELLED in place (values unchanged — label changes are
--     allowed; only 1-5 are referenced by real observations, which render against
--     their stamped version regardless);
--   * the old-format specials BB1/BB2/F1/F2 and the reconciliation dup "Ground"
--     are RETIRED, not deleted (they stay resolvable for historical rows — F1 is
--     referenced by one observation);
--   * everything else is added.
-- Diagrams aren't governed by the value-immutability rule, so the two old rows
-- are replaced by the three new ones (old config versions keep their frozen URLs).
--
-- Done as a migration (not the admin dashboard) because it's a ~50-entry bulk
-- re-catalog PLUS a diagram swap the dashboard can't do yet (3D). Idempotent by
-- content: the upserts set the same values on re-run and the publish only fires
-- when compose_config() differs from the latest published version.

-- --- 1. Numbered perches 1-37 (reuse 1-31, add 32-37); group "Perches" -------
INSERT INTO perches (aviary_id, value, label, perch_group, sort_order)
SELECT a.id, np.value, np.label, 'Perches', np.sort_order
FROM aviaries a,
     (VALUES
        ('1','High SE Turfed Corner Perch',1),
        ('2','Highest SE Stick Ramp',2),
        ('3','Upper SE Turfed Wall Perch',3),
        ('4','Middle SE Stick Ramp',4),
        ('5','Lower SE Turfed Wall Perch',5),
        ('6','Lower SE Stick Ramp',6),
        ('7','Stick Ramp to Inside of Tiny Hut',7),
        ('8','Lower NE Rope Ramp',8),
        ('9','NE Stick Wall Perch',9),
        ('10','Upper NE Rope Ramp',10),
        ('11','High NE Turfed Corner Perch',11),
        ('12','Upper N Wall Stick Perch',12),
        ('13','Lower N Wall Stick Perch (Mostly obscured by post)',13),
        ('14','Middle Stick Perch on N Central Support Post',14),
        ('15','Long Turfed Perch Between N Central/W Support Posts',15),
        ('16','High Stick Perch on N Central Support Post',16),
        ('17','High Stick Perch on NW Support Post',17),
        ('18','Low Stick Perch on N Central Support Post',18),
        ('19','High Stick Perch on Central E Support Post',19),
        ('20','Middle Stick Perch on Central E Support Post',20),
        ('21','Long Turfed Perch Between E Support Posts',21),
        ('22','Middle Stick Perch on NW Support Post',22),
        ('23','Long Turf Perch in Front of Baby Boxes',23),
        ('24','Low Stick Perch on E Central Support Post',24),
        ('25','Low Stick Perch on Central S Support Post',25),
        ('26','W Turf Perch on Central S Support Post',26),
        ('27','E Turf Perch on SW Support Post',27),
        ('28','Low Stick Perch on SW Support Post',28),
        ('29','High Stick Perch on Central S Support Post',29),
        ('30','High Stick Perch on SW Support Post',30),
        ('31','Upper-Middle Stick Perch on Central S Support Post',31),
        ('32','Lower-Middle Stick Perch on Central S Support Post',32),
        ('33','Stick Ramp to Baby Boxes',33),
        ('34','E Turf Perch on Central S Support Post',34),
        ('35','W Turf Perch on SE Support Post',35),
        ('36','High Stick Perch on SE Support Post',36),
        ('37','S Wall Stick Perch',37)
     ) AS np(value, label, sort_order)
WHERE a.slug = 'sayyidas-cove'
ON CONFLICT (aviary_id, value) DO UPDATE
  SET label = EXCLUDED.label, perch_group = EXCLUDED.perch_group,
      sort_order = EXCLUDED.sort_order, retired_at = NULL;

-- --- 2. Special locations (new hyphenated specials + relabelled W/G) ---------
INSERT INTO perches (aviary_id, value, label, perch_group, sort_order)
SELECT a.id, sp.value, sp.label, sp.grp, sp.sort_order
FROM aviaries a,
     (VALUES
        ('RoW-U','Upper Ramp of Wonder','Ramps of Wonder',38),
        ('RoW-M','Middle Ramp of Wonder','Ramps of Wonder',39),
        ('RoW-L','Lower Ramp of Wonder','Ramps of Wonder',40),
        ('TH-R','Ramp to Top of Tiny Hut','Tiny Hut',41),
        ('TH-T','Perch on Top of Tiny Hut','Tiny Hut',42),
        ('FB-1','NE Footbridge','Footbridges',43),
        ('FB-2','SW Footbridge','Footbridges',44),
        ('F-1','N Food Platform','Food Platforms',45),
        ('F-2','S Food Platform','Food Platforms',46),
        ('BB-1','N Baby Box','Baby Boxes',47),
        ('BB-2','S Baby Box','Baby Boxes',48),
        ('W','Water Bowl','Common Locations',49),
        ('G','Ground','Common Locations',50)
     ) AS sp(value, label, grp, sort_order)
WHERE a.slug = 'sayyidas-cove'
ON CONFLICT (aviary_id, value) DO UPDATE
  SET label = EXCLUDED.label, perch_group = EXCLUDED.perch_group,
      sort_order = EXCLUDED.sort_order, retired_at = NULL;

-- --- 3. Retire the superseded old-format specials (keep them resolvable) -----
-- Also push their sort_order past the active set (90+). The active re-catalog
-- reuses numbers 1/33/34/35/36, which would otherwise TIE with these retired
-- rows under compose_config()'s `ORDER BY sort_order` — an unspecified tie-break
-- gives a non-canonical frozen snapshot and can spuriously re-publish on re-run.
-- Distinct numbers remove every tie; retired rows are hidden from entry anyway.
UPDATE perches p
  SET retired_at = COALESCE(p.retired_at, NOW()),
      sort_order = r.sort_order
  FROM aviaries a,
       (VALUES
          ('Ground', 91),
          ('BB1', 92),
          ('BB2', 93),
          ('F1', 94),
          ('F2', 95)
       ) AS r(value, sort_order)
  WHERE p.aviary_id = a.id AND a.slug = 'sayyidas-cove' AND p.value = r.value;

-- --- 4. Replace the two diagram rows with the three new views ----------------
DELETE FROM aviary_perch_diagrams d
  USING aviaries a
  WHERE d.aviary_id = a.id AND a.slug = 'sayyidas-cove';

INSERT INTO aviary_perch_diagrams (aviary_id, url, label, sort_order)
SELECT a.id, d.url, d.label, d.sort_order
FROM aviaries a,
     (VALUES
        ('https://pub-f2f3822bc5384a4a9b824b196e990a21.r2.dev/perch-diagram-sayyidas-cove-eastern-perimeter-v1.webp','Eastern Perimeter',1),
        ('https://pub-f2f3822bc5384a4a9b824b196e990a21.r2.dev/perch-diagram-sayyidas-cove-nw-central-v1.webp','North-Western & Central',2),
        ('https://pub-f2f3822bc5384a4a9b824b196e990a21.r2.dev/perch-diagram-sayyidas-cove-sw-central-v1.webp','South-Western & Central',3)
     ) AS d(url, label, sort_order)
WHERE a.slug = 'sayyidas-cove';

-- --- 5. Publish config version 4 (idempotent) -------------------------------
INSERT INTO config_versions (notes, config)
SELECT 'perch re-catalog: 1-37 relabelled + new specials, old F1/F2/BB1/BB2 retired, 3 diagrams',
       compose_config()
WHERE compose_config() IS DISTINCT FROM
      (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1);
