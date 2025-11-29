package services

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

func TestGenerateObservationExcel(t *testing.T) {
	service := NewExcelService()

	// Create test observation
	envNotes := "Test environmental notes"
	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		EnvironmentalNotes: &envNotes,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
					Location:    "12",
					Notes:       "Test note",
				},
			},
			"15:05": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "preening",
					Location:    "12",
					Notes:       "",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	// Generate Excel file
	buf, err := service.GenerateObservationExcel(obs)
	require.NoError(t, err)
	require.NotNil(t, buf)

	// Read the generated Excel file
	f, err := excelize.OpenReader(buf)
	require.NoError(t, err)
	defer f.Close()

	sheetName := "Ethogram Data"

	// Verify sheet exists
	sheets := f.GetSheetList()
	assert.Contains(t, sheets, sheetName)

	// Verify header content
	title, err := f.GetCellValue(sheetName, "A1")
	assert.NoError(t, err)
	assert.Equal(t, "Rehabilitation Raptor Ethogram", title)

	dateLabel, err := f.GetCellValue(sheetName, "B1")
	assert.NoError(t, err)
	assert.Equal(t, "Date:", dateLabel)

	dateValue, err := f.GetCellValue(sheetName, "C1")
	assert.NoError(t, err)
	assert.Equal(t, "2025-11-29", dateValue)

	// Verify observer name
	observerValue, err := f.GetCellValue(sheetName, "K2")
	assert.NoError(t, err)
	assert.Equal(t, "TestObserver", observerValue)

	// Verify time slot headers (relative format)
	timeSlot1, err := f.GetCellValue(sheetName, "B4")
	assert.NoError(t, err)
	assert.Equal(t, "0:00", timeSlot1)

	timeSlot2, err := f.GetCellValue(sheetName, "C4")
	assert.NoError(t, err)
	assert.Equal(t, "0:05", timeSlot2)

	// Verify behavior labels exist in column A
	behaviorRow5, err := f.GetCellValue(sheetName, "A5")
	assert.NoError(t, err)
	assert.Equal(t, "Eating - On Food Platform", behaviorRow5)

	// Find the resting_alert row (row 18)
	restingAlertRow, err := f.GetCellValue(sheetName, "A18")
	assert.NoError(t, err)
	assert.Equal(t, "Resting on Perch/Ground - Alert (Note Location)", restingAlertRow)

	// Verify data in resting_alert row for first time slot
	restingAlertData, err := f.GetCellValue(sheetName, "B18")
	assert.NoError(t, err)
	assert.Contains(t, restingAlertData, "x")
	assert.Contains(t, restingAlertData, "Loc: 12")
	assert.Contains(t, restingAlertData, "Notes: Test note")

	// Find the preening row (row 14)
	preeningRow, err := f.GetCellValue(sheetName, "A14")
	assert.NoError(t, err)
	assert.Equal(t, "Preening/Grooming (Note Location)", preeningRow)

	// Verify data in preening row for second time slot
	preeningData, err := f.GetCellValue(sheetName, "C14")
	assert.NoError(t, err)
	assert.Contains(t, preeningData, "x")
	assert.Contains(t, preeningData, "Loc: 12")
}

func TestGenerateObservationExcel_WithInteractionFields(t *testing.T) {
	service := NewExcelService()

	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "10:00",
		EndTime:         "10:05",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"10:00": []models.SubjectObservation{
				{
					SubjectType:     "foster_parent",
					SubjectID:       "Sayyida",
					Behavior:        "interacting_object",
					Location:        "GROUND",
					Notes:           "Playing with enrichment",
					Object:          "newspaper",
					InteractionType: "foraging",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	buf, err := service.GenerateObservationExcel(obs)
	require.NoError(t, err)
	require.NotNil(t, buf)

	// Read and verify
	f, err := excelize.OpenReader(buf)
	require.NoError(t, err)
	defer f.Close()

	sheetName := "Ethogram Data"

	// Find interacting_object row (row 21)
	interactingRow, err := f.GetCellValue(sheetName, "A21")
	assert.NoError(t, err)
	assert.Equal(t, "Interacting with Inanimate Object (Note Object)", interactingRow)

	// Verify data includes object and interaction type
	interactingData, err := f.GetCellValue(sheetName, "B21")
	assert.NoError(t, err)
	assert.Contains(t, interactingData, "x")
	assert.Contains(t, interactingData, "Loc: GROUND")
	assert.Contains(t, interactingData, "Object: newspaper")
	assert.Contains(t, interactingData, "Interaction: foraging")
	assert.Contains(t, interactingData, "Notes: Playing with enrichment")
}

func TestGenerateFilename(t *testing.T) {
	service := NewExcelService()

	tests := []struct {
		name             string
		observerName     string
		observationDate  time.Time
		expectedPattern  string
	}{
		{
			name:            "simple name",
			observerName:    "Alice",
			observationDate: time.Date(2025, 11, 24, 0, 0, 0, 0, time.UTC),
			expectedPattern: "WBS-Ethogram-Alice-2025-11-24-",
		},
		{
			name:            "name with spaces",
			observerName:    "Alice Smith",
			observationDate: time.Date(2025, 11, 24, 0, 0, 0, 0, time.UTC),
			expectedPattern: "WBS-Ethogram-Alice-Smith-2025-11-24-",
		},
		{
			name:            "name with special chars",
			observerName:    "Alice_123",
			observationDate: time.Date(2025, 11, 24, 0, 0, 0, 0, time.UTC),
			expectedPattern: "WBS-Ethogram-Alice123-2025-11-24-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			obs := &models.Observation{
				ID:              uuid.New(),
				ObserverName:    tt.observerName,
				ObservationDate: tt.observationDate,
			}

			filename := service.GenerateFilename(obs)

			assert.Contains(t, filename, tt.expectedPattern)
			assert.Contains(t, filename, ".xlsx")
			// Should contain 8-char UUID prefix
			assert.Len(t, filename, len(tt.expectedPattern)+8+5) // +5 for ".xlsx"
		})
	}
}

func TestConvertToRelativeTime(t *testing.T) {
	tests := []struct {
		name      string
		timeStr   string
		startTime string
		expected  string
	}{
		{
			name:      "same time as start",
			timeStr:   "15:00",
			startTime: "15:00",
			expected:  "0:00",
		},
		{
			name:      "5 minutes after start",
			timeStr:   "15:05",
			startTime: "15:00",
			expected:  "0:05",
		},
		{
			name:      "1 hour after start",
			timeStr:   "16:00",
			startTime: "15:00",
			expected:  "1:00",
		},
		{
			name:      "1 hour 30 minutes after start",
			timeStr:   "16:30",
			startTime: "15:00",
			expected:  "1:30",
		},
		{
			name:      "midnight crossing",
			timeStr:   "00:05",
			startTime: "23:55",
			expected:  "0:10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := convertToRelativeTime(tt.timeStr, tt.startTime)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestFormatCellContent(t *testing.T) {
	tests := []struct {
		name     string
		subject  models.SubjectObservation
		expected []string // Strings that should be in the result
	}{
		{
			name: "basic observation with location and notes",
			subject: models.SubjectObservation{
				Behavior: "resting_alert",
				Location: "12",
				Notes:    "Test note",
			},
			expected: []string{"x", "Loc: 12", "Notes: Test note"},
		},
		{
			name: "with object",
			subject: models.SubjectObservation{
				Behavior: "interacting_object",
				Location: "GROUND",
				Object:   "newspaper",
			},
			expected: []string{"x", "Loc: GROUND", "Object: newspaper"},
		},
		{
			name: "with other object",
			subject: models.SubjectObservation{
				Behavior:    "interacting_object",
				Object:      "other",
				ObjectOther: "custom toy",
			},
			expected: []string{"x", "Object: custom toy"},
		},
		{
			name: "with animal interaction",
			subject: models.SubjectObservation{
				Behavior:        "interacting_animal",
				Animal:          "crow",
				InteractionType: "aggressive",
			},
			expected: []string{"x", "Animal: crow", "Interaction: aggressive"},
		},
		{
			name: "with description",
			subject: models.SubjectObservation{
				Behavior:    "other",
				Description: "Custom behavior description",
			},
			expected: []string{"x", "Description: Custom behavior description"},
		},
		{
			name: "just x when no details",
			subject: models.SubjectObservation{
				Behavior: "flying",
			},
			expected: []string{"x"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatCellContent(tt.subject)

			for _, expectedPart := range tt.expected {
				assert.Contains(t, result, expectedPart)
			}
		})
	}
}

func TestIndexToColumn(t *testing.T) {
	tests := []struct {
		index    int
		expected string
	}{
		{1, "A"},
		{2, "B"},
		{26, "Z"},
		{27, "AA"},
		{28, "AB"},
		{52, "AZ"},
		{53, "BA"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := indexToColumn(tt.index)
			assert.Equal(t, tt.expected, result)
		})
	}
}
