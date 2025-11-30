import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';

// Helper to validate time string (HH:MM with valid hours/minutes)
const timeSchema = z.string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
  .refine((val) => {
    const parts = val.split(':').map(Number);
    const h = parts[0] ?? -1;
    const m = parts[1] ?? -1;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, { message: 'Invalid time: hours must be 00-23, minutes must be 00-59' });

// Schema for a single observation (flat structure from frontend)
const observationSchema = z.object({
  behavior: z.string(),
  location: z.string(),
  notes: z.string(),
  object: z.string().optional().default(''),
  objectOther: z.string().optional().default(''),
  animal: z.string().optional().default(''),
  animalOther: z.string().optional().default(''),
  interactionType: z.string().optional().default(''),
  interactionTypeOther: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

// Schema for the full request body
const submitObservationSchema = z.object({
  observation: z.object({
    metadata: z.object({
      observerName: z.string().min(2).max(32),
      date: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .refine(
          (val) => !isNaN(Date.parse(val)),
          { message: 'Invalid date' }
        ),
      startTime: timeSchema,
      endTime: timeSchema,
      aviary: z.string(),
      patient: z.string(),
      mode: z.enum(['live', 'vod']),
    }).refine(
      (data) => data.endTime > data.startTime,
      { message: 'End time must be after start time', path: ['endTime'] }
    ),
    observations: z.record(z.string(), observationSchema),
    submittedAt: z.string().datetime(),
  }),
  emails: z.array(z.string().email()).max(10).optional(),
});

// Type for transformed subject observation (matches database JSONB structure)
type SubjectObservation = {
  subjectType: 'foster_parent' | 'baby' | 'juvenile';
  subjectId: string;
  behavior: string;
  location: string;
  notes: string;
  object: string;
  objectOther: string;
  animal: string;
  animalOther: string;
  interactionType: string;
  interactionTypeOther: string;
  description: string;
};

/**
 * Transform flat observations from frontend to array format for database.
 * 
 * Frontend sends: { "14:00": { behavior, location, ... } }
 * Database expects: { "14:00": [{ subjectType, subjectId, behavior, location, ... }] }
 * 
 * TODO: Remove this transformation when frontend sends array format (Phase 4 multi-subject)
 */
function transformObservations(
  flatObservations: Record<string, z.infer<typeof observationSchema>>,
  patient: string
): Record<string, SubjectObservation[]> {
  const result: Record<string, SubjectObservation[]> = {};

  for (const [time, obs] of Object.entries(flatObservations)) {
    result[time] = [
      {
        subjectType: 'foster_parent',
        subjectId: patient,
        behavior: obs.behavior,
        location: obs.location,
        notes: obs.notes,
        object: obs.object,
        objectOther: obs.objectOther,
        animal: obs.animal,
        animalOther: obs.animalOther,
        interactionType: obs.interactionType,
        interactionTypeOther: obs.interactionTypeOther,
        description: obs.description,
      },
    ];
  }

  return result;
}

export const observationsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/observations/submit
  fastify.post('/submit', async (request, reply) => {
    // Validate request body
    const parseResult = submitObservationSchema.safeParse(request.body);

    if (!parseResult.success) {
      // Transform Zod errors to spec format
      const fieldErrors = parseResult.error.flatten().fieldErrors;
      const details = Object.entries(fieldErrors).flatMap(([field, messages]) =>
        (messages ?? []).map((message) => ({ field, message }))
      );

      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      });
    }

    const { observation, emails } = parseResult.data;
    const { metadata, submittedAt } = observation;

    // Transform observations to array format
    const timeSlots = transformObservations(observation.observations, metadata.patient);

    // Insert into database
    try {
      const result = await query<{ id: string }>(
        `INSERT INTO observations (
          observer_name,
          observation_date,
          start_time,
          end_time,
          aviary,
          mode,
          time_slots,
          emails,
          submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          metadata.observerName,
          metadata.date,
          metadata.startTime,
          metadata.endTime,
          metadata.aviary,
          metadata.mode,
          JSON.stringify(timeSlots),
          emails ?? null,
          submittedAt,
        ]
      );

      const id = result.rows[0]?.id;

      if (!id) {
        fastify.log.error('Failed to retrieve submission ID after insert');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to save observation',
          },
        });
      }

      return reply.status(201).send({
        success: true,
        submissionId: id,
        message: 'Observation submitted successfully',
        emailsSent: emails?.length ?? 0, // TODO: Actually send emails
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to insert observation');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to save observation',
        },
      });
    }
  });
};
