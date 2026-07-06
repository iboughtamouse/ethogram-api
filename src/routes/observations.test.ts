import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { buildApp } from '../app.js';
import { pool, query, closePool } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { resolveAviary, findNonResidentSubjects } from './observations.js';
import { sendObservationEmail } from '../services/email.js';
import { generateExcelBuffer } from '../services/excel.js';
import { clearAllRateLimits } from '../utils/rateLimit.js';

// Mock the email service to avoid hitting real API
vi.mock('../services/email.js', () => ({
  sendObservationEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-id' }),
}));

// Mock the Excel service to avoid running real generation in tests.
// Only generateExcelBuffer is mocked — the route also uses the module's
// pure helpers (subjectIdsInSlotOrder), which must stay real.
vi.mock('../services/excel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/excel.js')>();
  return {
    ...actual,
    generateExcelBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-excel-data')),
  };
});

const mockSendObservationEmail = vi.mocked(sendObservationEmail);
const mockGenerateExcelBuffer = vi.mocked(generateExcelBuffer);

// Single app instance for all tests
let app: FastifyInstance;

// Setup/teardown for entire file
beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

// Helper to create a valid request body (array-native since stage 2D)
const validBody = () => ({
  observation: {
    metadata: {
      observerName: 'TestObserver',
      date: '2025-11-29',
      startTime: '14:00',
      endTime: '14:30',
      aviary: 'sayyidas-cove',
      mode: 'live' as const,
    },
    observations: {
      '14:00': [
        {
          subjectType: 'foster_parent' as const,
          subjectId: 'Sayyida',
          behavior: 'resting_alert',
          location: '12',
          notes: 'Test observation',
        },
      ],
      '14:05': [
        {
          subjectType: 'foster_parent' as const,
          subjectId: 'Sayyida',
          behavior: 'flying',
          location: '',
          notes: '',
        },
      ],
    },
    submittedAt: '2025-11-29T20:00:00.000Z',
  },
  emails: ['test@example.com'],
});

// Helper to insert a test observation and return its ID
const insertTestObservation = async (): Promise<string> => {
  const result = await query<{ id: string }>(
    `INSERT INTO observations (
      observer_name, observation_date, start_time, end_time, aviary, mode, time_slots, submitted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      'TestObserver',
      '2025-11-29',
      '14:00',
      '14:30',
      'Test Aviary',
      'live',
      JSON.stringify({
        '14:00': [{ subjectType: 'foster_parent', subjectId: 'Sayyida', behavior: 'resting', location: '5', notes: '' }],
      }),
      '2025-11-29T20:00:00.000Z',
    ]
  );
  return result.rows[0]!.id;
};

describe('POST /api/observations/submit', () => {
  // Clean up observations table before each test
  beforeEach(async () => {
    await query('DELETE FROM observations');
    vi.clearAllMocks();
    // Reset mocks to default success behavior
    mockGenerateExcelBuffer.mockResolvedValue(Buffer.from('mock-excel-data'));
    mockSendObservationEmail.mockResolvedValue({ success: true, messageId: 'mock-id' });
  });

  it('returns 201 and submission ID for valid request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload: validBody(),
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.submissionId).toBeDefined();
    expect(body.message).toBe('Observation submitted successfully');
  });

  it('inserts data into the database with all fields', async () => {
    const payload = validBody();

    await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    const result = await query<{
      observer_name: string;
      aviary: string;
      observation_date: string;
      start_time: string;
      end_time: string;
      mode: string;
      emails: string[];
      time_slots: Record<string, unknown[]>;
    }>('SELECT observer_name, aviary, observation_date, start_time, end_time, mode, emails, time_slots FROM observations');

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.observer_name).toBe('TestObserver');
    expect(row.aviary).toBe("Sayyida's Cove");
    expect(row.mode).toBe('live');
    expect(row.emails).toEqual(['test@example.com']);
    expect(row.time_slots).toBeDefined();
    expect(Object.keys(row.time_slots)).toContain('14:00');
  });

  it('stamps the latest config version and resolves the aviary entity', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload: validBody(),
    });

    const result = await query<{ aviary_id: string | null; config_version_id: number | null }>(
      'SELECT aviary_id, config_version_id FROM observations'
    );

    const row = result.rows[0]!;
    // "Sayyida's Cove" is a seeded aviary (migration 003), so it must resolve
    expect(row.aviary_id).not.toBeNull();
    expect(row.config_version_id).toBeGreaterThanOrEqual(1);
  });

  it('leaves aviary_id NULL for an unknown aviary name (never rejects)', async () => {
    const payload = validBody();
    payload.observation.metadata.aviary = 'Some Future Aviary';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);

    const result = await query<{ aviary_id: string | null; config_version_id: number | null }>(
      'SELECT aviary_id, config_version_id FROM observations'
    );
    expect(result.rows[0]!.aviary_id).toBeNull();
    expect(result.rows[0]!.config_version_id).toBeGreaterThanOrEqual(1);
  });

  it('stores array-native slots with subject info', async () => {
    const payload = validBody();

    await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    const result = await query<{ time_slots: Record<string, unknown[]> }>(
      'SELECT time_slots FROM observations'
    );

    const timeSlots = result.rows[0]?.time_slots;
    expect(timeSlots).toBeDefined();

    // Slots persist exactly as sent — arrays with subject identity
    const slot = timeSlots?.['14:00'];
    expect(Array.isArray(slot)).toBe(true);
    expect(slot?.[0]).toMatchObject({
      subjectType: 'foster_parent',
      subjectId: 'Sayyida',
      behavior: 'resting_alert',
      location: '12',
    });
  });

  it('returns 400 for missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload: {
        observation: {
          metadata: {
            // Missing observerName
            date: '2025-11-29',
            startTime: '14:00',
            endTime: '14:30',
            aviary: "Sayyida's Cove",
            patient: 'Sayyida',
            mode: 'live',
          },
          observations: {},
          submittedAt: '2025-11-29T20:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid observerName length', async () => {
    const payload = validBody();
    payload.observation.metadata.observerName = 'A'; // Too short (min 2)

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for notes exceeding the max length', async () => {
    const payload = validBody();
    payload.observation.observations['14:00'][0]!.notes = 'x'.repeat(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid date format', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-13-99'; // Invalid month and day

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date with invalid month (month 00)', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-00-15';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date with invalid month (month 13)', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-13-01';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date with invalid day (day 00)', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-05-00';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date with day 32 in month with 31 days', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-01-32';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date with day 31 in month with 30 days', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-04-31'; // April has 30 days

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for Feb 30 in non-leap year', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-02-30';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for Feb 29 in non-leap year', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2025-02-29'; // 2025 is not a leap year

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts Feb 29 in leap year', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2024-02-29'; // 2024 is a leap year

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
  });

  it('returns 400 for malformed date like 99/99/9999', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '99/99/9999';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for year before 2024', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '2023-12-31';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for year far in future', async () => {
    const payload = validBody();
    payload.observation.metadata.date = '9999-09-09';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for date beyond tomorrow (validates full date not just year)', async () => {
    const payload = validBody();
    // Calculate a date 1 week from now
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0]!;

    payload.observation.metadata.date = nextWeekStr;
    // Use guaranteed past times (2 and 1 hours ago) to ensure this test validates
    // date range, not future datetime validation
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    payload.observation.metadata.startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    payload.observation.metadata.endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid time format', async () => {
    const payload = validBody();
    payload.observation.metadata.startTime = '25:60'; // Invalid hours and minutes

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when endTime is before startTime', async () => {
    const payload = validBody();
    payload.observation.metadata.startTime = '15:00';
    payload.observation.metadata.endTime = '14:00'; // Before start

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for observation dated in the future', async () => {
    const payload = validBody();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0]!;

    payload.observation.metadata.date = tomorrowStr;
    payload.observation.metadata.startTime = '12:00';
    payload.observation.metadata.endTime = '13:00';

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for observation starting in the future (today but future time)', async () => {
    const payload = validBody();
    const now = new Date();
    const futureTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

    payload.observation.metadata.date = now.toISOString().split('T')[0]!;
    payload.observation.metadata.startTime = futureTime.toTimeString().slice(0, 5);
    payload.observation.metadata.endTime = new Date(futureTime.getTime() + 60 * 60 * 1000).toTimeString().slice(0, 5);

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts request without emails (download-only submission)', async () => {
    const payload = validBody();
    delete (payload as { emails?: string[] }).emails;

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().emailsSent).toBe(0);
  });

  it('preserves all optional observation fields in database', async () => {
    const payload = {
      observation: {
        metadata: {
          observerName: 'TestObserver',
          date: '2025-11-29',
          startTime: '14:00',
          endTime: '14:30',
          aviary: 'sayyidas-cove',
          mode: 'live' as const,
        },
        observations: {
          '14:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_object',
              location: '12',
              notes: 'Playing with toy',
              object: 'other',
              objectOther: 'Custom enrichment item',
            },
          ],
          '14:05': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_animal',
              location: 'G',
              notes: '',
              animal: 'other',
              animalOther: 'Unknown species',
              animalInteractionType: 'other',
              animalInteractionTypeOther: 'Mutual grooming',
            },
          ],
          '14:10': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'other',
              location: '5',
              notes: '',
              description: 'Unusual stretching behavior',
            },
          ],
        },
        submittedAt: '2025-11-29T20:00:00.000Z',
      },
      emails: ['test@example.com'],
    };

    await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    const result = await query<{ time_slots: Record<string, unknown[]> }>(
      'SELECT time_slots FROM observations'
    );

    const timeSlots = result.rows[0]?.time_slots;

    // Check interacting_object fields
    const objectSlot = timeSlots?.['14:00']?.[0] as Record<string, string>;
    expect(objectSlot.object).toBe('other');
    expect(objectSlot.objectOther).toBe('Custom enrichment item');

    // Check interacting_animal fields
    const animalSlot = timeSlots?.['14:05']?.[0] as Record<string, string>;
    expect(animalSlot.animal).toBe('other');
    expect(animalSlot.animalOther).toBe('Unknown species');
    expect(animalSlot.animalInteractionType).toBe('other');
    expect(animalSlot.animalInteractionTypeOther).toBe('Mutual grooming');

    // Check description field
    const descSlot = timeSlots?.['14:10']?.[0] as Record<string, string>;
    expect(descSlot.description).toBe('Unusual stretching behavior');
  });

  it('sends email with Excel attachment when emails provided', async () => {
    const payload = validBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    
    const body = response.json();
    expect(body.emailsSent).toBe(1);

    // Verify email service was called with correct params
    expect(mockSendObservationEmail).toHaveBeenCalledTimes(1);
    expect(mockSendObservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['test@example.com'],
        observerName: 'TestObserver',
        date: '2025-11-29',
        patient: 'Sayyida',
        excelBuffer: expect.any(Buffer),
      })
    );
  });

  it('does not send email when no emails provided', async () => {
    const payload = validBody();
    delete (payload as { emails?: string[] }).emails;

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    
    const body = response.json();
    expect(body.emailsSent).toBe(0);
    expect(mockSendObservationEmail).not.toHaveBeenCalled();
  });

  it('does not send email when emails is empty array', async () => {
    const payload = {
      ...validBody(),
      emails: [],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    
    const body = response.json();
    expect(body.emailsSent).toBe(0);
    expect(mockSendObservationEmail).not.toHaveBeenCalled();
  });

  it('reports partial success when some emails fail', async () => {
    // First call succeeds, second fails
    mockSendObservationEmail
      .mockResolvedValueOnce({ success: true, messageId: 'msg-1' })
      .mockResolvedValueOnce({ success: false, error: 'Invalid email' });

    const payload = {
      ...validBody(),
      emails: ['good@example.com', 'bad@example.com'],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload,
    });

    expect(response.statusCode).toBe(201);
    
    const body = response.json();
    expect(body.emailsSent).toBe(1); // Only 1 succeeded
    expect(mockSendObservationEmail).toHaveBeenCalledTimes(2);
  });

  it('succeeds even when Excel generation fails', async () => {
    // Reset to default success mock first, then override for this test
    mockGenerateExcelBuffer.mockReset();
    mockGenerateExcelBuffer.mockRejectedValue(new Error('Excel generation failed'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/submit',
      payload: validBody(),
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.emailsSent).toBe(0); // No emails sent when Excel fails
    expect(mockSendObservationEmail).not.toHaveBeenCalled();
  });

  describe('array-native slots', () => {
    // Array-native request: no metadata.patient, aviary sent as the slug
    const validArrayBody = () => ({
      observation: {
        metadata: {
          observerName: 'TestObserver',
          date: '2025-11-29',
          startTime: '14:00',
          endTime: '14:30',
          aviary: 'sayyidas-cove',
          mode: 'live' as const,
        },
        observations: {
          '14:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'resting_alert',
              location: '12',
              notes: 'Alert on perch',
            },
            {
              subjectType: 'juvenile' as const,
              subjectId: 'Juvenile 1',
              behavior: 'flying',
              location: '',
              notes: '',
            },
          ],
          '14:05': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'flying',
              location: '',
              notes: '',
            },
          ],
        },
        submittedAt: '2025-11-29T20:00:00.000Z',
      },
      emails: ['test@example.com'],
    });

    it('accepts array slots without metadata.patient and resolves the aviary slug', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload: validArrayBody(),
      });

      expect(response.statusCode).toBe(201);

      const result = await query<{ aviary: string; aviary_id: string | null }>(
        'SELECT aviary, aviary_id FROM observations'
      );
      const row = result.rows[0]!;
      // The varchar column receives the display name, not the slug
      expect(row.aviary).toBe("Sayyida's Cove");
      expect(row.aviary_id).not.toBeNull();
    });

    it('stores array slots as sent, preserving every subject', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload: validArrayBody(),
      });

      const result = await query<{ time_slots: Record<string, unknown[]> }>(
        'SELECT time_slots FROM observations'
      );

      const slot = result.rows[0]!.time_slots['14:00']!;
      expect(slot).toHaveLength(2);
      expect(slot[0]).toMatchObject({
        subjectType: 'foster_parent',
        subjectId: 'Sayyida',
        behavior: 'resting_alert',
        location: '12',
      });
      expect(slot[1]).toMatchObject({
        subjectType: 'juvenile',
        subjectId: 'Juvenile 1',
        behavior: 'flying',
      });
    });

    it('returns 400 for a legacy flat (single-subject object) slot', async () => {
      // The flat wire shape died in stage 2D
      const payload = validArrayBody();
      (payload.observation.observations as Record<string, unknown>)['14:10'] = {
        behavior: 'preening',
        location: '3',
        notes: '',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for an empty array slot', async () => {
      const payload = validArrayBody();
      (payload.observation.observations as Record<string, unknown>)['14:10'] = [];

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for an array entry without subject identity', async () => {
      const payload = validArrayBody();
      (payload.observation.observations as Record<string, unknown>)['14:10'] = [
        { behavior: 'flying', location: '', notes: '' },
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts subjects not resident in the aviary (warn-only, P2-D5)', async () => {
      const payload = validArrayBody();
      payload.observation.observations['14:05']![0]!.subjectId = 'Definitely Not Resident';

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(201);

      const result = await query<{ time_slots: Record<string, unknown[]> }>(
        'SELECT time_slots FROM observations'
      );
      expect(result.rows[0]!.time_slots['14:05']![0]).toMatchObject({
        subjectId: 'Definitely Not Resident',
      });
    });

    it('derives the email patient label from the subject list when patient is absent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload: validArrayBody(),
      });

      expect(response.statusCode).toBe(201);
      expect(mockSendObservationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          patient: 'Sayyida, Juvenile 1',
        })
      );
    });

    it('passes an unknown aviary value through to the varchar column unchanged', async () => {
      const payload = validArrayBody();
      payload.observation.metadata.aviary = 'some-future-aviary';

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(201);

      const result = await query<{ aviary: string; aviary_id: string | null }>(
        'SELECT aviary, aviary_id FROM observations'
      );
      expect(result.rows[0]!.aviary).toBe('some-future-aviary');
      expect(result.rows[0]!.aviary_id).toBeNull();
    });

    it('ignores a stray metadata.patient key (removed in stage 2D)', async () => {
      const payload = validBody();
      (payload.observation.metadata as { patient?: string }).patient = 'Sayyida';

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      // Unknown keys are stripped by the schema, not rejected
      expect(response.statusCode).toBe(201);
    });

    it('returns 400 when observations has no time slots', async () => {
      const payload = validArrayBody();
      (payload.observation as { observations: unknown }).observations = {};

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for a per-subject observation not wrapped in an array', async () => {
      // With the flat branch gone (stage 2D), a bare object fails the array
      // schema outright — no silent re-attribution is possible
      const payload = validBody();
      (payload.observation.observations as Record<string, unknown>)['14:10'] = {
        subjectType: 'juvenile',
        subjectId: 'Juvenile 1',
        behavior: 'flying',
        location: '',
        notes: '',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for a slot with more than 20 subject entries', async () => {
      const payload = validArrayBody();
      (payload.observation.observations as Record<string, unknown>)['14:10'] = Array.from(
        { length: 21 },
        (_, i) => ({
          subjectType: 'juvenile',
          subjectId: `Juvenile ${i + 1}`,
          behavior: 'flying',
          location: '',
          notes: '',
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('passes the resolved display name and derived patient label to Excel generation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/observations/submit',
        payload: validArrayBody(),
      });

      expect(response.statusCode).toBe(201);
      expect(mockGenerateExcelBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            aviary: "Sayyida's Cove",
            patient: 'Sayyida, Juvenile 1',
          }),
        })
      );
    });
  });
});

describe('POST /api/observations/:id/share', () => {
  beforeEach(async () => {
    await query('DELETE FROM observations');
    vi.clearAllMocks();
    clearAllRateLimits();
    // Reset mocks to default success behavior
    mockGenerateExcelBuffer.mockResolvedValue(Buffer.from('mock-excel-data'));
    mockSendObservationEmail.mockResolvedValue({ success: true, messageId: 'mock-id' });
  });

  it('sends email with Excel attachment for valid request', async () => {
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Excel sent to 1 recipient(s)');
    expect(body.emailsSent).toBe(1);
    expect(mockSendObservationEmail).toHaveBeenCalledTimes(1);
    expect(mockGenerateExcelBuffer).toHaveBeenCalledTimes(1);
  });

  it('derives the patient label from all subjects in the row (same rule as submit)', async () => {
    const result = await query<{ id: string }>(
      `INSERT INTO observations (
        observer_name, observation_date, start_time, end_time, aviary, mode, time_slots, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        'TestObserver',
        '2025-11-29',
        '14:00',
        '14:30',
        "Sayyida's Cove",
        'live',
        JSON.stringify({
          '14:00': [
            { subjectType: 'foster_parent', subjectId: 'Sayyida', behavior: 'resting', location: '5', notes: '' },
            { subjectType: 'juvenile', subjectId: 'Juvenile 1', behavior: 'flying', location: '', notes: '' },
          ],
        }),
        '2025-11-29T20:00:00.000Z',
      ]
    );
    const id = result.rows[0]!.id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(200);
    expect(mockSendObservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ patient: 'Sayyida, Juvenile 1' })
    );
  });

  it('returns 404 for non-existent observation', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${fakeId}/share`,
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 (not 500) for a malformed observation id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/observations/not-a-uuid/share',
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid email', async () => {
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for missing email field', async () => {
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 when email sending fails', async () => {
    const id = await insertTestObservation();
    mockSendObservationEmail.mockResolvedValue({ success: false, error: 'SMTP error' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMAIL_ERROR');
  });

  // Note: We don't test that requests succeed after the rate limit window expires
  // because that would require either time mocking or waiting an hour.
  // The rate limiter logic is simple enough that testing the limit is sufficient.
  it('returns 429 after exceeding rate limit', async () => {
    const id = await insertTestObservation();

    // Make 3 requests (the limit)
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/observations/${id}/share`,
        payload: { emails: ['user@example.com'] },
      });
      expect(response.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const response = await app.inject({
      method: 'POST',
      url: `/api/observations/${id}/share`,
      payload: { emails: ['user@example.com'] },
    });

    expect(response.statusCode).toBe(429);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('GET /api/observations/:id/excel', () => {
  beforeEach(async () => {
    await query('DELETE FROM observations');
    vi.clearAllMocks();
    // Reset mocks to default success behavior
    mockGenerateExcelBuffer.mockResolvedValue(Buffer.from('mock-excel-data'));
  });

  it('returns Excel file for valid observation', async () => {
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'GET',
      url: `/api/observations/${id}/excel`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('.xlsx');
    expect(mockGenerateExcelBuffer).toHaveBeenCalledTimes(1);
  });

  it('passes HH:MM times to Excel generation (Postgres time columns serialize as HH:MM:SS)', async () => {
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'GET',
      url: `/api/observations/${id}/excel`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockGenerateExcelBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          startTime: '14:00',
          endTime: '14:30',
        }),
      })
    );
  });

  it('resolves an unstamped row to config version 1 for Excel generation', async () => {
    // insertTestObservation writes no config_version_id — the NULL → MIN(id)
    // fallback must supply version 1's document to the generator.
    const id = await insertTestObservation();

    const response = await app.inject({
      method: 'GET',
      url: `/api/observations/${id}/excel`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockGenerateExcelBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          behaviors: expect.arrayContaining([
            expect.objectContaining({ value: 'eating', excelRowOrder: 1 }),
          ]),
        }),
      })
    );
  });

  it('returns 404 for non-existent observation', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await app.inject({
      method: 'GET',
      url: `/api/observations/${fakeId}/excel`,
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 (not 500) for a malformed observation id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/observations/not-a-uuid/excel',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns 500 when Excel generation fails', async () => {
    const id = await insertTestObservation();
    mockGenerateExcelBuffer.mockRejectedValue(new Error('Excel generation failed'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/observations/${id}/excel`,
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVER_ERROR');
  });
});

// The resolution helpers run inside rolled-back transactions so the seeded
// aviary/subject state other test files assert on is never disturbed.
describe('resolveAviary', () => {
  const withTxn = async (fn: (db: { query: typeof pool.query }, client: import('pg').PoolClient) => Promise<void>) => {
    const client = await pool.connect();
    const db = {
      query: ((text: string, params?: unknown[]) => client.query(text, params)) as typeof pool.query,
    };
    try {
      await client.query('BEGIN');
      await fn(db, client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  it('resolves the seeded aviary by slug only (display names died in 2D)', async () => {
    const bySlug = await resolveAviary('sayyidas-cove');
    const byName = await resolveAviary("Sayyida's Cove");

    expect(bySlug?.name).toBe("Sayyida's Cove");
    expect(byName).toBeNull();
  });

  it('returns null for an unknown value', async () => {
    expect(await resolveAviary('no-such-aviary')).toBeNull();
  });

  it('is unambiguous when a display name collides with another aviary\'s slug', async () => {
    await withTxn(async (db, client) => {
      // Aviary A's display name equals aviary B's slug — slug-only lookup
      // makes this deterministic: B wins, always
      await client.query(
        `INSERT INTO aviaries (slug, name) VALUES ('collision-a', 'collision-target')`
      );
      const b = await client.query<{ id: string }>(
        `INSERT INTO aviaries (slug, name) VALUES ('collision-target', 'Collision B') RETURNING id`
      );

      const resolved = await resolveAviary('collision-target', db);
      expect(resolved?.id).toBe(b.rows[0]!.id);
      expect(resolved?.name).toBe('Collision B');
    });
  });
});

describe('findNonResidentSubjects', () => {
  it('returns an empty list without querying when no subjects are given', async () => {
    expect(await findNonResidentSubjects('00000000-0000-0000-0000-000000000000', '2026-01-01', [])).toEqual([]);
  });

  it('applies half-open residency episodes [arrived_on, departed_on)', async () => {
    const client = await pool.connect();
    const db = {
      query: ((text: string, params?: unknown[]) => client.query(text, params)) as typeof pool.query,
    };
    try {
      await client.query('BEGIN');
      const aviary = await client.query<{ id: string }>(
        `INSERT INTO aviaries (slug, name) VALUES ('residency-test', 'Residency Test') RETURNING id`
      );
      const aviaryId = aviary.rows[0]!.id;
      await client.query(
        `INSERT INTO subjects (aviary_id, name, species, subject_type, arrived_on, departed_on)
         VALUES ($1, 'Kestrel', 'American Kestrel', 'juvenile', '2026-01-10', '2026-02-01')`,
        [aviaryId]
      );

      // Before arrival: not resident
      expect(await findNonResidentSubjects(aviaryId, '2026-01-09', ['Kestrel'], db)).toEqual(['Kestrel']);
      // On the arrival date: resident
      expect(await findNonResidentSubjects(aviaryId, '2026-01-10', ['Kestrel'], db)).toEqual([]);
      // Day before departure: resident
      expect(await findNonResidentSubjects(aviaryId, '2026-01-31', ['Kestrel'], db)).toEqual([]);
      // On the departure date: no longer resident (half-open)
      expect(await findNonResidentSubjects(aviaryId, '2026-02-01', ['Kestrel'], db)).toEqual(['Kestrel']);
      // Unknown names are always non-resident
      expect(await findNonResidentSubjects(aviaryId, '2026-01-15', ['Kestrel', 'Ghost'], db)).toEqual(['Ghost']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
