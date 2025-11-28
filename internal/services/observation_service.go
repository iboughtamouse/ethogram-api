package services

import (
	"context"
	"fmt"
	"time"

	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/models"
)

// ObservationService handles observation business logic
type ObservationService struct {
	repo *database.ObservationRepository
}

// NewObservationService creates a new observation service
func NewObservationService(repo *database.ObservationRepository) *ObservationService {
	return &ObservationService{repo: repo}
}

// Create processes and saves a new observation
func (s *ObservationService) Create(ctx context.Context, req *models.CreateObservationRequest) (*models.Observation, error) {
	// Parse observation date
	obsDate, err := time.Parse("2006-01-02", req.ObservationDate)
	if err != nil {
		return nil, fmt.Errorf("invalid observation date format: %w", err)
	}

	// Phase 2 Transformation: Convert flat structure to array structure
	// Frontend sends: { "15:00": { behavior: "...", location: "..." } }
	// Database stores: { "15:00": [{ subjectType: "foster_parent", subjectId: "Sayyida", behavior: "...", location: "..." }] }
	transformedTimeSlots := transformFlatToArray(req.TimeSlots)

	// Create observation model
	obs := &models.Observation{
		ObserverName:       req.ObserverName,
		ObservationDate:    obsDate,
		StartTime:          req.StartTime,
		EndTime:            req.EndTime,
		Aviary:             req.Aviary,
		Mode:               req.Mode,
		BabiesPresent:      req.BabiesPresent,
		EnvironmentalNotes: req.EnvironmentalNotes,
		TimeSlots:          transformedTimeSlots,
		Emails:             req.Emails,
	}

	// Save to database
	if err := s.repo.Create(ctx, obs); err != nil {
		return nil, fmt.Errorf("failed to create observation: %w", err)
	}

	return obs, nil
}

// transformFlatToArray converts Phase 2 flat observations to array structure
// This is the transformation layer that makes the database ready for Phase 4
func transformFlatToArray(flatSlots map[string]models.FlatObservation) models.TimeSlots {
	arraySlots := make(models.TimeSlots)

	for timeKey, flatObs := range flatSlots {
		// Wrap the single observation in an array with hardcoded Phase 2 metadata
		subjectObs := models.SubjectObservation{
			SubjectType:          "foster_parent",
			SubjectID:            "Sayyida",
			Behavior:             flatObs.Behavior,
			Location:             flatObs.Location,
			Notes:                flatObs.Notes,
			Object:               flatObs.Object,
			ObjectOther:          flatObs.ObjectOther,
			Animal:               flatObs.Animal,
			AnimalOther:          flatObs.AnimalOther,
			InteractionType:      flatObs.InteractionType,
			InteractionTypeOther: flatObs.InteractionTypeOther,
			Description:          flatObs.Description,
		}

		// Store as single-element array
		arraySlots[timeKey] = []models.SubjectObservation{subjectObs}
	}

	return arraySlots
}
