import { describe, it, expect } from 'vitest';
import { generateExcelWorkbook, generateExcelBuffer } from './excel.js';

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
    '10:00': {
      behavior: 'resting_alert',
      location: '5',
      notes: 'Looking around',
    },
    '10:05': {
      behavior: 'preening',
      location: '5',
    },
    '10:10': {
      behavior: 'flying',
    },
    '10:15': {
      behavior: 'interacting_object',
      location: '12',
      object: 'enrichment_toy',
    },
    '10:20': {
      behavior: 'interacting_animal',
      location: 'G',
      animal: 'squirrel',
      interactionType: 'watching',
    },
  },
  submittedAt: '2025-11-29T15:00:00.000Z',
};

describe('Excel Service', () => {
  describe('generateExcelWorkbook', () => {
    it('should create a workbook with correct metadata', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Ethogram Data');

      expect(worksheet).toBeDefined();
      expect(worksheet?.getCell('A1').value).toBe('Rehabilitation Raptor Ethogram');
      expect(worksheet?.getCell('C1').value).toBe('2025-11-29');
      expect(worksheet?.getCell('K1').value).toBe('10:00 - 10:30');
      expect(worksheet?.getCell('K2').value).toBe('Test Observer');
    });

    it('should generate correct time slot headers', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Ethogram Data');

      // Row 4 should have relative times starting at 0:00
      expect(worksheet?.getCell('B4').value).toBe('0:00');
      expect(worksheet?.getCell('C4').value).toBe('0:05');
      expect(worksheet?.getCell('D4').value).toBe('0:10');
      expect(worksheet?.getCell('E4').value).toBe('0:15');
      expect(worksheet?.getCell('F4').value).toBe('0:20');
      expect(worksheet?.getCell('G4').value).toBe('0:25');
      expect(worksheet?.getCell('H4').value).toBe('0:30');
    });

    it('should mark observations in correct cells', async () => {
      const workbook = await generateExcelWorkbook(sampleObservation);
      const worksheet = workbook.getWorksheet('Ethogram Data');

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
      const worksheet = workbook.getWorksheet('Ethogram Data');

      // Find the interacting_object row
      let objectRow = 0;
      for (let row = 5; row <= 30; row++) {
        const cellValue = worksheet?.getCell(row, 1).value;
        if (cellValue === 'Interacting with Inanimate Object (Note Object)') {
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
      const worksheet = workbook.getWorksheet('Ethogram Data');

      // Find the interacting_animal row
      let animalRow = 0;
      for (let row = 5; row <= 30; row++) {
        const cellValue = worksheet?.getCell(row, 1).value;
        if (
          cellValue ===
          'Interacting with Other Animal (Note Animal & Type of Interaction)'
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
      expect(cell?.value).toContain('Interaction: watching');
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
