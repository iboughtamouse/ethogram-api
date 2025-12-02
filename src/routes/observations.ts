import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { generateExcelBuffer } from '../services/excel.js';
import { sendObservationEmail } from '../services/email.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import { sanitizeFilename } from '../utils/sanitize.js';

// Rate limit config for share endpoint: 3 requests per observation per hour
const SHARE_RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
};

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
// Helper to check YYYY-MM-DD is a real calendar date
const isStrictISODate = (val: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [year, month, day] = val.split('-').map(Number);
  const dt = new Date(`${val}T00:00:00Z`);
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() + 1 === month &&
    dt.getUTCDate() === day
  );
};

const submitObservationSchema = z.object({
  observation: z.object({
    metadata: z.object({
      observerName: z.string().min(2).max(32),
      date: z.string()
        .refine((val) => isStrictISODate(val), {
          message: 'Invalid date',
        }),
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

// Type for observation row from database
interface ObservationRow {
  id: string;
  observer_name: string;
  observation_date: string | Date; // PostgreSQL may return Date object
  start_time: string;
  end_time: string;
  aviary: string;
  mode: string;
  time_slots: Record<string, SubjectObservation[]>;
  submitted_at: string;
}

// Type for reconstructed metadata (used for Excel generation and email)
interface ObservationMetadata {
  observerName: string;
  date: string;
  startTime: string;
  endTime: string;
  aviary: string;
  patient: string;
  mode: 'live' | 'vod';
}

/**
 * Fetch an observation by ID and reconstruct its metadata.
 * Returns null if not found.
 */
async function fetchObservationById(id: string): Promise<{
  row: ObservationRow;
  metadata: ObservationMetadata;
} | null> {
  const result = await query<ObservationRow>(
    `SELECT id, observer_name, observation_date, start_time, end_time, aviary, mode, time_slots, submitted_at
     FROM observations WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  // Extract patient from first time slot's first observation.
  // Falls back to 'Unknown' if no time slots exist or first slot is empty.
  const firstSlot = Object.values(row.time_slots)[0];
  const firstObs = Array.isArray(firstSlot) ? firstSlot[0] : null;
  const patient = firstObs?.subjectId ?? 'Unknown';

  // PostgreSQL returns Date objects for date columns, convert to YYYY-MM-DD string
  const dateStr = row.observation_date instanceof Date
    ? row.observation_date.toISOString().split('T')[0]!
    : String(row.observation_date);

  const metadata: ObservationMetadata = {
    observerName: row.observer_name,
    date: dateStr,
    startTime: row.start_time,
    endTime: row.end_time,
    aviary: row.aviary,
    patient,
    mode: row.mode as 'live' | 'vod',
  };

  return { row, metadata };
}

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

      // Generate Excel and send emails if recipients provided
      let emailsSent = 0;
      if (emails && emails.length > 0) {
        try {
          const excelBuffer = await generateExcelBuffer({
            metadata,
            observations: timeSlots,
            submittedAt,
          });

          // Send to each recipient
          for (const email of emails) {
            const emailResult = await sendObservationEmail({
              to: [email],
              observerName: metadata.observerName,
              date: metadata.date,
              patient: metadata.patient,
              excelBuffer,
            });

            if (emailResult.success) {
              emailsSent++;
            } else {
              fastify.log.warn({ email, error: emailResult.error }, 'Failed to send email');
            }
          }
        } catch (error) {
          fastify.log.error(error, 'Failed to generate Excel or send emails');
          // Don't fail the request - observation is saved, email is best-effort
        }
      }

      return reply.status(201).send({
        success: true,
        submissionId: id,
        message: 'Observation submitted successfully',
        emailsSent,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to insert observation');

      // Map common Postgres errors to nicer API responses
      // 22P02: invalid_text_representation (invalid input syntax e.g. for date)
      // 23514: check_violation (constraint) - use constraint name to map to fields
      // 23502: not_null_violation (missing column)
      const pgError = error as any;
      if (pgError && pgError.code) {
        // Invalid input syntax (e.g., '99/99/9999' for DATE)
        if (pgError.code === '22P02') {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: [
                {
                  field: 'date',
                  message:
                    'Invalid date format. Please provide YYYY-MM-DD',
                },
              ],
            },
          });
        }

        // Constraint violations - check error.constraint to map which field
        if (pgError.code === '23514' && pgError.constraint) {
          const constraint = pgError.constraint as string;
          const details = [] as { field: string; message: string }[];
          if (constraint === 'valid_date') {
            details.push({
              field: 'date',
              message:
                'Observation date is outside acceptable range (must be >= 2024-01-01 and <= tomorrow)',
            });
          } else if (constraint === 'valid_time_range') {
            details.push({ field: 'endTime', message: 'End time must be after start time' });
          }

          if (details.length > 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details,
              },
            });
          }
        }

        // Not-null violation - return field-level details if available
        if (pgError.code === '23502' && pgError.column) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Missing required field',
              details: [
                {
                  field: pgError.column,
                  message: 'This field is required',
                },
              ],
            },
          });
        }
      }

      // Default fallback to 500 for other failures
      return reply.status(500).send({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to save observation',
        },
      });
    }
  });

  // POST /api/observations/:id/share - Send Excel copy to user's email(s)
  fastify.post<{ Params: { id: string } }>('/:id/share', async (request, reply) => {
    const { id } = request.params;

    // Validate request body
    const bodySchema = z.object({
      emails: z.array(z.string().email()).min(1, 'At least one email required').max(10, 'Maximum 10 emails'),
    });

    const parseResult = bodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues[0]?.message ?? 'Invalid email';
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: errorMessage,
        },
      });
    }

    const { emails } = parseResult.data;

    // Check rate limit
    const rateLimitKey = `share:${id}`;
    const rateLimit = checkRateLimit(rateLimitKey, SHARE_RATE_LIMIT);

    if (!rateLimit.allowed) {
      return reply.status(429).send({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many share requests. Try again later.',
        },
      });
    }

    // Fetch observation from database
    try {
      const observation = await fetchObservationById(id);

      if (!observation) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Observation not found',
          },
        });
      }

      const { row, metadata } = observation;

      // Generate Excel once
      const excelBuffer = await generateExcelBuffer({
        metadata,
        observations: row.time_slots,
        submittedAt: row.submitted_at,
      });

      // Send to all recipients
      let emailsSent = 0;
      const failures: string[] = [];

      for (const email of emails) {
        const emailResult = await sendObservationEmail({
          to: [email],
          observerName: metadata.observerName,
          date: metadata.date,
          patient: metadata.patient,
          excelBuffer,
        });

        if (emailResult.success) {
          emailsSent++;
        } else {
          fastify.log.error({ email, error: emailResult.error }, 'Failed to send share email');
          failures.push(email);
        }
      }

      // If all emails failed, return error
      if (emailsSent === 0) {
        return reply.status(500).send({
          success: false,
          error: {
            code: 'EMAIL_ERROR',
            message: 'Failed to send to any recipients',
          },
        });
      }

      // Partial or full success
      const message = failures.length > 0
        ? `Excel sent to ${emailsSent} recipient(s). Failed: ${failures.join(', ')}`
        : `Excel sent to ${emailsSent} recipient(s)`;

      return reply.status(200).send({
        success: true,
        message,
        emailsSent,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to share observation');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to share observation',
        },
      });
    }
  });

  // GET /api/observations/:id/excel - Download Excel file
  fastify.get<{ Params: { id: string } }>('/:id/excel', async (request, reply) => {
    const { id } = request.params;

    try {
      const data = await fetchObservationById(id);

      if (!data) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Observation not found',
          },
        });
      }

      const { row, metadata } = data;

      // Generate Excel
      const excelBuffer = await generateExcelBuffer({
        metadata,
        observations: row.time_slots,
        submittedAt: row.submitted_at,
      });

      // Set headers for file download
      const filename = `ethogram_${sanitizeFilename(metadata.date)}_${sanitizeFilename(metadata.observerName)}.xlsx`;

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(excelBuffer);
    } catch (error) {
      fastify.log.error(error, 'Failed to generate Excel');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to generate Excel',
        },
      });
    }
  });
};
