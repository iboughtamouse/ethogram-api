/**
 * Excel Generation Service
 *
 * Converts observation data to Excel format matching the frontend's ethogram spreadsheet layout.
 * Uses a matrix format where behaviors are rows and time slots are columns.
 *
 * This service expects the DATABASE observation format:
 * { "14:00": [{ subjectType, subjectId, behavior, location, ... }] }
 *
 * Currently handles single-subject observations (takes first in array).
 * Multi-subject support will be added when the frontend supports it.
 */

import ExcelJS from 'exceljs';

/**
 * Maps behavior values to display labels for Excel rows
 */
const BEHAVIOR_ROW_MAPPING: Record<string, string> = {
  eating_food_platform: 'Eating - On Food Platform',
  eating_elsewhere: 'Eating - Elsewhere (Note Location)',
  walking_ground: 'Locomotion - Walking on Ground',
  walking_perch: 'Locomotion - Walking on Perch (Note Location)',
  flying: 'Locomotion - Flying',
  jumping: 'Locomotion - Jumping',
  repetitive_locomotion:
    'Repetitive Locomotion (Same movement 3+ times in a row)',
  drinking: 'Drinking (Note source if not from the water bowl)',
  bathing: 'Bathing',
  preening: 'Preening/Grooming (Note Location)',
  repetitive_preening:
    'Repetitive Preening/Feather Damage (Plucking, Mutilation, Etc.)',
  nesting: 'Nesting',
  vocalizing: 'Vocalizing',
  resting_alert: 'Resting on Perch/Ground - Alert (Note Location)',
  resting_not_alert: 'Resting on Perch/Ground - Not Alert (Note Location)',
  resting_unknown: 'Resting on Perch/Ground - Status Unknown (Note Location)',
  interacting_object: 'Interacting with Inanimate Object (Note Object)',
  interacting_animal:
    'Interacting with Other Animal (Note Animal & Type of Interaction)',
  aggression: 'Aggression or Defensive Posturing',
  not_visible: 'Not Visible',
  other: 'Other',
};

/**
 * Single subject observation within a time slot.
 * Database stores observations as: { "14:00": [{ subjectType, subjectId, behavior, ... }] }
 */
interface SubjectObservation {
  subjectType: 'foster_parent' | 'baby' | 'juvenile';
  subjectId: string;
  behavior: string;
  location?: string;
  notes?: string;
  object?: string;
  objectOther?: string;
  animal?: string;
  animalOther?: string;
  interactionType?: string;
  interactionTypeOther?: string;
  description?: string;
}

interface Metadata {
  observerName: string;
  date: string;
  startTime: string;
  endTime: string;
  aviary: string;
  patient: string;
  mode: 'live' | 'vod';
}

/**
 * Observation data as stored in the database.
 * observations is keyed by time slot, each containing an array of subject observations.
 */
interface ObservationData {
  metadata: Metadata;
  observations: Record<string, SubjectObservation[]>;
  submittedAt: string;
}

/**
 * Resolves "other" field values, falling back appropriately.
 * When value is "other", uses the custom otherValue if provided, otherwise "other".
 */
function resolveOtherField(
  value: string | undefined,
  otherValue: string | undefined
): string | undefined {
  if (!value) return undefined;
  return value === 'other' ? (otherValue || 'other') : value;
}

/**
 * Generates time slots every 5 minutes between start and end times.
 *
 * @param startTime - Start time in "HH:MM" format (assumes pre-validated input)
 * @param endTime - End time in "HH:MM" format (assumes pre-validated input)
 * @returns Array of time slot strings in "HH:MM" format
 */
function generateTimeSlots(startTime: string, endTime: string): string[] {
  if (!startTime || !endTime) return [];

  const slots: string[] = [];
  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);
  const startHours = startParts[0] ?? 0;
  const startMinutes = startParts[1] ?? 0;
  const endHours = endParts[0] ?? 0;
  const endMinutes = endParts[1] ?? 0;

  let startTotalMinutes = startHours * 60 + startMinutes;
  let endTotalMinutes = endHours * 60 + endMinutes;

  // Handle midnight crossing
  if (endTotalMinutes < startTotalMinutes) {
    endTotalMinutes += 24 * 60;
  }

  for (let minutes = startTotalMinutes; minutes <= endTotalMinutes; minutes += 5) {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const timeString = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    slots.push(timeString);
  }

  return slots;
}

/**
 * Converts absolute time to relative format based on start time
 */
function convertToRelativeTime(time: string, startTime: string): string {
  const timeParts = time.split(':').map(Number);
  const startParts = startTime.split(':').map(Number);
  const timeHours = timeParts[0] ?? 0;
  const timeMinutes = timeParts[1] ?? 0;
  const startHours = startParts[0] ?? 0;
  const startMinutes = startParts[1] ?? 0;

  let totalTimeMinutes = timeHours * 60 + timeMinutes;
  const totalStartMinutes = startHours * 60 + startMinutes;

  // Handle midnight crossing
  if (totalTimeMinutes < totalStartMinutes) {
    totalTimeMinutes += 24 * 60;
  }

  const diffMinutes = totalTimeMinutes - totalStartMinutes;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
/**
 * Formats observation details for a cell.
 * For multi-subject observations, formats each subject's data.
 */
function formatCellContent(observation: SubjectObservation): string {
  const parts = ['x'];

  if (observation.location) {
    parts.push(`Loc: ${observation.location}`);
  }

  const objectValue = resolveOtherField(observation.object, observation.objectOther);
  if (objectValue) {
    parts.push(`Object: ${objectValue}`);
  }

  const animalValue = resolveOtherField(observation.animal, observation.animalOther);
  if (animalValue) {
    parts.push(`Animal: ${animalValue}`);
  }

  const interactionValue = resolveOtherField(observation.interactionType, observation.interactionTypeOther);
  if (interactionValue) {
    parts.push(`Interaction: ${interactionValue}`);
  }

  if (observation.description) {
    parts.push(`Description: ${observation.description}`);
  }

  if (observation.notes) {
    parts.push(`Notes: ${observation.notes}`);
  }

  return parts.length > 1 ? parts.join('\n') : 'x';
}

/**
 * Generates an Excel workbook from observation data
 */
export async function generateExcelWorkbook(
  data: ObservationData
): Promise<ExcelJS.Workbook> {
  const { metadata, observations } = data;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Ethogram Data');

  const timeSlots = generateTimeSlots(metadata.startTime, metadata.endTime);

  // Set column widths for readability
  worksheet.getColumn('A').width = 35.0;  // Behavior labels column - increased ~35% from 25.75 to reduce wrapping
  worksheet.getColumn('B').width = 8.0;   // Time column (relative) - increased from 4.88 for readability
  // Columns C onwards (time slots) - set width 13.0
  for (let col = 3; col <= timeSlots.length + 1; col++) {
    worksheet.getColumn(col).width = 13.0;
  }
  worksheet.getColumn('J').width = 15.0;  // "Time Window:" and "Observer:" labels - wide enough for labels

  // Row 1: Title, Date, Time Window
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'Rehabilitation Raptor Ethogram';
  titleCell.font = { bold: true };
  
  const dateLabel = worksheet.getCell('B1');
  dateLabel.value = 'Date:';
  dateLabel.font = { bold: true };
  
  worksheet.getCell('C1').value = metadata.date;
  
  const timeWindowLabel = worksheet.getCell('J1');
  timeWindowLabel.value = 'Time Window:';
  timeWindowLabel.font = { bold: true };
  
  worksheet.getCell('K1').value = `${metadata.startTime} - ${metadata.endTime}`;

  // Row 2: Aviary, Patient, Observer
  const aviaryCell = worksheet.getCell('A2');
  aviaryCell.value = `Aviary: ${metadata.aviary}`;
  aviaryCell.font = { bold: true };
  
  const patientCell = worksheet.getCell('B2');
  patientCell.value = `Patient(s): ${metadata.patient}`;
  patientCell.font = { bold: true };
  
  const observerLabel = worksheet.getCell('J2');
  observerLabel.value = 'Observer:';
  observerLabel.font = { bold: true };
  
  worksheet.getCell('K2').value = metadata.observerName;

  // Row 3: "Time:" label (bold)
  const timeLabelCell = worksheet.getCell('B3');
  timeLabelCell.value = 'Time:';
  timeLabelCell.font = { bold: true };

  // Row 4: Time slot headers (relative format) - make bold
  timeSlots.forEach((time, index) => {
    const relativeTime = convertToRelativeTime(time, metadata.startTime);
    const columnIndex = index + 2; // Column B is index 2
    const headerCell = worksheet.getCell(4, columnIndex);
    headerCell.value = relativeTime;
    headerCell.font = { bold: true };
  });

  // Rows 5+: Behavior labels and observation marks
  const behaviorRows = Object.keys(BEHAVIOR_ROW_MAPPING);
  behaviorRows.forEach((behaviorValue, index) => {
    const rowIndex = 5 + index;
    const behaviorLabel = BEHAVIOR_ROW_MAPPING[behaviorValue];

    // Column A: Behavior label with text wrapping
    const labelCell = worksheet.getCell(rowIndex, 1);
    labelCell.value = behaviorLabel;
    labelCell.alignment = { wrapText: true, vertical: 'top' };

    // Check each time slot for this behavior
    timeSlots.forEach((time, timeIndex) => {
      const subjectObservations = observations[time];
      if (!subjectObservations) return;

      // Find observations matching this behavior (could be multiple subjects)
      const matchingObs = subjectObservations.filter(
        (obs) => obs.behavior === behaviorValue
      );

      if (matchingObs.length > 0) {
        const columnIndex = timeIndex + 2;
        // Currently single-subject: format first matching observation
        // Future: combine multiple subjects (e.g., "Sayyida: x\nBaby1: x")
        const cellContent = formatCellContent(matchingObs[0]!);
        const cell = worksheet.getCell(rowIndex, columnIndex);
        cell.value = cellContent;
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
    });
  });

  // Add comments section after all behaviors
  const commentsRowIndex = 5 + behaviorRows.length + 2;
  const commentsCell = worksheet.getCell(commentsRowIndex, 1);
  commentsCell.value = 'Comments (Abnormal Environmental Factors, Plant Growth, Etc):';
  commentsCell.alignment = { wrapText: true, vertical: 'top' };

  // Freeze panes at B5 (freeze top 4 rows and column A)
  worksheet.views = [
    { state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }
  ];

  return workbook;
}

/**
 * Generates an Excel file as a Buffer
 */
export async function generateExcelBuffer(data: ObservationData): Promise<Buffer> {
  const workbook = await generateExcelWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
