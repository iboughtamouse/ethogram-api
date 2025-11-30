import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';

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
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      aviary: z.string(),
      patient: z.string(),
      mode: z.enum(['live', 'vod']),
    }),
    observations: z.record(z.string(), observationSchema),
    submittedAt: z.string().datetime(),
  }),
  emails: z.array(z.string().email()).min(1).max(10).optional(),
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
        object: obs.object ?? '',
        objectOther: obs.objectOther ?? '',
        animal: obs.animal ?? '',
        animalOther: obs.animalOther ?? '',
        interactionType: obs.interactionType ?? '',
        interactionTypeOther: obs.interactionTypeOther ?? '',
        description: obs.description ?? '',
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
      return reply.status(400).send({
        success: false,
        error: 'validation',
        message: 'Invalid request body',
        errors: parseResult.error.flatten().fieldErrors,
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
        error: 'database',
        message: 'Failed to save observation',
      });
    }
  });
};
