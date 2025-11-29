package database

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDB(t *testing.T) *DB {
	db, err := Connect("postgres://postgres:postgres@localhost:5432/ethogram?sslmode=disable")
	require.NoError(t, err, "Failed to connect to test database - is PostgreSQL running?")

	t.Cleanup(func() {
		_, err := db.Exec("TRUNCATE observations CASCADE")
		if err != nil {
			t.Logf("Warning: failed to truncate observations: %v", err)
		}
		db.Close()
	})

	return db
}

func TestNewObservationRepository(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	require.NotNil(t, repo)
	assert.NotNil(t, repo.db)
}

func TestObservationRepository_Create_BasicInsertion(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	envNotes := "Test environmental notes"
	obs := &models.Observation{
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
		},
		Emails: []string{"test@example.com"},
	}

	// ID should be zero/empty before insertion
	assert.Equal(t, uuid.Nil, obs.ID)

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// After insertion, ID should be populated
	assert.NotEqual(t, uuid.Nil, obs.ID)
	assert.NotZero(t, obs.SubmittedAt)
	assert.NotZero(t, obs.CreatedAt)
	assert.NotZero(t, obs.UpdatedAt)

	// Verify record exists in database
	var count int
	err = db.Get(&count, "SELECT COUNT(*) FROM observations WHERE id = $1", obs.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestObservationRepository_Create_MultipleTimeSlots(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	obs := &models.Observation{
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:15",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
					Location:    "12",
				},
			},
			"15:05": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "preening",
					Location:    "PERCH_3",
				},
			},
			"15:10": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "flying",
				},
			},
		},
		Emails: []string{"test@example.com"},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify insertion
	var count int
	err = db.Get(&count, "SELECT COUNT(*) FROM observations WHERE id = $1", obs.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Verify timestamps are populated
	assert.NotZero(t, obs.SubmittedAt)
	assert.NotZero(t, obs.CreatedAt)
}

func TestObservationRepository_Create_WithInteractionFields(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	obs := &models.Observation{
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
					Object:          "newspaper",
					InteractionType: "foraging",
					Notes:           "Playing with enrichment",
				},
			},
		},
		Emails: []string{"test@example.com"},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify basic insertion
	var observerName string
	err = db.QueryRow("SELECT observer_name FROM observations WHERE id = $1", obs.ID).Scan(&observerName)
	require.NoError(t, err)
	assert.Equal(t, "TestObserver", observerName)
}

func TestObservationRepository_Create_NilEnvironmentalNotes(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	obs := &models.Observation{
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		EnvironmentalNotes: nil, // Explicitly nil
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails: []string{"test@example.com"},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify insertion succeeded
	var count int
	err = db.Get(&count, "SELECT COUNT(*) FROM observations WHERE id = $1", obs.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestObservationRepository_Create_EmptyEnvironmentalNotes(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	emptyNotes := ""
	obs := &models.Observation{
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "live",
		BabiesPresent:   0,
		EnvironmentalNotes: &emptyNotes, // Empty string (not nil)
		TimeSlots: models.TimeSlots{
			"15:00": []models.SubjectObservation{
				{
					SubjectType: "foster_parent",
					SubjectID:   "Sayyida",
					Behavior:    "resting_alert",
				},
			},
		},
		Emails: []string{"test@example.com"},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify insertion
	assert.NotEqual(t, uuid.Nil, obs.ID)
}

func TestObservationRepository_Create_MultipleEmails(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	obs := &models.Observation{
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
		Emails: []string{
			"user1@example.com",
			"user2@example.com",
			"user3@example.com",
		},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify insertion
	var count int
	err = db.Get(&count, "SELECT COUNT(*) FROM observations WHERE id = $1", obs.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestObservationRepository_Create_VideoMode(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	obs := &models.Observation{
		ObserverName:    "TestObserver",
		ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
		StartTime:       "15:00",
		EndTime:         "15:10",
		Aviary:          "Test Aviary",
		Mode:            "vod", // Video mode
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
		Emails: []string{"test@example.com"},
	}

	err := repo.Create(context.Background(), obs)
	require.NoError(t, err)

	// Verify mode was stored correctly
	var mode string
	err = db.QueryRow("SELECT mode FROM observations WHERE id = $1", obs.ID).Scan(&mode)
	require.NoError(t, err)
	assert.Equal(t, "vod", mode)
}

func TestObservationRepository_Create_DifferentAviaries(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	aviaries := []string{
		"Main Aviary",
		"Secondary Aviary",
		"Quarantine Area",
	}

	for _, aviary := range aviaries {
		t.Run(aviary, func(t *testing.T) {
			obs := &models.Observation{
				ObserverName:    "TestObserver",
				ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "15:10",
				Aviary:          aviary,
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
				Emails: []string{"test@example.com"},
			}

			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)

			// Verify aviary was stored
			var storedAviary string
			err = db.QueryRow("SELECT aviary FROM observations WHERE id = $1", obs.ID).Scan(&storedAviary)
			require.NoError(t, err)
			assert.Equal(t, aviary, storedAviary)
		})
	}
}

func TestObservationRepository_Create_BabiesPresent(t *testing.T) {
	db := setupTestDB(t)
	repo := NewObservationRepository(db)

	tests := []struct {
		name          string
		babiesPresent int
	}{
		{"no babies", 0},
		{"one baby", 1},
		{"multiple babies", 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			obs := &models.Observation{
				ObserverName:    "TestObserver",
				ObservationDate: time.Date(2025, 11, 29, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "15:10",
				Aviary:          "Test Aviary",
				Mode:            "live",
				BabiesPresent:   tt.babiesPresent,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{
							SubjectType: "foster_parent",
							SubjectID:   "Sayyida",
							Behavior:    "resting_alert",
						},
					},
				},
				Emails: []string{"test@example.com"},
			}

			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)

			// Verify babies_present was stored
			var storedBabies int
			err = db.QueryRow("SELECT babies_present FROM observations WHERE id = $1", obs.ID).Scan(&storedBabies)
			require.NoError(t, err)
			assert.Equal(t, tt.babiesPresent, storedBabies)
		})
	}
}
