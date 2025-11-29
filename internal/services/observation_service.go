package services

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/models"
)

// ObservationService handles observation business logic
type ObservationService struct {
	repo         *database.ObservationRepository
	excelService *ExcelService
	emailService *EmailService
}

// NewObservationService creates a new observation service
func NewObservationService(repo *database.ObservationRepository, excelService *ExcelService, emailService *EmailService) *ObservationService {
	return &ObservationService{
		repo:         repo,
		excelService: excelService,
		emailService: emailService,
	}
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

	// Save to database first (ensure data is never lost)
	if err := s.repo.Create(ctx, obs); err != nil {
		return nil, fmt.Errorf("failed to create observation: %w", err)
	}

	// Generate Excel and send email asynchronously (don't block response)
	// If this fails, observation is still saved
	if s.excelService != nil && s.emailService != nil && len(obs.Emails) > 0 {
		go s.sendObservationEmail(obs)
	}

	return obs, nil
}

// sendObservationEmail generates Excel and sends email
// Runs asynchronously to avoid blocking the HTTP response
func (s *ObservationService) sendObservationEmail(obs *models.Observation) {
	// Generate Excel file
	excelData, err := s.excelService.GenerateObservationExcel(obs)
	if err != nil {
		// Log error (in production, use structured logging)
		fmt.Printf("ERROR: Failed to generate Excel for observation %s: %v\n", obs.ID, err)
		return
	}

	// Send email with Excel attachment
	if err := s.emailService.SendObservationEmail(obs, excelData); err != nil {
		// Log error (in production, use structured logging)
		fmt.Printf("ERROR: Failed to send email for observation %s: %v\n", obs.ID, err)
		return
	}

	fmt.Printf("INFO: Email sent successfully for observation %s to %v\n", obs.ID, obs.Emails)
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

// GetByID retrieves a single observation by ID
func (s *ObservationService) GetByID(ctx context.Context, id string) (*models.Observation, error) {
	// Parse UUID
	observationID, err := uuid.Parse(id)
	if err != nil {
		return nil, fmt.Errorf("invalid observation ID: %w", err)
	}

	// Get from repository
	obs, err := s.repo.GetByID(ctx, observationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get observation: %w", err)
	}

	return obs, nil
}

// List retrieves observations with filters and pagination
func (s *ObservationService) List(ctx context.Context, filters database.ObservationFilters) (*database.ObservationListResult, error) {
	return s.repo.List(ctx, filters)
}
