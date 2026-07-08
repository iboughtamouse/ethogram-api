-- =============================================================================
-- Migration 010: number-forward perch labels for Sayyida's Cove (config v5)
-- =============================================================================
-- v4's descriptive-only labels ("High SE Turfed Corner Perch") made the location
-- picker hard to use. The field is a react-select; its default filter matches
-- both the label AND the value, so typing a perch number *did* surface the
-- option — but the menu and the selected control displayed only the descriptive
-- label with no number, so an observer who read "12" off the diagram couldn't
-- tell which of the several matches was perch 12, or confirm their pick against
-- the diagram. Nobody recognises the descriptive names either. The fix is to put
-- the diagram key back at the front of the label so it shows in the menu and the
-- selected value, restoring the read-number-off-diagram / pick-that-number flow.
--
-- Fix (owner call, 2026-07-08): put the diagram key back at the front of the
-- label. Numbered perches 1-37 -> "Perch N"; the mnemonic specials keep their
-- short description but lead with their key ("W — Water Bowl"). Values are
-- unchanged, so this is a pure relabel: append-only compliant, no diagram or
-- membership change. Publishes config v5.
--
-- Idempotent by content: the numbered UPDATE derives "Perch <value>" from the
-- value (re-running is a no-op), the specials UPDATE sets fixed target strings,
-- and the publish only fires when compose_config() differs from the latest
-- version. sort_order is untouched, so no new ORDER BY ties are introduced.

-- --- Numbered perches 1-37 -> "Perch N" --------------------------------------
UPDATE perches p
  SET label = 'Perch ' || p.value
  FROM aviaries a
  WHERE p.aviary_id = a.id AND a.slug = 'sayyidas-cove'
    AND p.value ~ '^[0-9]+$';

-- --- Special locations -> "<key> — <description>" (keys match the diagram) ----
-- Retired old-format specials (BB1/BB2/F1/F2/Ground) are left untouched — they
-- are hidden from entry, so their labels don't affect the observer flow.
UPDATE perches p
  SET label = sp.label
  FROM aviaries a,
       (VALUES
          ('RoW-U','RoW-U — Upper Ramp of Wonder'),
          ('RoW-M','RoW-M — Middle Ramp of Wonder'),
          ('RoW-L','RoW-L — Lower Ramp of Wonder'),
          ('TH-R','TH-R — Ramp to Top of Tiny Hut'),
          ('TH-T','TH-T — Perch on Top of Tiny Hut'),
          ('FB-1','FB-1 — NE Footbridge'),
          ('FB-2','FB-2 — SW Footbridge'),
          ('F-1','F-1 — N Food Platform'),
          ('F-2','F-2 — S Food Platform'),
          ('BB-1','BB-1 — N Baby Box'),
          ('BB-2','BB-2 — S Baby Box'),
          ('W','W — Water Bowl'),
          ('G','G — Ground')
       ) AS sp(value, label)
  WHERE p.aviary_id = a.id AND a.slug = 'sayyidas-cove' AND p.value = sp.value;

-- --- Publish config version 5 (idempotent) ----------------------------------
INSERT INTO config_versions (notes, config)
SELECT 'number-forward perch labels (Perch N + key-led specials)', compose_config()
WHERE compose_config() IS DISTINCT FROM
      (SELECT config FROM config_versions ORDER BY id DESC LIMIT 1);
