/**
 * Test fixtures for config-derived Excel generation.
 *
 * EXPECTED_BEHAVIOR_ROWS is the retired hardcoded BEHAVIOR_ROW_MAPPING,
 * preserved verbatim as the golden expectation: the config seed (migration
 * 003) must derive exactly these rows in exactly this order, or historical
 * workbooks would change shape. Do not edit to make tests pass — a mismatch
 * means the seed drifted.
 */

export const EXPECTED_BEHAVIOR_ROWS: Array<{ value: string; label: string }> = [
  { value: 'eating', label: 'Eating (Note Location)' },
  { value: 'walking', label: 'Locomotion - Walking (Note Location)' },
  { value: 'eating_food_platform', label: 'Eating - On Food Platform' },
  { value: 'eating_elsewhere', label: 'Eating - Elsewhere (Note Location)' },
  { value: 'walking_ground', label: 'Locomotion - Walking on Ground' },
  { value: 'walking_perch', label: 'Locomotion - Walking on Perch (Note Location)' },
  { value: 'aggression', label: 'Aggression or Defensive Posturing' },
  { value: 'flying', label: 'Locomotion - Flying' },
  { value: 'jumping', label: 'Locomotion - Jumping' },
  { value: 'repetitive_locomotion', label: 'Repetitive Locomotion (Note Location)' },
  { value: 'drinking', label: 'Drinking' },
  { value: 'bathing', label: 'Bathing' },
  { value: 'preening', label: 'Preening/Grooming (Note Location)' },
  { value: 'repetitive_preening', label: 'Repetitive Preening/Feather Damage (Note Location)' },
  { value: 'nesting', label: 'Nesting' },
  { value: 'vocalizing', label: 'Vocalizing (Note Location)' },
  { value: 'resting_alert', label: 'Resting on Perch/Ground - Alert (Note Location)' },
  { value: 'resting_not_alert', label: 'Resting on Perch/Ground - Not Alert (Note Location)' },
  {
    value: 'resting_unknown',
    label: 'Resting on Perch/Ground - Status Unknown (Note Location)',
  },
  {
    value: 'interacting_object',
    label: 'Interacting with Inanimate Object (Note Location, Object & Interaction)',
  },
  {
    value: 'interacting_animal',
    label: 'Interacting with Other Animal (Note Location, Animal & Interaction)',
  },
  { value: 'not_visible', label: 'Not Visible' },
  { value: 'other', label: 'Other' },
];

/**
 * Minimal config document for Excel unit tests. No aviaries are defined, so
 * row derivation falls back to the full catalog — matching the pre-config
 * behavior exactly.
 */
export const TEST_CONFIG = {
  behaviors: EXPECTED_BEHAVIOR_ROWS.map((row, index) => ({
    value: row.value,
    excelRowLabel: row.label,
    excelRowOrder: index + 1,
  })),
  aviaries: [],
};
