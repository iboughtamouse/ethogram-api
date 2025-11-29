package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
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

// TestObservationService_GetByID tests the GetByID service method
func TestObservationService_GetByID(t *testing.T) {
	t.Run("successful retrieval", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		observationID := uuid.New()
		expectedObs := &models.Observation{
			ID:              observationID,
			ObserverName:    "TestObserver",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "15:00",
			EndTime:         "16:00",
			Aviary:          "A1",
			Mode:            "focal",
			BabiesPresent:   0,
		}

		// Mock expectation
		mockRepo.On("GetByID", ctx, observationID).Return(expectedObs, nil)

		// Execute
		result, err := service.GetByID(ctx, observationID.String())

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, expectedObs.ID, result.ID)
		assert.Equal(t, expectedObs.ObserverName, result.ObserverName)
		mockRepo.AssertExpectations(t)
	})

	t.Run("invalid UUID format", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		invalidID := "not-a-uuid"

		// Execute
		result, err := service.GetByID(ctx, invalidID)

		// Assert
		assert.Error(t, err)
		assert.Nil(t, result)
		assert.Contains(t, err.Error(), "invalid observation ID")
		// Repository should not be called
		mockRepo.AssertNotCalled(t, "GetByID")
	})

	t.Run("observation not found", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		observationID := uuid.New()
		expectedError := errors.New("observation not found")

		// Mock expectation
		mockRepo.On("GetByID", ctx, observationID).Return(nil, expectedError)

		// Execute
		result, err := service.GetByID(ctx, observationID.String())

		// Assert
		assert.Error(t, err)
		assert.Nil(t, result)
		assert.Contains(t, err.Error(), "failed to get observation")
		mockRepo.AssertExpectations(t)
	})

	t.Run("repository error", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		observationID := uuid.New()
		expectedError := errors.New("database connection failed")

		// Mock expectation
		mockRepo.On("GetByID", ctx, observationID).Return(nil, expectedError)

		// Execute
		result, err := service.GetByID(ctx, observationID.String())

		// Assert
		assert.Error(t, err)
		assert.Nil(t, result)
		mockRepo.AssertExpectations(t)
	})
}

// TestObservationService_List tests the List service method
func TestObservationService_List(t *testing.T) {
	t.Run("successful list with no filters", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		filters := database.ObservationFilters{
			Limit:     50,
			Offset:    0,
			SortBy:    "submitted_at",
			SortOrder: "desc",
		}

		expectedObservations := []*models.Observation{
			{
				ID:              uuid.New(),
				ObserverName:    "Observer1",
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			},
			{
				ID:              uuid.New(),
				ObserverName:    "Observer2",
				ObservationDate: time.Date(2024, 1, 16, 0, 0, 0, 0, time.UTC),
			},
		}

		expectedResult := &database.ObservationListResult{
			Observations: expectedObservations,
			Total:        2,
			Limit:        50,
			Offset:       0,
		}

		// Mock expectation
		mockRepo.On("List", ctx, filters).Return(expectedResult, nil)

		// Execute
		result, err := service.List(ctx, filters)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 2, result.Total)
		assert.Len(t, result.Observations, 2)
		assert.Equal(t, expectedObservations[0].ID, result.Observations[0].ID)
		mockRepo.AssertExpectations(t)
	})

	t.Run("successful list with filters", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		aviary := "A1"
		observerName := "TestUser"
		startDate := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
		endDate := time.Date(2024, 1, 31, 0, 0, 0, 0, time.UTC)

		filters := database.ObservationFilters{
			Aviary:       &aviary,
			ObserverName: &observerName,
			StartDate:    &startDate,
			EndDate:      &endDate,
			Limit:        10,
			Offset:       0,
			SortBy:       "observation_date",
			SortOrder:    "asc",
		}

		expectedResult := &database.ObservationListResult{
			Observations: []*models.Observation{
				{
					ID:              uuid.New(),
					ObserverName:    "TestUser",
					ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
					Aviary:          "A1",
				},
			},
			Total:  1,
			Limit:  10,
			Offset: 0,
		}

		// Mock expectation
		mockRepo.On("List", ctx, filters).Return(expectedResult, nil)

		// Execute
		result, err := service.List(ctx, filters)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 1, result.Total)
		assert.Len(t, result.Observations, 1)
		assert.Equal(t, "TestUser", result.Observations[0].ObserverName)
		assert.Equal(t, "A1", result.Observations[0].Aviary)
		mockRepo.AssertExpectations(t)
	})

	t.Run("empty result set", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		filters := database.ObservationFilters{
			Limit:  50,
			Offset: 0,
		}

		expectedResult := &database.ObservationListResult{
			Observations: []*models.Observation{},
			Total:        0,
			Limit:        50,
			Offset:       0,
		}

		// Mock expectation
		mockRepo.On("List", ctx, filters).Return(expectedResult, nil)

		// Execute
		result, err := service.List(ctx, filters)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 0, result.Total)
		assert.Empty(t, result.Observations)
		mockRepo.AssertExpectations(t)
	})

	t.Run("repository error", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		filters := database.ObservationFilters{
			Limit:  50,
			Offset: 0,
		}

		expectedError := errors.New("database query failed")

		// Mock expectation
		mockRepo.On("List", ctx, filters).Return(nil, expectedError)

		// Execute
		result, err := service.List(ctx, filters)

		// Assert
		assert.Error(t, err)
		assert.Nil(t, result)
		mockRepo.AssertExpectations(t)
	})

	t.Run("pagination - second page", func(t *testing.T) {
		// Setup
		mockRepo := new(database.MockObservationRepository)
		service := NewObservationService(mockRepo, nil, nil)
		ctx := context.Background()

		filters := database.ObservationFilters{
			Limit:  10,
			Offset: 10,
		}

		expectedResult := &database.ObservationListResult{
			Observations: []*models.Observation{
				{ID: uuid.New(), ObserverName: "Observer11"},
			},
			Total:  25,
			Limit:  10,
			Offset: 10,
		}

		// Mock expectation
		mockRepo.On("List", ctx, filters).Return(expectedResult, nil)

		// Execute
		result, err := service.List(ctx, filters)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 25, result.Total)
		assert.Equal(t, 10, result.Offset)
		mockRepo.AssertExpectations(t)
	})
}
