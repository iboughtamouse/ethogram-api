/**
 * Unit tests for the append-only invariant validator and the diff summary —
 * the pure functions behind GET /config/diff and POST /config/publish.
 * Every rule family gets direct coverage here; the route tests only exercise
 * one family end-to-end.
 */

import { describe, it, expect } from 'vitest';
import {
  appendOnlyViolations,
  diffConfigs,
  type BehaviorEntry,
  type ConfigDoc,
} from './configDiff.js';

function behavior(overrides: Partial<BehaviorEntry> = {}): BehaviorEntry {
  return {
    value: 'flying',
    label: 'Flying',
    group: 'Locomotion',
    requiresLocation: false,
    requiresObject: false,
    requiresObjectInteraction: false,
    requiresAnimal: false,
    requiresAnimalInteraction: false,
    requiresDescription: false,
    excelRowLabel: 'Flying',
    excelRowOrder: 1,
    retired: false,
    ...overrides,
  };
}

function doc(overrides: Partial<ConfigDoc> = {}): ConfigDoc {
  return {
    behaviorGroups: [{ name: 'Locomotion', sortOrder: 1 }],
    behaviors: [behavior()],
    objects: [{ value: 'ball', label: 'Ball', retired: false }],
    objectInteractionTypes: [],
    animals: [{ value: 'hawk', label: 'Hawk', retired: false }],
    animalInteractionTypes: [],
    aviaries: [
      {
        slug: 'cove',
        name: 'The Cove',
        isActive: true,
        perchDiagrams: [{ url: 'https://x/ne.webp', label: 'NE' }],
        perches: [
          { value: '12', label: 'Perch 12', group: 'High', sortOrder: 1, retired: false },
        ],
        subjects: [
          {
            name: 'Sayyida',
            species: 'Barred Owl',
            type: 'foster_parent',
            arrivedOn: '2025-12-15',
            departedOn: null,
          },
        ],
        vocabulary: { behaviors: ['flying'], object: ['ball'] },
      },
    ],
    ...overrides,
  };
}

// Structured clone keeps fixtures independent so mutations can't leak
const clone = (d: ConfigDoc): ConfigDoc => JSON.parse(JSON.stringify(d));

describe('appendOnlyViolations', () => {
  const v1 = { version: 1, config: doc() };

  it('accepts a superset: additions and retirements are append-safe', () => {
    const next = clone(doc());
    next.behaviors.push(behavior({ value: 'hopping', label: 'Hopping', excelRowOrder: 2 }));
    next.behaviors[0]!.retired = true;
    next.objects.push({ value: 'rope', label: 'Rope', retired: false });
    next.aviaries[0]!.perches[0]!.retired = true;
    next.aviaries[0]!.subjects[0]!.departedOn = '2026-07-01';
    expect(appendOnlyViolations([v1], next)).toEqual([]);
  });

  it('flags a removed behavior', () => {
    const next = clone(doc());
    next.behaviors = [];
    expect(appendOnlyViolations([v1], next).join('\n')).toMatch(/Behavior "flying".*version 1/);
  });

  it('flags a removed behavior group', () => {
    const next = clone(doc());
    next.behaviorGroups = [];
    expect(appendOnlyViolations([v1], next).join('\n')).toMatch(/group "Locomotion"/);
  });

  it('flags a removed option in every kind', () => {
    const next = clone(doc());
    next.objects = [];
    next.animals = [];
    const messages = appendOnlyViolations([v1], next).join('\n');
    expect(messages).toMatch(/object "ball"/);
    expect(messages).toMatch(/animal "hawk"/);
  });

  it('flags a removed aviary', () => {
    const next = clone(doc());
    next.aviaries = [];
    expect(appendOnlyViolations([v1], next).join('\n')).toMatch(/Aviary "cove"/);
  });

  it('flags a removed perch inside a surviving aviary', () => {
    const next = clone(doc());
    next.aviaries[0]!.perches = [];
    expect(appendOnlyViolations([v1], next).join('\n')).toMatch(/Perch "12".*"cove"/);
  });

  it('flags a removed subject inside a surviving aviary', () => {
    const next = clone(doc());
    next.aviaries[0]!.subjects = [];
    expect(appendOnlyViolations([v1], next).join('\n')).toMatch(/Subject "Sayyida".*"cove"/);
  });

  it('validates against EVERY prior version, not just the latest', () => {
    // 'hopping' was published in v1 only; v2 already (wrongly) dropped it.
    // The next document must still be told off for not carrying it.
    const v1WithHopping = clone(doc());
    v1WithHopping.behaviors.push(
      behavior({ value: 'hopping', label: 'Hopping', excelRowOrder: 2 })
    );
    const priors = [
      { version: 1, config: v1WithHopping },
      { version: 2, config: doc() },
    ];
    expect(appendOnlyViolations(priors, doc()).join('\n')).toMatch(
      /Behavior "hopping".*version 1/
    );
  });

  it('reports one message per entity even when several priors contain it', () => {
    const priors = [v1, { version: 2, config: doc() }];
    const next = clone(doc());
    next.behaviors = [];
    const violations = appendOnlyViolations(priors, next);
    expect(violations.filter((m) => m.includes('"flying"'))).toHaveLength(1);
  });
});

describe('diffConfigs', () => {
  it('reports a first publish', () => {
    expect(diffConfigs(null, doc()).changes).toEqual(['First published version.']);
  });

  it('reports nothing for identical documents', () => {
    const summary = diffConfigs(doc(), doc());
    expect(summary.changes).toEqual([]);
    expect(summary.flagChanges).toEqual([]);
    expect(summary.rowMapChanges).toEqual([]);
  });

  it('reports behavior changes and routes flag/row-map changes to confirmations', () => {
    const next = clone(doc());
    next.behaviors[0]!.label = 'Flying (soaring)';
    next.behaviors[0]!.requiresDescription = true;
    next.behaviors[0]!.excelRowLabel = 'Soaring';
    next.behaviors.push(behavior({ value: 'hopping', label: 'Hopping', excelRowOrder: 2 }));
    const summary = diffConfigs(doc(), next);
    expect(summary.changes.join('\n')).toMatch(/label changed/);
    expect(summary.changes.join('\n')).toMatch(/Behavior added.*hopping/);
    expect(summary.flagChanges).toEqual(['flying']);
    expect(summary.rowMapChanges).toEqual(['flying']);
  });

  it('reports perch group and sort-position changes (write-reachable via PATCH)', () => {
    const next = clone(doc());
    next.aviaries[0]!.perches[0]!.group = 'Low';
    next.aviaries[0]!.perches[0]!.sortOrder = 9;
    const lines = diffConfigs(doc(), next).changes.join('\n');
    expect(lines).toMatch(/Perch "12".*moved to group "Low"/);
    expect(lines).toMatch(/Perch "12".*changed its sort position/);
  });

  it('reports BOTH a retirement and a label change on the same perch', () => {
    const next = clone(doc());
    next.aviaries[0]!.perches[0]!.retired = true;
    next.aviaries[0]!.perches[0]!.label = 'Perch 12 (old)';
    const lines = diffConfigs(doc(), next).changes.join('\n');
    expect(lines).toMatch(/Perch retired in "cove": "12"/);
    expect(lines).toMatch(/Perch label changed in "cove"/);
  });

  it('reports a subject species change (write-reachable via PATCH)', () => {
    const next = clone(doc());
    next.aviaries[0]!.subjects[0]!.species = 'Great Horned Owl';
    expect(diffConfigs(doc(), next).changes.join('\n')).toMatch(
      /Subject "Sayyida".*changed species: "Barred Owl" → "Great Horned Owl"/
    );
  });

  it('distinguishes a new subject from a new episode of a known subject', () => {
    const next = clone(doc());
    next.aviaries[0]!.subjects.push({
      name: 'Sayyida',
      species: 'Barred Owl',
      type: 'juvenile',
      arrivedOn: '2026-07-01',
      departedOn: null,
    });
    next.aviaries[0]!.subjects.push({
      name: 'Zephyr',
      species: 'Barred Owl',
      type: 'baby',
      arrivedOn: '2026-07-02',
      departedOn: null,
    });
    const lines = diffConfigs(doc(), next).changes.join('\n');
    expect(lines).toMatch(/Subject "Sayyida".*has a new episode/);
    expect(lines).toMatch(/Subject added to "cove": "Zephyr"/);
  });

  it('reports departures, enablement deltas, aviary renames, and diagram swaps', () => {
    const next = clone(doc());
    next.aviaries[0]!.name = 'The Cove East';
    next.aviaries[0]!.subjects[0]!.departedOn = '2026-07-01';
    next.aviaries[0]!.vocabulary.behaviors = [];
    next.aviaries[0]!.perchDiagrams = [{ url: 'https://x/ne-v2.webp', label: 'NE' }];
    const lines = diffConfigs(doc(), next).changes.join('\n');
    expect(lines).toMatch(/Aviary "cove" renamed/);
    expect(lines).toMatch(/departed on 2026-07-01/);
    expect(lines).toMatch(/Enablement changed for "cove" \(behaviors\): 0 enabled, 1 disabled/);
    expect(lines).toMatch(/Perch diagrams changed for "cove"/);
  });
});
