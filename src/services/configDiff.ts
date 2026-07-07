/**
 * Config diffing + the Phase 1 §3.1 append-only invariant validator — the
 * brains behind GET /api/admin/config/diff and POST /api/admin/config/publish
 * (Phase 3 §3, P3-D3).
 *
 * Pure functions over the composed config document shape (compose_config(),
 * migration 002) — no DB access, so every rule is unit-testable.
 */

export interface VocabEntry {
  value: string;
  label: string;
  retired: boolean;
}

export interface BehaviorEntry extends VocabEntry {
  group: string;
  requiresLocation: boolean;
  requiresObject: boolean;
  requiresObjectInteraction: boolean;
  requiresAnimal: boolean;
  requiresAnimalInteraction: boolean;
  requiresDescription: boolean;
  excelRowLabel: string;
  excelRowOrder: number;
}

export interface AviaryEntry {
  slug: string;
  name: string;
  isActive: boolean;
  perchDiagrams: { url: string; label: string }[];
  perches: { value: string; label: string; group: string | null; retired: boolean }[];
  subjects: {
    name: string;
    species: string;
    type: string;
    arrivedOn: string;
    departedOn: string | null;
  }[];
  vocabulary: Record<string, string[]>;
}

export interface ConfigDoc {
  behaviorGroups: { name: string; sortOrder: number }[];
  behaviors: BehaviorEntry[];
  objects: VocabEntry[];
  objectInteractionTypes: VocabEntry[];
  animals: VocabEntry[];
  animalInteractionTypes: VocabEntry[];
  aviaries: AviaryEntry[];
}

const OPTION_KEYS = [
  ['objects', 'object'],
  ['objectInteractionTypes', 'object interaction type'],
  ['animals', 'animal'],
  ['animalInteractionTypes', 'animal interaction type'],
] as const;

const REQUIRES_FLAGS = [
  'requiresLocation',
  'requiresObject',
  'requiresObjectInteraction',
  'requiresAnimal',
  'requiresAnimalInteraction',
  'requiresDescription',
] as const;

function byValue<T extends { value: string }>(entries: T[]): Map<string, T> {
  return new Map(entries.map((e) => [e.value, e]));
}

/**
 * Append-only violations of the NEXT document against every PRIOR published
 * version (Phase 1 §3.1: a value/slug/name that ever appeared in a published
 * version may be retired but never renamed or removed). Returns human-readable
 * messages; empty = publishable.
 */
export function appendOnlyViolations(
  priors: { version: number; config: ConfigDoc }[],
  next: ConfigDoc
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const add = (message: string): void => {
    if (!seen.has(message)) {
      seen.add(message);
      violations.push(message);
    }
  };

  const nextBehaviors = new Set(next.behaviors.map((b) => b.value));
  const nextGroups = new Set(next.behaviorGroups.map((g) => g.name));
  const nextAviaries = new Map(next.aviaries.map((a) => [a.slug, a]));

  for (const prior of priors) {
    for (const behavior of prior.config.behaviors) {
      if (!nextBehaviors.has(behavior.value)) {
        add(
          `Behavior "${behavior.value}" was published in version ${prior.version} and cannot be removed or renamed — retire it instead.`
        );
      }
    }
    for (const group of prior.config.behaviorGroups) {
      if (!nextGroups.has(group.name)) {
        add(
          `Behavior group "${group.name}" was published in version ${prior.version} and cannot be removed or renamed.`
        );
      }
    }
    for (const [key, label] of OPTION_KEYS) {
      const nextValues = new Set(next[key].map((o) => o.value));
      for (const option of prior.config[key]) {
        if (!nextValues.has(option.value)) {
          add(
            `The ${label} "${option.value}" was published in version ${prior.version} and cannot be removed or renamed — retire it instead.`
          );
        }
      }
    }
    for (const aviary of prior.config.aviaries) {
      const nextAviary = nextAviaries.get(aviary.slug);
      if (!nextAviary) {
        add(
          `Aviary "${aviary.slug}" was published in version ${prior.version} and cannot be removed or renamed.`
        );
        continue;
      }
      const nextPerches = new Set(nextAviary.perches.map((p) => p.value));
      for (const perch of aviary.perches) {
        if (!nextPerches.has(perch.value)) {
          add(
            `Perch "${perch.value}" in aviary "${aviary.slug}" was published in version ${prior.version} and cannot be removed or renamed — retire it instead.`
          );
        }
      }
      const nextSubjects = new Set(nextAviary.subjects.map((s) => s.name));
      for (const subject of aviary.subjects) {
        if (!nextSubjects.has(subject.name)) {
          add(
            `Subject "${subject.name}" in aviary "${aviary.slug}" was published in version ${prior.version} and cannot be removed or renamed — record a departure instead.`
          );
        }
      }
    }
  }

  return violations;
}

export interface ConfigDiffSummary {
  /** Human-readable change lines for the review step (§5 MVP). */
  changes: string[];
  /** Behaviors whose requires_* flags changed — publish needs confirmation. */
  flagChanges: string[];
  /** Behaviors whose Excel row label/order changed — publish needs confirmation. */
  rowMapChanges: string[];
}

/** Summarize NEXT against the latest published PRIOR (null = first publish). */
export function diffConfigs(prior: ConfigDoc | null, next: ConfigDoc): ConfigDiffSummary {
  const changes: string[] = [];
  const flagChanges: string[] = [];
  const rowMapChanges: string[] = [];

  if (!prior) {
    changes.push('First published version.');
    return { changes, flagChanges, rowMapChanges };
  }

  // --- Behaviors ---
  const priorBehaviors = byValue(prior.behaviors);
  const nextBehaviors = byValue(next.behaviors);
  for (const behavior of next.behaviors) {
    const before = priorBehaviors.get(behavior.value);
    if (!before) {
      changes.push(`Behavior added: "${behavior.label}" (${behavior.value}).`);
      continue;
    }
    if (!before.retired && behavior.retired) {
      changes.push(`Behavior retired: "${behavior.label}" (${behavior.value}).`);
    } else if (before.retired && !behavior.retired) {
      changes.push(`Behavior unretired: "${behavior.label}" (${behavior.value}).`);
    }
    if (before.label !== behavior.label) {
      changes.push(`Behavior label changed: "${before.label}" → "${behavior.label}" (${behavior.value}).`);
    }
    if (before.group !== behavior.group) {
      changes.push(`Behavior "${behavior.value}" moved to group "${behavior.group}".`);
    }
    const changedFlags = REQUIRES_FLAGS.filter((flag) => before[flag] !== behavior[flag]);
    if (changedFlags.length) {
      flagChanges.push(behavior.value);
      changes.push(
        `Behavior "${behavior.value}" changed which extra fields it needs (${changedFlags.join(', ')}).`
      );
    }
    if (
      before.excelRowLabel !== behavior.excelRowLabel ||
      before.excelRowOrder !== behavior.excelRowOrder
    ) {
      rowMapChanges.push(behavior.value);
      changes.push(`Behavior "${behavior.value}" changed its Excel row (label or position).`);
    }
  }

  // --- Behavior groups ---
  const priorGroupNames = new Set(prior.behaviorGroups.map((g) => g.name));
  for (const group of next.behaviorGroups) {
    if (!priorGroupNames.has(group.name)) {
      changes.push(`Behavior group added: "${group.name}".`);
    }
  }

  // --- Options ---
  for (const [key, label] of OPTION_KEYS) {
    const before = byValue(prior[key]);
    for (const option of next[key]) {
      const prev = before.get(option.value);
      if (!prev) {
        changes.push(`New ${label}: "${option.label}" (${option.value}).`);
        continue;
      }
      if (!prev.retired && option.retired) {
        changes.push(`Retired ${label}: "${option.label}" (${option.value}).`);
      } else if (prev.retired && !option.retired) {
        changes.push(`Unretired ${label}: "${option.label}" (${option.value}).`);
      }
      if (prev.label !== option.label) {
        changes.push(`Label changed for ${label} "${option.value}": "${prev.label}" → "${option.label}".`);
      }
    }
  }

  // --- Aviaries ---
  const priorAviaries = new Map(prior.aviaries.map((a) => [a.slug, a]));
  for (const aviary of next.aviaries) {
    const before = priorAviaries.get(aviary.slug);
    if (!before) {
      changes.push(`Aviary added: "${aviary.name}" (${aviary.slug}).`);
      continue;
    }
    if (before.name !== aviary.name) {
      changes.push(`Aviary "${aviary.slug}" renamed: "${before.name}" → "${aviary.name}".`);
    }
    if (before.isActive !== aviary.isActive) {
      changes.push(`Aviary "${aviary.slug}" is now ${aviary.isActive ? 'active' : 'inactive'}.`);
    }

    const beforePerches = byValue(before.perches);
    for (const perch of aviary.perches) {
      const prev = beforePerches.get(perch.value);
      if (!prev) {
        changes.push(`Perch added to "${aviary.slug}": "${perch.label}" (${perch.value}).`);
      } else if (!prev.retired && perch.retired) {
        changes.push(`Perch retired in "${aviary.slug}": "${perch.value}".`);
      } else if (prev.retired && !perch.retired) {
        changes.push(`Perch unretired in "${aviary.slug}": "${perch.value}".`);
      } else if (prev.label !== perch.label) {
        changes.push(`Perch label changed in "${aviary.slug}": "${prev.label}" → "${perch.label}" (${perch.value}).`);
      }
    }

    const beforeSubjects = new Map(before.subjects.map((s) => [`${s.name}|${s.arrivedOn}|${s.type}`, s]));
    const beforeNames = new Set(before.subjects.map((s) => s.name));
    for (const subject of aviary.subjects) {
      const key = `${subject.name}|${subject.arrivedOn}|${subject.type}`;
      const prev = beforeSubjects.get(key);
      if (!prev) {
        changes.push(
          beforeNames.has(subject.name)
            ? `Subject "${subject.name}" in "${aviary.slug}" has a new episode (${subject.type} from ${subject.arrivedOn}).`
            : `Subject added to "${aviary.slug}": "${subject.name}" (${subject.type}, arrived ${subject.arrivedOn}).`
        );
        continue;
      }
      if ((prev.departedOn ?? null) !== (subject.departedOn ?? null)) {
        changes.push(
          subject.departedOn
            ? `Subject "${subject.name}" in "${aviary.slug}" departed on ${subject.departedOn}.`
            : `Subject "${subject.name}" in "${aviary.slug}" is no longer marked departed.`
        );
      }
    }

    const beforeDiagrams = JSON.stringify(before.perchDiagrams);
    if (beforeDiagrams !== JSON.stringify(aviary.perchDiagrams)) {
      changes.push(`Perch diagrams changed for "${aviary.slug}".`);
    }

    for (const [kind, values] of Object.entries(aviary.vocabulary)) {
      const prevValues = new Set(before.vocabulary[kind] ?? []);
      const nowValues = new Set(values);
      const added = values.filter((v) => !prevValues.has(v)).length;
      const removed = [...prevValues].filter((v) => !nowValues.has(v)).length;
      if (added || removed) {
        changes.push(
          `Enablement changed for "${aviary.slug}" (${kind}): ${added} enabled, ${removed} disabled.`
        );
      }
    }
  }

  return { changes, flagChanges, rowMapChanges };
}
