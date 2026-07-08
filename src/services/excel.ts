/**
 * Excel Generation Service
 *
 * Converts observation data to Excel format matching the frontend's ethogram spreadsheet layout.
 * Uses a matrix format where behaviors are rows and time slots are columns.
 *
 * This service expects the DATABASE observation format:
 * { "14:00": [{ subjectType, subjectId, behavior, location, ... }] }
 *
 * Multi-subject rows render as one worksheet per subject (P2-D3), each the
 * same behavior×time matrix — WBS analysis is per-bird.
 */

import ExcelJS from 'exceljs';

/**
 * The slice of the published config document Excel generation needs.
 * The full document shape is composed by compose_config() (migration 002)
 * and served by GET /api/config.
 */
export interface ExcelConfig {
  behaviors: Array<{
    value: string;
    excelRowLabel: string;
    excelRowOrder: number;
  }>;
  aviaries: Array<{
    name: string;
    vocabulary: { behaviors: string[] };
  }>;
}

/**
 * Derives the workbook's behavior rows from the config document: the catalog
 * ordered by excelRowOrder, filtered to the aviary's enabled behaviors plus
 * any behavior actually present in the observation's data (Phase 2 §4 row
 * alignment — a draft-held retired value keeps its row without rendering
 * every retired row empty). An aviary the config doesn't know (e.g. dev
 * fixtures) gets the full catalog — a safe superset. Values present in the
 * data but absent from the catalog have no label/order and get no row.
 */
export function behaviorRowsFor(
  config: ExcelConfig,
  aviaryName: string,
  observations: Record<string, SubjectObservation[]>
): Array<{ value: string; label: string }> {
  const aviary = config.aviaries.find((a) => a.name === aviaryName);
  const enabled = aviary ? new Set(aviary.vocabulary.behaviors) : null;
  const present = new Set(Object.values(observations).flat().map((o) => o.behavior));

  return config.behaviors
    .filter((b) => enabled === null || enabled.has(b.value) || present.has(b.value))
    .sort((a, b) => a.excelRowOrder - b.excelRowOrder)
    .map((b) => ({ value: b.value, label: b.excelRowLabel }));
}

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
  objectInteractionType?: string;
  objectInteractionTypeOther?: string;
  animal?: string;
  animalOther?: string;
  animalInteractionType?: string;
  animalInteractionTypeOther?: string;
  description?: string;
}

interface Metadata {
  observerName: string;
  date: string;
  startTime: string;
  endTime: string;
  aviary: string;
  patient: string;
}

/**
 * Observation data as stored in the database.
 * observations is keyed by time slot, each containing an array of subject observations.
 */
interface ObservationData {
  metadata: Metadata;
  observations: Record<string, SubjectObservation[]>;
  submittedAt: string;
  /** The config document the observation was submitted under (version-stamped). */
  config: ExcelConfig;
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

  // Handle object interaction type (new field)
  const objectInteractionValue = resolveOtherField(
    observation.objectInteractionType,
    observation.objectInteractionTypeOther
  );
  if (objectInteractionValue) {
    parts.push(`Object Interaction: ${objectInteractionValue}`);
  }

  // Animal interaction type
  const animalInteractionValue = resolveOtherField(
    observation.animalInteractionType,
    observation.animalInteractionTypeOther
  );
  if (animalInteractionValue) {
    parts.push(`Animal Interaction: ${animalInteractionValue}`);
  }

  if (observation.description) {
    parts.push(`Description: ${observation.description}`);
  }

  if (observation.notes) {
    parts.push(`Notes: ${observation.notes}`);
  }

  return parts.length > 1 ? parts.join('\n') : 'x';
}

/** Strip leading/trailing apostrophes and whitespace (Excel rejects both). */
const stripSheetNameBoundary = (name: string): string =>
  name.replace(/^['\s]+|['\s]+$/g, '');

/**
 * Excel worksheet names must satisfy Excel's rules: no `* ? : \ / [ ]`, no
 * leading/trailing apostrophe, 1–31 chars, not the reserved name "History",
 * unique per workbook (case-insensitive). Truncated to 28 chars to leave
 * room for a dedupe suffix; the untruncated subject name lives in the
 * sheet's Subject(s) header row. Boundary stripping runs AFTER truncation —
 * the slice can re-expose a boundary apostrophe.
 */
export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(/[*?:\\/[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = stripSheetNameBoundary(cleaned.slice(0, 28));
  if (base === '') return 'Subject';
  // ExcelJS throws on the exact (case-sensitive) reserved name
  if (base === 'History') return 'History (Subject)';
  return base;
}

function uniqueSheetName(subjectName: string, used: Set<string>): string {
  const base = sanitizeSheetName(subjectName);
  let candidate = base;
  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++) {
    const tag = ` ${suffix}`;
    candidate = `${stripSheetNameBoundary(base.slice(0, 31 - tag.length))}${tag}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Unique subjectIds across a row's time slots, in chronological slot order
 * (keys are fixed-width HH:MM, so a lexicographic sort is chronological).
 * Sorting makes the order deterministic on every path — client JSON key
 * order and Postgres jsonb key order would otherwise disagree. Entries
 * missing a subjectId (malformed hand-written rows) group under 'Unknown'
 * instead of crashing the export.
 */
export function subjectIdsInSlotOrder(
  observations: Record<string, SubjectObservation[]>
): string[] {
  return [
    ...new Set(
      Object.keys(observations)
        .sort()
        .flatMap((time) =>
          (observations[time] ?? []).map((o) => o.subjectId ?? 'Unknown')
        )
    ),
  ];
}

/**
 * Generates an Excel workbook from observation data: one worksheet per
 * subject (P2-D3), each the same behavior×time matrix. Subjects appear in
 * slot order; a row with no time slots still gets one sheet, labeled from
 * the metadata patient/subject label.
 */
export async function generateExcelWorkbook(
  data: ObservationData
): Promise<ExcelJS.Workbook> {
  const { metadata, observations, config } = data;
  const workbook = new ExcelJS.Workbook();

  const timeSlots = generateTimeSlots(metadata.startTime, metadata.endTime);
  // One row set shared by every sheet — identical matrix per bird
  const behaviorRows = behaviorRowsFor(config, metadata.aviary, observations);

  const subjects = subjectIdsInSlotOrder(observations);
  if (subjects.length === 0) {
    subjects.push(metadata.patient);
  }

  const usedSheetNames = new Set<string>();
  for (const subject of subjects) {
    const subjectObservations: Record<string, SubjectObservation[]> = {};
    for (const [time, slot] of Object.entries(observations)) {
      const matching = slot.filter(
        (obs) => (obs.subjectId ?? 'Unknown') === subject
      );
      if (matching.length > 0) {
        subjectObservations[time] = matching;
      }
    }

    addSubjectWorksheet(workbook, {
      sheetName: uniqueSheetName(subject, usedSheetNames),
      subject,
      metadata,
      observations: subjectObservations,
      timeSlots,
      behaviorRows,
    });
  }

  return workbook;
}

/**
 * Adds one subject's worksheet: the ethogram matrix layout (headers, behavior
 * rows × time-slot columns, comments row, frozen panes).
 */
function addSubjectWorksheet(
  workbook: ExcelJS.Workbook,
  params: {
    sheetName: string;
    subject: string;
    metadata: Metadata;
    observations: Record<string, SubjectObservation[]>;
    timeSlots: string[];
    behaviorRows: Array<{ value: string; label: string }>;
  }
): void {
  const { sheetName, subject, metadata, observations, timeSlots, behaviorRows } = params;
  const worksheet = workbook.addWorksheet(sheetName);

  // Set column widths for readability
  worksheet.getColumn('A').width = 35.0;  // Behavior labels column - increased ~35% from 25.75 to reduce wrapping
  worksheet.getColumn('B').width = 8.0;   // Time column headers - increased from 4.88 for readability
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

  // Row 2: Aviary, Subject, Observer. The subject cell carries the full
  // untruncated name (the sheet name may be sanitized/truncated).
  const aviaryCell = worksheet.getCell('A2');
  aviaryCell.value = `Aviary: ${metadata.aviary}`;
  aviaryCell.font = { bold: true };

  const subjectCell = worksheet.getCell('B2');
  subjectCell.value = `Subject(s): ${subject}`;
  subjectCell.font = { bold: true };
  
  const observerLabel = worksheet.getCell('J2');
  observerLabel.value = 'Observer:';
  observerLabel.font = { bold: true };
  
  worksheet.getCell('K2').value = metadata.observerName;

  // Row 3: "Time:" label (bold)
  const timeLabelCell = worksheet.getCell('B3');
  timeLabelCell.value = 'Time:';
  timeLabelCell.font = { bold: true };

  // Row 4: Time slot headers (actual timestamps) - make bold
  timeSlots.forEach((time, index) => {
    const columnIndex = index + 2; // Column B is index 2
    const headerCell = worksheet.getCell(4, columnIndex);
    headerCell.value = time;
    headerCell.font = { bold: true };
  });

  // Rows 5+: Behavior labels and observation marks
  behaviorRows.forEach(({ value: behaviorValue, label: behaviorLabel }, index) => {
    const rowIndex = 5 + index;

    // Column A: Behavior label with text wrapping
    const labelCell = worksheet.getCell(rowIndex, 1);
    labelCell.value = behaviorLabel;
    labelCell.alignment = { wrapText: true, vertical: 'top' };

    // Check each time slot for this behavior
    timeSlots.forEach((time, timeIndex) => {
      const slotObservations = observations[time];
      if (!slotObservations) return;

      // Observations here are already this subject's only; the protocol
      // records one behavior per subject per slot, so more than one match
      // is protocol-violating data — render all of them rather than
      // silently dropping any
      const matchingObs = slotObservations.filter(
        (obs) => obs.behavior === behaviorValue
      );

      if (matchingObs.length > 0) {
        const columnIndex = timeIndex + 2;
        const cellContent = matchingObs.map(formatCellContent).join('\n—\n');
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
}

/**
 * Generates an Excel file as a Buffer
 */
export async function generateExcelBuffer(data: ObservationData): Promise<Buffer> {
  const workbook = await generateExcelWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
