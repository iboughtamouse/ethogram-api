/**
 * Behavior Migration Script
 *
 * Migrates legacy behavior values to new consolidated values:
 * - walking_perch → walking (preserves location)
 * - walking_ground → walking (sets location to 'Ground')
 * - eating_food_platform → eating (sets location to 'F1')
 * - eating_elsewhere → eating (preserves location)
 * - aggression → interacting_animal + human + defensive_posturing (moves description to notes)
 *
 * Also migrates legacy interactionType field to animalInteractionType.
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/migrate-behaviors.ts   # Preview changes
 *   npx tsx scripts/migrate-behaviors.ts                 # Apply changes
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DRY_RUN = process.env.DRY_RUN === 'true';

interface TimeSlotObservation {
  subjectType: string;
  subjectId: string;
  behavior: string;
  location?: string;
  notes?: string;
  description?: string;
  animal?: string;
  animalInteractionType?: string;
  interactionType?: string; // Legacy field
  [key: string]: unknown;
}

interface MigrationResult {
  observationId: string;
  timeSlot: string;
  oldBehavior: string;
  newBehavior: string;
  changes: string[];
}

async function migrateObservation(
  obs: TimeSlotObservation
): Promise<{ migrated: TimeSlotObservation; changes: string[] }> {
  const migrated = { ...obs };
  const changes: string[] = [];

  // Migrate legacy interactionType to animalInteractionType
  if (obs.interactionType && !obs.animalInteractionType) {
    migrated.animalInteractionType = obs.interactionType;
    delete migrated.interactionType;
    changes.push(`interactionType → animalInteractionType: ${obs.interactionType}`);
  }

  switch (obs.behavior) {
    case 'walking_perch':
      migrated.behavior = 'walking';
      changes.push('walking_perch → walking');
      // Location already present, no change needed
      break;

    case 'walking_ground':
      migrated.behavior = 'walking';
      migrated.location = 'Ground';
      changes.push('walking_ground → walking, location set to Ground');
      break;

    case 'eating_food_platform':
      migrated.behavior = 'eating';
      migrated.location = 'F1';
      changes.push('eating_food_platform → eating, location set to F1');
      break;

    case 'eating_elsewhere':
      migrated.behavior = 'eating';
      changes.push('eating_elsewhere → eating');
      // Location already present, no change needed
      break;

    case 'aggression':
      migrated.behavior = 'interacting_animal';
      migrated.animal = 'human';
      migrated.animalInteractionType = 'defensive_posturing';
      migrated.location = migrated.location || '';
      // Move description to notes, preserving any existing notes
      if (obs.description) {
        const existingNotes = obs.notes ? `${obs.notes} | ` : '';
        migrated.notes = `${existingNotes}Original description: ${obs.description}`;
        delete migrated.description;
        changes.push(`aggression → interacting_animal + human + defensive_posturing, description moved to notes`);
      } else {
        changes.push('aggression → interacting_animal + human + defensive_posturing');
      }
      break;
  }

  return { migrated, changes };
}

async function runMigration(): Promise<void> {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== APPLYING MIGRATION ===');
  console.log('');

  const client = await pool.connect();

  try {
    // Fetch all observations
    const result = await client.query<{ id: string; time_slots: Record<string, TimeSlotObservation[]> }>(
      'SELECT id, time_slots FROM observations'
    );

    console.log(`Found ${result.rows.length} observations to check\n`);

    const allResults: MigrationResult[] = [];
    const updatedObservations: { id: string; timeSlots: Record<string, TimeSlotObservation[]> }[] = [];

    for (const row of result.rows) {
      const { id, time_slots } = row;
      let hasChanges = false;
      const updatedTimeSlots: Record<string, TimeSlotObservation[]> = {};

      for (const [timeSlot, observations] of Object.entries(time_slots)) {
        const updatedObs: TimeSlotObservation[] = [];

        for (const obs of observations) {
          const { migrated, changes } = await migrateObservation(obs);

          if (changes.length > 0) {
            hasChanges = true;
            allResults.push({
              observationId: id,
              timeSlot,
              oldBehavior: obs.behavior,
              newBehavior: migrated.behavior,
              changes,
            });
          }

          updatedObs.push(migrated);
        }

        updatedTimeSlots[timeSlot] = updatedObs;
      }

      if (hasChanges) {
        updatedObservations.push({ id, timeSlots: updatedTimeSlots });
      }
    }

    // Print summary
    console.log('=== MIGRATION SUMMARY ===\n');

    if (allResults.length === 0) {
      console.log('No records need migration.');
      return;
    }

    for (const r of allResults) {
      console.log(`Observation: ${r.observationId}`);
      console.log(`  Time slot: ${r.timeSlot}`);
      console.log(`  Changes:`);
      for (const change of r.changes) {
        console.log(`    - ${change}`);
      }
      console.log('');
    }

    console.log(`Total: ${allResults.length} time slot observations to migrate across ${updatedObservations.length} observation records\n`);

    if (DRY_RUN) {
      console.log('DRY RUN: No changes applied. Run without DRY_RUN=true to apply.');
      return;
    }

    // Apply updates
    console.log('Applying updates...\n');

    await client.query('BEGIN');

    for (const { id, timeSlots } of updatedObservations) {
      await client.query(
        'UPDATE observations SET time_slots = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(timeSlots), id]
      );
      console.log(`  Updated observation ${id}`);
    }

    await client.query('COMMIT');

    console.log(`\nMigration complete. ${updatedObservations.length} observations updated.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
