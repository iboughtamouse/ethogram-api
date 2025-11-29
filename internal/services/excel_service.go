package services

import (
	"bytes"
	"fmt"
	"sort"
	"strings"

	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/xuri/excelize/v2"
)

// ExcelService handles Excel file generation
type ExcelService struct{}

// NewExcelService creates a new Excel service
func NewExcelService() *ExcelService {
	return &ExcelService{}
}

// Behavior display labels matching frontend BEHAVIOR_ROW_MAPPING
var behaviorLabels = map[string]string{
	"eating_food_platform":    "Eating - On Food Platform",
	"eating_elsewhere":        "Eating - Elsewhere (Note Location)",
	"walking_ground":          "Locomotion - Walking on Ground",
	"walking_perch":           "Locomotion - Walking on Perch (Note Location)",
	"flying":                  "Locomotion - Flying",
	"jumping":                 "Locomotion - Jumping",
	"repetitive_locomotion":   "Repetitive Locomotion (Same movement 3+ times in a row)",
	"drinking":                "Drinking (Note source if not from the water bowl)",
	"bathing":                 "Bathing",
	"preening":                "Preening/Grooming (Note Location)",
	"repetitive_preening":     "Repetitive Preening/Feather Damage (Plucking, Mutilation, Etc.)",
	"nesting":                 "Nesting",
	"vocalizing":              "Vocalizing",
	"resting_alert":           "Resting on Perch/Ground - Alert (Note Location)",
	"resting_not_alert":       "Resting on Perch/Ground - Not Alert (Note Location)",
	"resting_unknown":         "Resting on Perch/Ground - Status Unknown (Note Location)",
	"interacting_object":      "Interacting with Inanimate Object (Note Object)",
	"interacting_animal":      "Interacting with Other Animal (Note Animal & Type of Interaction)",
	"aggression":              "Aggression or Defensive Posturing",
	"not_visible":             "Not Visible",
	"other":                   "Other",
}

// Behavior order matching frontend
var behaviorOrder = []string{
	"eating_food_platform",
	"eating_elsewhere",
	"walking_ground",
	"walking_perch",
	"flying",
	"jumping",
	"repetitive_locomotion",
	"drinking",
	"bathing",
	"preening",
	"repetitive_preening",
	"nesting",
	"vocalizing",
	"resting_alert",
	"resting_not_alert",
	"resting_unknown",
	"interacting_object",
	"interacting_animal",
	"aggression",
	"not_visible",
	"other",
}

// GenerateObservationExcel creates an Excel file matching the frontend format
// Returns the file as bytes
func (s *ExcelService) GenerateObservationExcel(obs *models.Observation) (*bytes.Buffer, error) {
	f := excelize.NewFile()
	defer f.Close()

	sheetName := "Ethogram Data"
	index, err := f.NewSheet(sheetName)
	if err != nil {
		return nil, fmt.Errorf("failed to create sheet: %w", err)
	}
	f.SetActiveSheet(index)
	f.DeleteSheet("Sheet1") // Remove default sheet

	// Get sorted time slots
	timeSlots := make([]string, 0, len(obs.TimeSlots))
	for timeKey := range obs.TimeSlots {
		timeSlots = append(timeSlots, timeKey)
	}
	sort.Strings(timeSlots)

	// Row 1: Title, Date, Time Window
	f.SetCellValue(sheetName, "A1", "Rehabilitation Raptor Ethogram")
	f.SetCellValue(sheetName, "B1", "Date:")
	f.SetCellValue(sheetName, "C1", obs.ObservationDate.Format("2006-01-02"))
	f.SetCellValue(sheetName, "J1", "Time Window:")
	f.SetCellValue(sheetName, "K1", fmt.Sprintf("%s - %s", obs.StartTime, obs.EndTime))

	// Row 2: Aviary, Patient, Observer
	patient := "Sayyida" // Phase 2 hardcoded
	f.SetCellValue(sheetName, "A2", fmt.Sprintf("Aviary: %s", obs.Aviary))
	f.SetCellValue(sheetName, "B2", fmt.Sprintf("Patient(s): %s", patient))
	f.SetCellValue(sheetName, "J2", "Observer:")
	f.SetCellValue(sheetName, "K2", obs.ObserverName)

	// Row 3: "Time:" label
	f.SetCellValue(sheetName, "B3", "Time:")

	// Row 4: Time slot headers (relative format)
	for i, timeKey := range timeSlots {
		relativeTime := convertToRelativeTime(timeKey, obs.StartTime)
		col := indexToColumn(i + 2) // Column B is index 2
		f.SetCellValue(sheetName, fmt.Sprintf("%s4", col), relativeTime)
	}

	// Rows 5+: Behavior rows
	for i, behaviorValue := range behaviorOrder {
		rowIndex := 5 + i
		behaviorLabel := behaviorLabels[behaviorValue]

		// Column A: Behavior label
		f.SetCellValue(sheetName, fmt.Sprintf("A%d", rowIndex), behaviorLabel)

		// Check each time slot for this behavior
		for j, timeKey := range timeSlots {
			subjects := obs.TimeSlots[timeKey]
			if len(subjects) > 0 && subjects[0].Behavior == behaviorValue {
				col := indexToColumn(j + 2)
				cellContent := formatCellContent(subjects[0])
				cellAddr := fmt.Sprintf("%s%d", col, rowIndex)
				f.SetCellValue(sheetName, cellAddr, cellContent)

				// Enable text wrapping
				style, _ := f.NewStyle(&excelize.Style{
					Alignment: &excelize.Alignment{
						WrapText: true,
						Vertical: "top",
					},
				})
				f.SetCellStyle(sheetName, cellAddr, cellAddr, style)
			}
		}
	}

	// Add comments section
	commentsRow := 5 + len(behaviorOrder) + 2
	commentsText := "Comments (Abnormal Environmental Factors, Plant Growth, Etc):"
	if obs.EnvironmentalNotes != nil && *obs.EnvironmentalNotes != "" {
		commentsText = fmt.Sprintf("%s\n%s", commentsText, *obs.EnvironmentalNotes)
	}
	f.SetCellValue(sheetName, fmt.Sprintf("A%d", commentsRow), commentsText)

	// Set column widths
	f.SetColWidth(sheetName, "A", "A", 50)
	for i := 2; i <= len(timeSlots)+1; i++ {
		col := indexToColumn(i)
		f.SetColWidth(sheetName, col, col, 12)
	}

	// Write to buffer
	buf := new(bytes.Buffer)
	if err := f.Write(buf); err != nil {
		return nil, fmt.Errorf("failed to write Excel file: %w", err)
	}

	return buf, nil
}

// indexToColumn converts a column index (1-based) to Excel column letter(s)
// Examples: 1 -> A, 2 -> B, 26 -> Z, 27 -> AA
func indexToColumn(index int) string {
	result := ""
	for index > 0 {
		index-- // Make it 0-based
		result = string(rune('A'+index%26)) + result
		index /= 26
	}
	return result
}

// convertToRelativeTime converts absolute time (HH:MM) to relative format based on start time
// Matches frontend logic: handles midnight crossing
func convertToRelativeTime(timeStr, startTimeStr string) string {
	// Parse times
	timeParts := strings.Split(timeStr, ":")
	startParts := strings.Split(startTimeStr, ":")

	timeHours := parseInt(timeParts[0])
	timeMinutes := parseInt(timeParts[1])
	startHours := parseInt(startParts[0])
	startMinutes := parseInt(startParts[1])

	totalTimeMinutes := timeHours*60 + timeMinutes
	totalStartMinutes := startHours*60 + startMinutes

	// Handle midnight crossing: if time is less than start time, add 24 hours
	if totalTimeMinutes < totalStartMinutes {
		totalTimeMinutes += 24 * 60
	}

	diffMinutes := totalTimeMinutes - totalStartMinutes
	hours := diffMinutes / 60
	minutes := diffMinutes % 60

	// Format as H:MM (e.g., "0:00", "0:05", "1:30")
	return fmt.Sprintf("%d:%02d", hours, minutes)
}

// formatCellContent formats observation details for a cell
// Matches frontend logic with newline-separated details
func formatCellContent(subject models.SubjectObservation) string {
	parts := []string{"x"}

	if subject.Location != "" {
		parts = append(parts, fmt.Sprintf("Loc: %s", subject.Location))
	}

	if subject.Object != "" {
		objectValue := subject.Object
		if subject.Object == "other" && subject.ObjectOther != "" {
			objectValue = subject.ObjectOther
		}
		parts = append(parts, fmt.Sprintf("Object: %s", objectValue))
	}

	if subject.Animal != "" {
		animalValue := subject.Animal
		if subject.Animal == "other" && subject.AnimalOther != "" {
			animalValue = subject.AnimalOther
		}
		parts = append(parts, fmt.Sprintf("Animal: %s", animalValue))
	}

	if subject.InteractionType != "" {
		interactionValue := subject.InteractionType
		if subject.InteractionType == "other" && subject.InteractionTypeOther != "" {
			interactionValue = subject.InteractionTypeOther
		}
		parts = append(parts, fmt.Sprintf("Interaction: %s", interactionValue))
	}

	if subject.Description != "" {
		parts = append(parts, fmt.Sprintf("Description: %s", subject.Description))
	}

	if subject.Notes != "" {
		parts = append(parts, fmt.Sprintf("Notes: %s", subject.Notes))
	}

	if len(parts) > 1 {
		return strings.Join(parts, "\n")
	}
	return "x"
}

// parseInt is a helper to parse integer from string
func parseInt(s string) int {
	var n int
	fmt.Sscanf(s, "%d", &n)
	return n
}

// GenerateFilename creates a filename for the Excel file
// Format: WBS-Ethogram-[Observer]-[Date]-[ID].xlsx
func (s *ExcelService) GenerateFilename(obs *models.Observation) string {
	// Clean observer name (remove spaces and special chars)
	cleanName := strings.ReplaceAll(obs.ObserverName, " ", "-")
	cleanName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return -1
	}, cleanName)

	// Get short ID (first 8 chars)
	shortID := obs.ID.String()[:8]

	// Format: WBS-Ethogram-Alice-2025-11-24-550e8400.xlsx
	return fmt.Sprintf("WBS-Ethogram-%s-%s-%s.xlsx",
		cleanName,
		obs.ObservationDate.Format("2006-01-02"),
		shortID,
	)
}
