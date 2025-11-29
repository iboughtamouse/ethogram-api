package services

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewEmailService(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	require.NotNil(t, service)
	assert.Equal(t, "test-api-key", service.apiKey)
	assert.Equal(t, "test@example.com", service.fromEmail)
	assert.NotNil(t, service.client)
	assert.Equal(t, 30*time.Second, service.client.Timeout)
}

func TestBase64Encode(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected string
	}{
		{
			name:     "empty bytes",
			input:    []byte{},
			expected: "",
		},
		{
			name:     "simple text",
			input:    []byte("hello"),
			expected: "aGVsbG8=",
		},
		{
			name:     "binary data",
			input:    []byte{0x00, 0x01, 0x02, 0x03},
			expected: "AAECAw==",
		},
		{
			name:     "longer text",
			input:    []byte("Hello, World!"),
			expected: "SGVsbG8sIFdvcmxkIQ==",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := base64Encode(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestGenerateEmailHTML_BasicStructure(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	html := service.generateEmailHTML(obs)

	// Verify valid HTML structure
	assert.Contains(t, html, "<!DOCTYPE html>")
	assert.Contains(t, html, "<html>")
	assert.Contains(t, html, "</html>")
	assert.Contains(t, html, "<head>")
	assert.Contains(t, html, "</head>")
	assert.Contains(t, html, "<body>")
	assert.Contains(t, html, "</body>")
}

func TestGenerateEmailHTML_ContentVerification(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	submittedAt := time.Date(2025, 11, 29, 15, 30, 45, 0, time.UTC)
	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "Alice Smith",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "14:00",
		EndTime:         "15:00",
		Aviary:          "Main Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"14:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"alice@example.com"},
		SubmittedAt: submittedAt,
	}

	html := service.generateEmailHTML(obs)

	// Verify observer name
	assert.Contains(t, html, "Hi Alice Smith,")

	// Verify patient name (hardcoded in Phase 2)
	assert.Contains(t, html, "Sayyida")

	// Verify aviary
	assert.Contains(t, html, "Main Aviary")

	// Verify observation date
	assert.Contains(t, html, "2025-11-29")

	// Verify time window
	assert.Contains(t, html, "14:00")
	assert.Contains(t, html, "15:00")

	// Verify submitted timestamp (formatted)
	assert.Contains(t, html, "2025-11-29 15:30:45")
}

func TestGenerateEmailHTML_ModeDisplay(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	tests := []struct {
		name            string
		mode            string
		expectedDisplay string
	}{
		{
			name:            "live mode",
			mode:            "live",
			expectedDisplay: "Live",
		},
		{
			name:            "vod mode",
			mode:            "vod",
			expectedDisplay: "VOD",
		},
		{
			name:            "video mode (not vod)",
			mode:            "video",
			expectedDisplay: "Live", // Default fallback
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			obs := &models.Observation{
				ID:              uuid.New(),
				ObserverName:    "TestObserver",
				ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "15:10",
				Aviary:          "Test Aviary",
				Mode:            tt.mode,
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{
							SubjectType: "foster_parent",
							SubjectID:   "Sayyida",
							Behavior:    "resting_alert",
						},
					},
				},
				Emails:      []string{"test@example.com"},
				SubmittedAt: time.Now(),
			}

			html := service.generateEmailHTML(obs)

			// Check for mode display in the detail row
			assert.Contains(t, html, fmt.Sprintf("Mode:</span> %s", tt.expectedDisplay))
		})
	}
}

func TestGenerateEmailHTML_Styling(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	html := service.generateEmailHTML(obs)

	// Verify CSS is embedded
	assert.Contains(t, html, "<style>")
	assert.Contains(t, html, "</style>")

	// Verify key CSS classes are used
	assert.Contains(t, html, "class=\"container\"")
	assert.Contains(t, html, "class=\"header\"")
	assert.Contains(t, html, "class=\"content\"")
	assert.Contains(t, html, "class=\"detail-row\"")
	assert.Contains(t, html, "class=\"detail-label\"")
	assert.Contains(t, html, "class=\"footer\"")
}

func TestGenerateEmailHTML_Footer(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	html := service.generateEmailHTML(obs)

	// Verify footer content
	assert.Contains(t, html, "If you have any questions")
	assert.Contains(t, html, "Thank you for contributing to our research")
	assert.Contains(t, html, "World Bird Sanctuary Ethogram Team")
}

func TestGenerateEmailHTML_SpecialCharacters(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	// Test with special characters that might need HTML escaping
	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "Test & Observer",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Aviary <Main>",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	html := service.generateEmailHTML(obs)

	// Note: fmt.Sprintf doesn't HTML-escape, so these will appear as-is
	// This test documents current behavior - in production, should use html/template
	assert.Contains(t, html, "Test & Observer")
	assert.Contains(t, html, "Aviary <Main>")
}

func TestGenerateEmailHTML_TimestampFormatting(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	// Test different timestamps to verify format consistency
	tests := []struct {
		name             string
		submittedAt      time.Time
		expectedInOutput string
	}{
		{
			name:             "UTC timezone",
			submittedAt:      time.Date(2025, 11, 29, 10, 30, 45, 0, time.UTC),
			expectedInOutput: "2025-11-29 10:30:45",
		},
		{
			name:             "midnight",
			submittedAt:      time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
			expectedInOutput: "2025-11-29 00:00:00",
		},
		{
			name:             "end of day",
			submittedAt:      time.Date(2025, 11, 29, 23, 59, 59, 0, time.UTC),
			expectedInOutput: "2025-11-29 23:59:59",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			obs := &models.Observation{
				ID:              uuid.New(),
				ObserverName:    "TestObserver",
				ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "15:10",
				Aviary:          "Test Aviary",
				Mode:            "live",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{
							SubjectType: "foster_parent",
							SubjectID:   "Sayyida",
							Behavior:    "resting_alert",
						},
					},
				},
				Emails:      []string{"test@example.com"},
				SubmittedAt: tt.submittedAt,
			}

			html := service.generateEmailHTML(obs)
			assert.Contains(t, html, tt.expectedInOutput)
		})
	}
}

func TestGenerateEmailHTML_PatientNameHardcoded(t *testing.T) {
	service := NewEmailService("test-api-key", "test@example.com")

	obs := &models.Observation{
		ID:              uuid.New(),
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida", // This is in the data
					Behavior:    "resting_alert",
				},
			},
		},
		Emails:      []string{"test@example.com"},
		SubmittedAt: time.Now(),
	}

	html := service.generateEmailHTML(obs)

	// Verify hardcoded patient name appears (Phase 2)
	assert.Contains(t, html, "Sayyida")

	// Verify it's in the right context (thank you message)
	lines := strings.Split(html, "\n")
	foundPatientContext := false
	for _, line := range lines {
		if strings.Contains(line, "behavioral observation of") && strings.Contains(line, "Sayyida") {
			foundPatientContext = true
			break
		}
	}
	assert.True(t, foundPatientContext, "Patient name should appear in observation context")
}
