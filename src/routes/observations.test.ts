import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/observations/submit', () => {
  let app: FastifyInstance;

  // Build app before all tests
  beforeAll(async () => {
    app = await buildApp();
  });

  // Clean up observations table before each test
  beforeEach(async () => {
    await query('DELETE FROM observations');
  });

  // Close pool after all tests
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
});
