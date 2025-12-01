/**
 * Manual test to generate Excel file with formatting
 */
import { generateExcelBuffer } from '../src/services/excel.js';
import { writeFileSync } from 'fs';

const testData = {
  metadata: {
    observerName: 'TestUser',
    date: '2025-11-30',
    startTime: '14:00',
    endTime: '14:30',
    aviary: "Sayyida's Cove",
    patient: 'Sayyida',
    mode: 'live' as const,
  },
  observations: {
    '14:00': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'resting_alert',
        location: '12',
        notes: 'Alert, watching stream',
        object: '',
        objectOther: '',
        animal: '',
        animalOther: '',
        interactionType: '',
        interactionTypeOther: '',
        description: '',
      },
    ],
    '14:05': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'preening',
        location: '12',
        notes: '',
        object: '',
        objectOther: '',
        animal: '',
        animalOther: '',
        interactionType: '',
        interactionTypeOther: '',
        description: '',
      },
    ],
    '14:10': [
      {
        subjectType: 'foster_parent' as const,
        subjectId: 'Sayyida',
        behavior: 'flying',
        location: '',
        notes: 'Short flight',
        object: '',
        objectOther: '',
        animal: '',
        animalOther: '',
        interactionType: '',
        interactionTypeOther: '',
        description: '',
      },
    ],
  },
  submittedAt: new Date().toISOString(),
};

async function main() {
  console.log('Generating formatted Excel file...');
  const buffer = await generateExcelBuffer(testData);
  const filename = 'notes/test-formatted-output.xlsx';
  writeFileSync(filename, buffer);
  console.log(`✅ Generated: ${filename}`);
  console.log('\nRun the comparison script to verify formatting:');
  console.log('  cd notes && python3 detailed_excel_analysis.py');
}

main().catch(console.error);
