import type { FastifyPluginAsync } from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { z } from 'zod';
import { query } from '../db/index.js';
import {
  generateExcelBuffer,
  subjectIdsInSlotOrder,
  type ExcelConfig,
} from '../services/excel.js';
import { sendObservationEmail } from '../services/email.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import { sanitizeFilename } from '../utils/sanitize.js';

// Rate limit config for share endpoint: 3 requests per observation per hour
const SHARE_RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
};

// Helper to validate strict ISO date (YYYY-MM-DD with valid month/day)
function isValidISODate(dateStr: string): boolean {
  // Check format first
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  // Validate month first (before creating Date object)
  if (month < 1 || month > 12) {
    return false;
  }

  // Validate day based on month (before creating Date object to avoid auto-correction)
  // Example: new Date(2025, 1, 30) auto-corrects Feb 30 to March 2
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const maxDay = (isLeapYear && month === 2) ? 29 : daysInMonth[month - 1] ?? 31;

  if (day < 1 || day > maxDay) {
    return false;
  }

  // Validate date range (2024-01-01 to tomorrow)
  // Now safe to create Date object since we've validated month/day are valid
  // Matches database constraint: observation_date >= '2024-01-01' AND observation_date <= CURRENT_DATE + INTERVAL '1 day'
  // Note: This allows tomorrow's DATE for flexibility, matching the database constraint.
  //       However, a separate datetime refinement (in the schema) ensures the observation's start time is not in the future.
  //       This means tomorrow's date is allowed, but only if the time is not in the future (e.g., for late-night data entry).
  const inputDate = new Date(year, month - 1, day);
  const minDate = new Date(2024, 0, 1); // January 1, 2024
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 1); // Tomorrow
  maxDate.setHours(23, 59, 59, 999); // End of tomorrow

  if (inputDate < minDate || inputDate > maxDate) {
    return false;
  }

  return true;
}

// Helper to validate time string (HH:MM with valid hours/minutes)
const timeSchema = z.string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
  .refine((val) => {
    const parts = val.split(':').map(Number);
    const h = parts[0] ?? -1;
    const m = parts[1] ?? -1;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, { message: 'Invalid time: hours must be 00-23, minutes must be 00-59' });

// Max lengths for free-text fields. Mirrors wbs-ethogram-form/src/constants/ui.js
// (study feedback #3 — fields were uncapped; a user once submitted the Bee Movie script).
const MAX_NOTES = 1000;
const MAX_DESCRIPTION = 1000;
const MAX_OTHER = 100;

// The per-observation field set shared by every subject card
const observationSchema = z.object({
  behavior: z.string(),
  location: z.string(),
  notes: z.string().max(MAX_NOTES),
  object: z.string().optional().default(''),
  objectOther: z.string().max(MAX_OTHER).optional().default(''),
  objectInteractionType: z.string().optional().default(''),
  objectInteractionTypeOther: z.string().max(MAX_OTHER).optional().default(''),
  animal: z.string().optional().default(''),
  animalOther: z.string().max(MAX_OTHER).optional().default(''),
  animalInteractionType: z.string().optional().default(''),
  animalInteractionTypeOther: z.string().max(MAX_OTHER).optional().default(''),
  description: z.string().max(MAX_DESCRIPTION).optional().default(''),
});

// Per-subject observation: the flat field set plus subject identity.
// subjectId carries the subject name (P2-D7) — the same string subjects.name
// holds and every historical JSONB row already uses; max mirrors that column.
const subjectObservationSchema = observationSchema.extend({
  subjectType: z.enum(['foster_parent', 'baby', 'juvenile']),
  subjectId: z.string().min(1).max(255),
});

// A time slot is an array of per-subject observations (one entry per
// recorded subject). The legacy flat single-subject shape was removed in
// Phase 2 stage 2D. max(20) is a generous bound on concurrently recorded
// subjects — it keeps the derived email label and warn-log payloads bounded.
const slotSchema = z.array(subjectObservationSchema).min(1).max(20);

// Schema for the full request body
const submitObservationSchema = z.object({
  observation: z.object({
    metadata: z.object({
      observerName: z.string().min(2).max(32),
      date: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .refine(
          (val) => isValidISODate(val),
          { message: 'Invalid date: month must be 01-12 and day must be valid for that month' }
        ),
      startTime: timeSchema,
      endTime: timeSchema,
      // The aviary slug (P2-D4). Unknown values pass through warn-only —
      // a client on a stale snapshot must never lose data over it.
      aviary: z.string(),
      mode: z.enum(['live', 'vod']),
    }).refine(
      (data) => data.endTime > data.startTime,
      { message: 'End time must be after start time', path: ['endTime'] }
    ).refine(
      (data) => {
        // Combine date and startTime to check if observation is in the future
        const observationDatetime = `${data.date}T${data.startTime}:00`;
        const observationTime = new Date(observationDatetime);
        const now = new Date();
        return observationTime <= now;
      },
      { message: 'Observation cannot be in the future', path: ['date'] }
    ),
    observations: z.record(z.string(), slotSchema).refine(
      (slots) => Object.keys(slots).length > 0,
      { message: 'At least one time slot is required' }
    ),
    submittedAt: z.string().datetime(),
  }),
  emails: z.array(z.string().email()).max(10).optional(),
});

// Type for a subject observation (matches database JSONB structure)
type SubjectObservation = z.infer<typeof subjectObservationSchema>;

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
  config_version_id: number | null;
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

// Shape of a Postgres uuid column value — anything else can't match a row
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch an observation by ID and reconstruct its metadata.
 * Returns null if not found.
 */
async function fetchObservationById(id: string): Promise<{
  row: ObservationRow;
  metadata: ObservationMetadata;
} | null> {
  // A non-UUID id cannot match any row; querying it would make Postgres
  // raise 22P02 and turn a plain not-found into a 500 (same class of bug
  // the config route's int4 guard fixed — followups FU-1)
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const result = await query<ObservationRow>(
    `SELECT id, observer_name, observation_date, start_time, end_time, aviary, mode, time_slots, submitted_at, config_version_id
     FROM observations WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  // Derive the patient label from the row's subjects — unique subjectIds in
  // slot order, the same rule the submit path applies. Falls back to
  // 'Unknown' for a row with no time slots.
  const patient = subjectIdsInSlotOrder(row.time_slots).join(', ') || 'Unknown';

  // PostgreSQL returns Date objects for date columns, convert to YYYY-MM-DD string
  const dateStr = row.observation_date instanceof Date
    ? row.observation_date.toISOString().split('T')[0]!
    : String(row.observation_date);

  const metadata: ObservationMetadata = {
    observerName: row.observer_name,
    date: dateStr,
    // PostgreSQL `time` columns serialize as HH:MM:SS; Excel expects HH:MM
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    aviary: row.aviary,
    patient,
    mode: row.mode as 'live' | 'vod',
  };

  return { row, metadata };
}

/**
 * Minimal queryable the resolution helpers run against — the shared pool
 * helper by default, a transaction-scoped client in tests.
 */
type Db = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
};
const defaultDb: Db = { query };

/**
 * Resolve an aviary by slug (P2-D4; display-name resolution was flat-era
 * leniency, removed in stage 2D). Returns null for unknown values — the
 * caller warn-logs and passes the raw value through, never rejects.
 */
export async function resolveAviary(
  slug: string,
  db: Db = defaultDb
): Promise<{ id: string; name: string } | null> {
  const result = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM aviaries WHERE slug = $1',
    [slug]
  );
  return result.rows[0] ?? null;
}

// Generic (unidentified) subject labels the form may send instead of a name
// (P2-D8): most observers cannot tell juveniles apart, so identification is
// optional. These are wire-contract literals, not subjects rows — always
// exempt from the residency check.
const GENERIC_SUBJECT_IDS = new Set(['Juvenile']);

/**
 * Names in subjectNames with no residency episode covering the observation
 * date in the given aviary. Episodes are half-open [arrived_on, departed_on):
 * a subject is resident on its arrival date, not on its departure date.
 * Generic labels (P2-D8) are never reported. This is the P2-D5 warn-only
 * telemetry — tightened to reject after 2C soaks.
 */
export async function findNonResidentSubjects(
  aviaryId: string,
  date: string,
  subjectNames: string[],
  db: Db = defaultDb
): Promise<string[]> {
  const named = subjectNames.filter((name) => !GENERIC_SUBJECT_IDS.has(name));
  if (named.length === 0) {
    return [];
  }

  const result = await db.query<{ name: string }>(
    `SELECT name FROM subjects
     WHERE aviary_id = $1
       AND arrived_on <= $2
       AND (departed_on IS NULL OR departed_on > $2)`,
    [aviaryId, date]
  );
  const resident = new Set(result.rows.map((r) => r.name));
  return named.filter((name) => !resident.has(name));
}

/**
 * Fetch the config document for a stamped version. Rows with a NULL stamp
 * (pre-backfill or the stage A→B window) resolve to version 1 — safe because
 * version 1 is a superset of every config-keyed value an old row can hold.
 */
async function fetchConfigForVersion(versionId: number | null): Promise<ExcelConfig> {
  const result = await query<{ config: ExcelConfig }>(
    `SELECT config FROM config_versions
     WHERE id = COALESCE($1, (SELECT MIN(id) FROM config_versions))`,
    [versionId]
  );

  const config = result.rows[0]?.config;
  if (!config) {
    throw new Error('No published config version available');
  }
  return config;
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

    // Slots arrive array-native (the flat shape died in stage 2D)
    const timeSlots = observation.observations;

    // Unique subject names in slot order — the email/Excel subject label
    const subjectNames = subjectIdsInSlotOrder(timeSlots);
    const patientLabel = subjectNames.join(', ') || 'Unknown';

    // Insert into database
    try {
      // Stamp the config version this row was submitted under (Phase 1 §3.1)
      // and resolve the aviary to its entity. Both are best-effort: an
      // unknown aviary is warn-logged and left NULL, never rejected. One
      // fetch supplies both the stamp and the email Excel below, so a
      // publish landing mid-request can't make them diverge.
      const versionResult = await query<{ id: number; config: ExcelConfig }>(
        'SELECT id, config FROM config_versions ORDER BY id DESC LIMIT 1'
      );
      const configVersionId = versionResult.rows[0]?.id ?? null;
      const configDoc = versionResult.rows[0]?.config ?? null;

      // The client sends the aviary slug (P2-D4; slug-only since 2D); the
      // aviary varchar column keeps receiving the display name so Excel
      // headers and existing rows stay uniform. Unknown values pass through.
      const aviaryRow = await resolveAviary(metadata.aviary);
      const aviaryId = aviaryRow?.id ?? null;
      const aviaryName = aviaryRow?.name ?? metadata.aviary;
      if (!aviaryId) {
        fastify.log.warn({ aviary: metadata.aviary }, 'Unknown aviary slug; aviary_id left NULL');
      }

      // Warn-only subject residency check (P2-D5): a client on a stale
      // bundled snapshot must never lose an hour of data over a subject
      // mismatch. Tighten to reject after 2C soaks in production.
      if (aviaryId) {
        const unknownSubjects = await findNonResidentSubjects(
          aviaryId,
          metadata.date,
          subjectNames
        );
        if (unknownSubjects.length > 0) {
          fastify.log.warn(
            { aviary: aviaryName, date: metadata.date, subjects: unknownSubjects },
            'Subject(s) not resident in the aviary on the observation date'
          );
        }
      }

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
          submitted_at,
          aviary_id,
          config_version_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
        [
          metadata.observerName,
          metadata.date,
          metadata.startTime,
          metadata.endTime,
          aviaryName,
          metadata.mode,
          JSON.stringify(timeSlots),
          emails ?? null,
          submittedAt,
          aviaryId,
          configVersionId,
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
          if (!configDoc) {
            throw new Error('No published config version available');
          }
          const excelBuffer = await generateExcelBuffer({
            metadata: { ...metadata, aviary: aviaryName, patient: patientLabel },
            observations: timeSlots,
            submittedAt,
            config: configDoc,
          });

          // Send to each recipient
          for (const email of emails) {
            const emailResult = await sendObservationEmail({
              to: [email],
              observerName: metadata.observerName,
              date: metadata.date,
              patient: patientLabel,
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

      // Generate Excel once, under the config version the row was stamped with
      const excelBuffer = await generateExcelBuffer({
        metadata,
        observations: row.time_slots,
        submittedAt: row.submitted_at,
        config: await fetchConfigForVersion(row.config_version_id),
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

      // Generate Excel under the config version the row was stamped with
      const excelBuffer = await generateExcelBuffer({
        metadata,
        observations: row.time_slots,
        submittedAt: row.submitted_at,
        config: await fetchConfigForVersion(row.config_version_id),
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
