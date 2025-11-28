package services

import (
	"testing"

	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestTransformFlatToArray(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]models.FlatObservation
		expected models.TimeSlots
	}{
		{
			name: "single time slot with basic observation",
			input: map[string]models.FlatObservation{
				"15:00": {
					Behavior: "resting_alert",
					Location: "12",
					Notes:    "Test observation",
				},
			},
			expected: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{
						SubjectType: "foster_parent",
						SubjectID:   "Sayyida",
						Behavior:    "resting_alert",
						Location:    "12",
						Notes:       "Test observation",
					},
				},
			},
		},
		{
			name: "multiple time slots",
			input: map[string]models.FlatObservation{
				"15:00": {
					Behavior: "resting_alert",
					Location: "12",
					Notes:    "Alert",
				},
				"15:05": {
					Behavior: "preening",
					Location: "12",
					Notes:    "",
				},
				"15:10": {
					Behavior: "flying",
					Location: "BB1",
					Notes:    "Flight to bird bath",
				},
			},
			expected: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{
						SubjectType: "foster_parent",
						SubjectID:   "Sayyida",
						Behavior:    "resting_alert",
						Location:    "12",
						Notes:       "Alert",
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
				"15:10": []models.SubjectObservation{
					{
						SubjectType: "foster_parent",
						SubjectID:   "Sayyida",
						Behavior:    "flying",
						Location:    "BB1",
						Notes:       "Flight to bird bath",
					},
				},
			},
		},
		{
			name: "observation with interaction fields",
			input: map[string]models.FlatObservation{
				"15:00": {
					Behavior:        "interacting_object",
					Location:        "GROUND",
					Notes:           "Playing with enrichment",
					Object:          "newspaper",
					InteractionType: "foraging",
				},
			},
			expected: models.TimeSlots{
				"15:00": []models.SubjectObservation{
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
		},
		{
			name: "observation with 'other' fields",
			input: map[string]models.FlatObservation{
				"15:00": {
					Behavior:             "interacting_animal",
					Location:             "BB1",
					Notes:                "Interaction",
					Animal:               "other",
					AnimalOther:          "squirrel",
					InteractionType:      "other",
					InteractionTypeOther: "curious_watching",
				},
			},
			expected: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{
						SubjectType:          "foster_parent",
						SubjectID:            "Sayyida",
						Behavior:             "interacting_animal",
						Location:             "BB1",
						Notes:                "Interaction",
						Animal:               "other",
						AnimalOther:          "squirrel",
						InteractionType:      "other",
						InteractionTypeOther: "curious_watching",
					},
				},
			},
		},
		{
			name:     "empty input",
			input:    map[string]models.FlatObservation{},
			expected: models.TimeSlots{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := transformFlatToArray(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestTransformFlatToArray_StructureValidation(t *testing.T) {
	input := map[string]models.FlatObservation{
		"15:00": {
			Behavior: "resting_alert",
			Location: "12",
			Notes:    "Test",
		},
	}

	result := transformFlatToArray(input)

	// Verify it's always an array
	assert.IsType(t, []models.SubjectObservation{}, result["15:00"])

	// Verify array has exactly one element (Phase 2)
	assert.Len(t, result["15:00"], 1)

	// Verify Phase 2 hardcoded values
	assert.Equal(t, "foster_parent", result["15:00"][0].SubjectType)
	assert.Equal(t, "Sayyida", result["15:00"][0].SubjectID)
}
