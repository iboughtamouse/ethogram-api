import { describe, it, expect } from 'vitest';
import { generateExcelWorkbook, generateExcelBuffer, behaviorRowsFor } from './excel.js';
import { TEST_CONFIG } from '../test-fixtures/config.js';

// Test data uses database format: observations are arrays of subject observations
const sampleObservation = {
  metadata: {
    observerName: 'Test Observer',
    date: '2025-11-29',
    startTime: '10:00',
    endTime: '10:30',
    aviary: "Sayyida's Cove",
    patient: 'Sayyida',
    mode: 'live' as const,
  },
  observations: {
    '10:00': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'resting_alert',
        location: '5',
        notes: 'Looking around',
      },
    ],
    '10:05': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'preening',
        location: '5',
      },
    ],
    '10:10': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'flying',
      },
    ],
    '10:15': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'interacting_object',
        location: '12',
        object: 'enrichment_toy',
      },
    ],
    '10:20': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'interacting_animal',
        location: 'G',
        animal: 'squirrel',
        animalInteractionType: 'watching',
      },
    ],
  },
  submittedAt: '2025-11-29T15:00:00.000Z',
  config: TEST_CONFIG,
};

describe('Excel Service', () => {
  describe('generateExcelWorkbook', () => {
    it('should create a workbook with correct metadata', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Sayyida');

      expect(worksheet).toBeDefined();
      expect(workbook.worksheets).toHaveLength(1);
      expect(worksheet?.getCell('A1').value).toBe('Rehabilitation Raptor Ethogram');
      expect(worksheet?.getCell('C1').value).toBe('2025-11-29');
      expect(worksheet?.getCell('K1').value).toBe('10:00 - 10:30');
      expect(worksheet?.getCell('A2').value).toBe("Aviary: Sayyida's Cove");
      expect(worksheet?.getCell('B2').value).toBe('Subject(s): Sayyida');
      expect(worksheet?.getCell('K2').value).toBe('Test Observer');
    });

    it('should generate correct time slot headers', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Row 4 should have actual timestamps (not relative)
      expect(worksheet?.getCell('B4').value).toBe('10:00');
      expect(worksheet?.getCell('C4').value).toBe('10:05');
      expect(worksheet?.getCell('D4').value).toBe('10:10');
      expect(worksheet?.getCell('E4').value).toBe('10:15');
      expect(worksheet?.getCell('F4').value).toBe('10:20');
      expect(worksheet?.getCell('G4').value).toBe('10:25');
      expect(worksheet?.getCell('H4').value).toBe('10:30');
    });

    it('should mark observations in correct cells', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Sayyida');

      // resting_alert is row 18 (5 + 13), 10:00 is column B (index 2)
      // Let's find the row by checking values
      let restingAlertRow = 0;
      for (let row = 5; row <= 30; row++) {
        const cellValue = worksheet?.getCell(row, 1).value;
        if (cellValue === 'Resting on Perch/Ground - Alert (Note Location)') {
          restingAlertRow = row;
          break;
        }
      }

      expect(restingAlertRow).toBeGreaterThan(0);
      
      // Column B (index 2) should have the observation mark for 10:00
      const cell = worksheet?.getCell(restingAlertRow, 2);
      expect(cell?.value).toContain('x');
      expect(cell?.value).toContain('Loc: 5');
      expect(cell?.value).toContain('Notes: Looking around');
    });

    it('should format interacting_object observations correctly', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Find the interacting_object row
      let objectRow = 0;
      for (let row = 5; row <= 30; row++) {
        const cellValue = worksheet?.getCell(row, 1).value;
        if (
          cellValue ===
          'Interacting with Inanimate Object (Note Location, Object & Interaction)'
        ) {
          objectRow = row;
          break;
        }
      }

      expect(objectRow).toBeGreaterThan(0);

      // 10:15 is the 4th slot, so column E (index 5)
      const cell = worksheet?.getCell(objectRow, 5);
      expect(cell?.value).toContain('x');
      expect(cell?.value).toContain('Loc: 12');
      expect(cell?.value).toContain('Object: enrichment_toy');
    });

    it('should format interacting_animal observations correctly', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Find the interacting_animal row
      let animalRow = 0;
      for (let row = 5; row <= 30; row++) {
        const cellValue = worksheet?.getCell(row, 1).value;
        if (
          cellValue ===
          'Interacting with Other Animal (Note Location, Animal & Interaction)'
        ) {
          animalRow = row;
          break;
        }
      }

      expect(animalRow).toBeGreaterThan(0);

      // 10:20 is the 5th slot, so column F (index 6)
      const cell = worksheet?.getCell(animalRow, 6);
      expect(cell?.value).toContain('x');
      expect(cell?.value).toContain('Loc: G');
      expect(cell?.value).toContain('Animal: squirrel');
      expect(cell?.value).toContain('Animal Interaction: watching');
    });

    it('should include object interaction type for interacting_object', async () => {
      const dataWithObjectInteraction = {
        ...sampleObservation,
        observations: {
          '10:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_object',
              location: '12',
              object: 'rope_ball',
              objectInteractionType: 'biting',
            },
          ],
        },
      };

      const workbook = await generateExcelWorkbook(dataWithObjectInteraction);
      const worksheet = workbook.getWorksheet('Sayyida');

      let objectRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (
          worksheet?.getCell(row, 1).value ===
          'Interacting with Inanimate Object (Note Location, Object & Interaction)'
        ) {
          objectRow = row;
          break;
        }
      }

      // 10:00 is the first slot, so column B (index 2)
      const cell = worksheet?.getCell(objectRow, 2);
      expect(cell?.value).toContain('Object: rope_ball');
      expect(cell?.value).toContain('Object Interaction: biting');
    });

    it('should use "Other" field values when type is "other"', async () => {
      const dataWithOther = {
        ...sampleObservation,
        observations: {
          '10:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_object',
              location: '5',
              object: 'other',
              objectOther: 'Custom toy description',
            },
          ],
          '10:05': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_animal',
              location: 'G',
              animal: 'other',
              animalOther: 'Unknown bird species',
              animalInteractionType: 'other',
              animalInteractionTypeOther: 'Mutual observation',
            },
          ],
        },
      };

      const workbook = await generateExcelWorkbook(dataWithOther);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Find interacting_object row
      let objectRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (
          worksheet?.getCell(row, 1).value ===
          'Interacting with Inanimate Object (Note Location, Object & Interaction)'
        ) {
          objectRow = row;
          break;
        }
      }

      const objectCell = worksheet?.getCell(objectRow, 2);
      expect(objectCell?.value).toContain('Object: Custom toy description');

      // Find interacting_animal row
      let animalRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (
          worksheet?.getCell(row, 1).value ===
          'Interacting with Other Animal (Note Location, Animal & Interaction)'
        ) {
          animalRow = row;
          break;
        }
      }

      const animalCell = worksheet?.getCell(animalRow, 3); // 10:05 is column C
      expect(animalCell?.value).toContain('Animal: Unknown bird species');
      expect(animalCell?.value).toContain('Animal Interaction: Mutual observation');
    });

    it('should fallback to "other" when otherField is missing', async () => {
      const dataWithMissingOther = {
        ...sampleObservation,
        observations: {
          '10:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'interacting_object',
              location: '5',
              object: 'other',
              // objectOther is missing
            },
          ],
        },
      };

      const workbook = await generateExcelWorkbook(dataWithMissingOther);
      const worksheet = workbook.getWorksheet('Sayyida');

      let objectRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (
          worksheet?.getCell(row, 1).value ===
          'Interacting with Inanimate Object (Note Location, Object & Interaction)'
        ) {
          objectRow = row;
          break;
        }
      }

      const cell = worksheet?.getCell(objectRow, 2);
      // Should fallback to 'other' instead of showing 'undefined'
      expect(cell?.value).toContain('Object: other');
      expect(cell?.value).not.toContain('undefined');
    });

    it('should include description field in cell content', async () => {
      const dataWithDescription = {
        ...sampleObservation,
        observations: {
          '10:00': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'other',
              location: '5',
              description: 'Unusual wing-stretching behavior',
            },
          ],
        },
      };

      const workbook = await generateExcelWorkbook(dataWithDescription);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Find "Other" behavior row
      let otherRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (worksheet?.getCell(row, 1).value === 'Other') {
          otherRow = row;
          break;
        }
      }

      const cell = worksheet?.getCell(otherRow, 2);
      expect(cell?.value).toContain('Description: Unusual wing-stretching behavior');
    });

    it('should handle midnight crossing for time slots', async () => {
      const midnightData = {
        metadata: {
          observerName: 'Night Observer',
          date: '2025-11-29',
          startTime: '23:50',
          endTime: '00:10',
          aviary: "Sayyida's Cove",
          patient: 'Sayyida',
          mode: 'live' as const,
        },
        observations: {
          '23:50': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'resting_alert',
              location: '5',
            },
          ],
          '00:05': [
            {
              subjectType: 'foster_parent' as const,
              subjectId: 'Sayyida',
              behavior: 'flying',
            },
          ],
        },
        submittedAt: '2025-11-30T00:15:00.000Z',
        config: TEST_CONFIG,
      };

      const workbook = await generateExcelWorkbook(midnightData);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Time headers should show actual timestamps (not relative)
      expect(worksheet?.getCell('B4').value).toBe('23:50');
      expect(worksheet?.getCell('C4').value).toBe('23:55');
      expect(worksheet?.getCell('D4').value).toBe('00:00');
      expect(worksheet?.getCell('E4').value).toBe('00:05');
      expect(worksheet?.getCell('F4').value).toBe('00:10');

      // Find flying row and check 00:05 observation is in correct column
      let flyingRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (worksheet?.getCell(row, 1).value === 'Locomotion - Flying') {
          flyingRow = row;
          break;
        }
      }

      // 00:05 is the 4th slot (0:15 relative), column E (index 5)
      expect(worksheet?.getCell(flyingRow, 5).value).toContain('x');
    });

    it('should handle empty observations gracefully', async () => {
      const emptyData = {
        ...sampleObservation,
        observations: {},
      };

      const workbook = await generateExcelWorkbook(emptyData);
      const worksheet = workbook.getWorksheet('Sayyida');

      // Should still create the workbook with headers
      expect(worksheet?.getCell('A1').value).toBe('Rehabilitation Raptor Ethogram');
      // Behavior rows should exist but have no marks
      expect(worksheet?.getCell('A5').value).toBeDefined();
    });
  });

  describe('behaviorRowsFor', () => {
    const smallConfig = {
      behaviors: [
        { value: 'flying', excelRowLabel: 'Locomotion - Flying', excelRowOrder: 8 },
        { value: 'eating', excelRowLabel: 'Eating (Note Location)', excelRowOrder: 1 },
        { value: 'other', excelRowLabel: 'Other', excelRowOrder: 23 },
      ],
      aviaries: [
        { name: 'Small Aviary', vocabulary: { behaviors: ['eating', 'other'] } },
      ],
    };

    it('filters rows to the aviary\'s enabled behaviors, in excelRowOrder', () => {
      expect(behaviorRowsFor(smallConfig, 'Small Aviary', {})).toEqual([
        { value: 'eating', label: 'Eating (Note Location)' },
        { value: 'other', label: 'Other' },
      ]);
    });

    it('keeps a disabled behavior\'s row when it is present in the data (Phase 2 §4 alignment)', () => {
      const observations = {
        '10:00': [
          {
            subjectType: 'foster_parent' as const,
            subjectId: 'Sayyida',
            behavior: 'flying',
          },
        ],
      };

      expect(behaviorRowsFor(smallConfig, 'Small Aviary', observations)).toEqual([
        { value: 'eating', label: 'Eating (Note Location)' },
        { value: 'flying', label: 'Locomotion - Flying' },
        { value: 'other', label: 'Other' },
      ]);
    });

    it('ignores data values absent from the catalog (no label to render)', () => {
      const observations = {
        '10:00': [
          {
            subjectType: 'foster_parent' as const,
            subjectId: 'Sayyida',
            behavior: 'not_in_catalog',
          },
        ],
      };

      expect(behaviorRowsFor(smallConfig, 'Small Aviary', observations)).toEqual([
        { value: 'eating', label: 'Eating (Note Location)' },
        { value: 'other', label: 'Other' },
      ]);
    });

    it('falls back to the full catalog for an aviary the config does not know', () => {
      const rows = behaviorRowsFor(TEST_CONFIG, 'Some Unknown Aviary', {});
      expect(rows).toHaveLength(23);
      expect(rows[0]).toEqual({ value: 'eating', label: 'Eating (Note Location)' });
      expect(rows[22]).toEqual({ value: 'other', label: 'Other' });
    });
  });

  describe('multi-subject workbooks (P2-D3)', () => {
    const multiSubjectObservation = {
      metadata: {
        observerName: 'Test Observer',
        date: '2025-11-29',
        startTime: '10:00',
        endTime: '10:10',
        aviary: "Sayyida's Cove",
        patient: 'Sayyida, Juvenile 1',
        mode: 'live' as const,
      },
      observations: {
        '10:00': [
          {
            subjectType: 'foster_parent' as const,
            subjectId: 'Sayyida',
            behavior: 'resting_alert',
            location: '5',
            notes: 'Watching',
          },
          {
            subjectType: 'juvenile' as const,
            subjectId: 'Juvenile 1',
            behavior: 'resting_alert',
            location: '12',
            notes: 'Also watching',
          },
        ],
        '10:05': [
          {
            subjectType: 'juvenile' as const,
            subjectId: 'Juvenile 1',
            behavior: 'flying',
          },
        ],
      },
      submittedAt: '2025-11-29T15:00:00.000Z',
      config: TEST_CONFIG,
    };

    it('creates one worksheet per subject, in slot order', async () => {
      const workbook = await generateExcelWorkbook(multiSubjectObservation);

      expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Sayyida', 'Juvenile 1']);
    });

    it('renders each subject\'s own data in its sheet, including a shared behavior/slot', async () => {
      const workbook = await generateExcelWorkbook(multiSubjectObservation);
      const sayyida = workbook.getWorksheet('Sayyida');
      const juvenile = workbook.getWorksheet('Juvenile 1');

      // Find the resting_alert row (same row index on both sheets — identical matrix)
      let restingRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (
          sayyida?.getCell(row, 1).value ===
          'Resting on Perch/Ground - Alert (Note Location)'
        ) {
          restingRow = row;
          break;
        }
      }
      expect(restingRow).toBeGreaterThan(0);
      expect(juvenile?.getCell(restingRow, 1).value).toBe(
        'Resting on Perch/Ground - Alert (Note Location)'
      );

      // 10:00 is column B — each sheet carries its own subject's details
      expect(sayyida?.getCell(restingRow, 2).value).toContain('Loc: 5');
      expect(sayyida?.getCell(restingRow, 2).value).toContain('Notes: Watching');
      expect(juvenile?.getCell(restingRow, 2).value).toContain('Loc: 12');
      expect(juvenile?.getCell(restingRow, 2).value).toContain('Notes: Also watching');

      // 10:05 flying belongs to the juvenile only
      let flyingRow = 0;
      for (let row = 5; row <= 30; row++) {
        if (sayyida?.getCell(row, 1).value === 'Locomotion - Flying') {
          flyingRow = row;
          break;
        }
      }
      expect(juvenile?.getCell(flyingRow, 3).value).toContain('x');
      expect(sayyida?.getCell(flyingRow, 3).value).toBeNull();
    });

    it('labels each sheet\'s header with its own full subject name', async () => {
      const workbook = await generateExcelWorkbook(multiSubjectObservation);

      expect(workbook.getWorksheet('Sayyida')?.getCell('B2').value).toBe(
        'Subject(s): Sayyida'
      );
      expect(workbook.getWorksheet('Juvenile 1')?.getCell('B2').value).toBe(
        'Subject(s): Juvenile 1'
      );
    });

    it('sanitizes, truncates, and de-duplicates worksheet names', async () => {
      const longNameA = 'A Very Long Juvenile Subject Name Indeed [Band 1]';
      const longNameB = 'A Very Long Juvenile Subject Name Indeed [Band 2]';
      const data = {
        ...multiSubjectObservation,
        observations: {
          '10:00': [
            {
              subjectType: 'juvenile' as const,
              subjectId: 'Kes: trel?',
              behavior: 'flying',
            },
            {
              subjectType: 'juvenile' as const,
              subjectId: longNameA,
              behavior: 'flying',
            },
            {
              subjectType: 'juvenile' as const,
              subjectId: longNameB,
              behavior: 'flying',
            },
          ],
        },
      };

      const workbook = await generateExcelWorkbook(data);
      const names = workbook.worksheets.map((ws) => ws.name);

      // Forbidden characters replaced, whitespace collapsed
      expect(names[0]).toBe('Kes trel');
      // Truncated to <= 28 chars; identical prefixes get numeric suffixes
      expect(names[1]!.length).toBeLessThanOrEqual(28);
      expect(names[2]).toBe(`${names[1]} 2`);
      // Full names survive in each sheet's header row
      expect(workbook.worksheets[1]!.getCell('B2').value).toBe(`Subject(s): ${longNameA}`);
      expect(workbook.worksheets[2]!.getCell('B2').value).toBe(`Subject(s): ${longNameB}`);
    });
  });

  describe('generateExcelBuffer', () => {
    it('should return a valid buffer', async () => {
      const buffer = await generateExcelBuffer(sampleObservation);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      
      // Excel files start with PK (zip signature)
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });
  });
});
