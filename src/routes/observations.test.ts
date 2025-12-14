import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { sendObservationEmail } from '../services/email.js';
import { generateExcelBuffer } from '../services/excel.js';
import { clearAllRateLimits } from '../utils/rateLimit.js';

// Mock the email service to avoid hitting real API
vi.mock('../services/email.js', () => ({
  sendObservationEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-id' }),
}));

// Mock the Excel service to avoid running real generation in tests
vi.mock('../services/excel.js', () => ({
  generateExcelBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-excel-data')),
}));

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

// Helper to create a valid request body
const validBody = () => ({
  observation: {
    metadata: {
      observerName: 'TestObserver',
      date: '2025-11-29',
      startTime: '14:00',
      endTime: '14:30',
      aviary: "Sayyida's Cove",
      patient: 'Sayyida',
      mode: 'live' as const,
    },
    observations: {
      '14:00': {
        behavior: 'resting_alert',
        location: '12',
        notes: 'Test observation',
      },
      '14:05': {
        behavior: 'flying',
        location: '',
        notes: '',
      },
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

  it('transforms observations to array format with subject info', async () => {
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

    // Check that observations are wrapped in arrays with subject info
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
          aviary: "Sayyida's Cove",
          patient: 'Sayyida',
          mode: 'live' as const,
        },
        observations: {
          '14:00': {
            behavior: 'interacting_object',
            location: '12',
            notes: 'Playing with toy',
            object: 'other',
            objectOther: 'Custom enrichment item',
          },
          '14:05': {
            behavior: 'interacting_animal',
            location: 'G',
            notes: '',
            animal: 'other',
            animalOther: 'Unknown species',
            interactionType: 'other',
            interactionTypeOther: 'Mutual grooming',
          },
          '14:10': {
            behavior: 'other',
            location: '5',
            notes: '',
            description: 'Unusual stretching behavior',
          },
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
    expect(animalSlot.interactionType).toBe('other');
    expect(animalSlot.interactionTypeOther).toBe('Mutual grooming');

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
