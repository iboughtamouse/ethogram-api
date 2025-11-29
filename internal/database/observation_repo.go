package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
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

// GetByID retrieves a single observation by ID
func (r *ObservationRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.Observation, error) {
	query := `
		SELECT
			id,
			observer_name,
			observation_date,
			start_time,
			end_time,
			aviary,
			mode,
			babies_present,
			environmental_notes,
			time_slots,
			emails,
			submitted_at,
			created_at,
			updated_at,
			user_id
		FROM observations
		WHERE id = $1
	`

	var obs models.Observation
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&obs.ID,
		&obs.ObserverName,
		&obs.ObservationDate,
		&obs.StartTime,
		&obs.EndTime,
		&obs.Aviary,
		&obs.Mode,
		&obs.BabiesPresent,
		&obs.EnvironmentalNotes,
		&obs.TimeSlots,
		pq.Array(&obs.Emails),
		&obs.SubmittedAt,
		&obs.CreatedAt,
		&obs.UpdatedAt,
		&obs.UserID,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get observation: %w", err)
	}

	return &obs, nil
}

// ObservationFilters holds filter criteria for querying observations
type ObservationFilters struct {
	Aviary        *string
	StartDate     *time.Time
	EndDate       *time.Time
	ObserverName  *string
	Mode          *string
	BabiesPresent *int
	Limit         int
	Offset        int
	SortBy        string
	SortOrder     string
}

// ObservationListResult holds paginated observation results
type ObservationListResult struct {
	Observations []*models.Observation
	Total        int
	Limit        int
	Offset       int
}

// List retrieves observations with filters and pagination
func (r *ObservationRepository) List(ctx context.Context, filters ObservationFilters) (*ObservationListResult, error) {
	// Build WHERE clause dynamically
	whereClauses := []string{}
	args := []interface{}{}
	argCounter := 1

	if filters.Aviary != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("aviary = $%d", argCounter))
		args = append(args, *filters.Aviary)
		argCounter++
	}

	if filters.StartDate != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("observation_date >= $%d", argCounter))
		args = append(args, *filters.StartDate)
		argCounter++
	}

	if filters.EndDate != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("observation_date <= $%d", argCounter))
		args = append(args, *filters.EndDate)
		argCounter++
	}

	if filters.ObserverName != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("observer_name ILIKE $%d", argCounter))
		args = append(args, "%"+*filters.ObserverName+"%")
		argCounter++
	}

	if filters.Mode != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("mode = $%d", argCounter))
		args = append(args, *filters.Mode)
		argCounter++
	}

	if filters.BabiesPresent != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("babies_present = $%d", argCounter))
		args = append(args, *filters.BabiesPresent)
		argCounter++
	}

	whereClause := ""
	if len(whereClauses) > 0 {
		whereClause = "WHERE " + strings.Join(whereClauses, " AND ")
	}

	// Map validated sort fields to actual column names to prevent SQL injection
	// Even though we validate, we use a whitelist map to ensure safe SQL generation
	validSortFields := map[string]string{
		"submitted_at":     "submitted_at",
		"observation_date": "observation_date",
		"observer_name":    "observer_name",
		"created_at":       "created_at",
	}

	sortBy := "submitted_at" // default
	if filters.SortBy != "" {
		if mappedField, ok := validSortFields[filters.SortBy]; ok {
			sortBy = mappedField
		}
	}

	// Validate sort order with whitelist
	sortOrder := "DESC"
	if filters.SortOrder == "asc" || filters.SortOrder == "ASC" {
		sortOrder = "ASC"
	}

	// Set default limit if not provided
	limit := 50
	if filters.Limit > 0 {
		if filters.Limit > 500 {
			limit = 500 // Max limit
		} else {
			limit = filters.Limit
		}
	}

	offset := 0
	if filters.Offset > 0 {
		offset = filters.Offset
	}

	// Get total count
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM observations %s", whereClause)
	var total int
	err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("failed to count observations: %w", err)
	}

	// Get observations
	query := fmt.Sprintf(`
		SELECT
			id,
			observer_name,
			observation_date,
			start_time,
			end_time,
			aviary,
			mode,
			babies_present,
			environmental_notes,
			time_slots,
			emails,
			submitted_at,
			created_at,
			updated_at,
			user_id
		FROM observations
		%s
		ORDER BY %s %s
		LIMIT $%d OFFSET $%d
	`, whereClause, sortBy, sortOrder, argCounter, argCounter+1)

	args = append(args, limit, offset)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query observations: %w", err)
	}
	defer rows.Close()

	observations := []*models.Observation{}
	for rows.Next() {
		var obs models.Observation
		err := rows.Scan(
			&obs.ID,
			&obs.ObserverName,
			&obs.ObservationDate,
			&obs.StartTime,
			&obs.EndTime,
			&obs.Aviary,
			&obs.Mode,
			&obs.BabiesPresent,
			&obs.EnvironmentalNotes,
			&obs.TimeSlots,
			pq.Array(&obs.Emails),
			&obs.SubmittedAt,
			&obs.CreatedAt,
			&obs.UpdatedAt,
			&obs.UserID,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan observation: %w", err)
		}
		observations = append(observations, &obs)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating observations: %w", err)
	}

	return &ObservationListResult{
		Observations: observations,
		Total:        total,
		Limit:        limit,
		Offset:       offset,
	}, nil
}
