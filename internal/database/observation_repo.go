package database

import (
	"context"
	"fmt"

	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/lib/pq"
)

// ObservationRepository handles observation database operations
type ObservationRepository struct {
	db *DB
}

// NewObservationRepository creates a new observation repository
func NewObservationRepository(db *DB) *ObservationRepository {
	return &ObservationRepository{db: db}
}

// Create inserts a new observation into the database
func (r *ObservationRepository) Create(ctx context.Context, obs *models.Observation) error {
	query := `
		INSERT INTO observations (
			observer_name,
			observation_date,
			start_time,
			end_time,
			aviary,
			mode,
			babies_present,
			environmental_notes,
			time_slots,
			emails
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10
		)
		RETURNING id, submitted_at, created_at, updated_at
	`

	err := r.db.QueryRowContext(
		ctx,
		query,
		obs.ObserverName,
		obs.ObservationDate,
		obs.StartTime,
		obs.EndTime,
		obs.Aviary,
		obs.Mode,
		obs.BabiesPresent,
		obs.EnvironmentalNotes,
		obs.TimeSlots,
		pq.Array(obs.Emails),
	).Scan(&obs.ID, &obs.SubmittedAt, &obs.CreatedAt, &obs.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to insert observation: %w", err)
	}

	return nil
}
