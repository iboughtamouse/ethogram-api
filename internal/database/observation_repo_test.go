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

// TestObservationRepository_GetByID tests the GetByID repository method
func TestObservationRepository_GetByID(t *testing.T) {
	t.Run("successful retrieval", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create an observation first
		obs := &models.Observation{
			ObserverName:    "TestObserver",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "15:00",
			EndTime:         "16:00",
			Aviary:          "A1",
			Mode:            "focal",
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
			},
			Emails: []string{"test@example.com"},
		}

		err := repo.Create(context.Background(), obs)
		require.NoError(t, err)
		require.NotEqual(t, uuid.Nil, obs.ID)

		// Retrieve it
		retrieved, err := repo.GetByID(context.Background(), obs.ID)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, retrieved)
		assert.Equal(t, obs.ID, retrieved.ID)
		assert.Equal(t, obs.ObserverName, retrieved.ObserverName)
		assert.Equal(t, obs.Aviary, retrieved.Aviary)
		assert.Equal(t, obs.Mode, retrieved.Mode)
		assert.Equal(t, obs.BabiesPresent, retrieved.BabiesPresent)
		assert.Equal(t, "15:00", retrieved.StartTime)
		assert.Equal(t, "16:00", retrieved.EndTime)
		assert.NotZero(t, retrieved.SubmittedAt)
		assert.NotZero(t, retrieved.CreatedAt)
	})

	t.Run("observation not found", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		nonExistentID := uuid.New()

		// Try to retrieve non-existent observation
		retrieved, err := repo.GetByID(context.Background(), nonExistentID)

		// Assert
		assert.Error(t, err)
		assert.Nil(t, retrieved)
	})

	t.Run("verify time slots structure", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observation with multiple time slots
		obs := &models.Observation{
			ObserverName:    "TestObserver",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "15:00",
			EndTime:         "15:15",
			Aviary:          "A1",
			Mode:            "focal",
			BabiesPresent:   2,
			TimeSlots: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{
						SubjectType: "foster_parent",
						SubjectID:   "Sayyida",
						Behavior:    "resting_alert",
						Location:    "12",
						Notes:       "Alert posture",
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
						Location:    "BB1",
					},
				},
			},
			Emails: []string{"test@example.com"},
		}

		err := repo.Create(context.Background(), obs)
		require.NoError(t, err)

		// Retrieve it
		retrieved, err := repo.GetByID(context.Background(), obs.ID)

		// Assert time slots structure
		assert.NoError(t, err)
		assert.Len(t, retrieved.TimeSlots, 3)
		assert.Contains(t, retrieved.TimeSlots, "15:00")
		assert.Contains(t, retrieved.TimeSlots, "15:05")
		assert.Contains(t, retrieved.TimeSlots, "15:10")

		// Verify each time slot is an array with one element (Phase 2)
		assert.Len(t, retrieved.TimeSlots["15:00"], 1)
		assert.Equal(t, "resting_alert", retrieved.TimeSlots["15:00"][0].Behavior)
		assert.Equal(t, "Alert posture", retrieved.TimeSlots["15:00"][0].Notes)
	})

	t.Run("verify interaction fields", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		obs := &models.Observation{
			ObserverName:    "TestObserver",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "10:00",
			EndTime:         "10:05",
			Aviary:          "A1",
			Mode:            "focal",
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
						Notes:           "Shredding paper",
					},
				},
			},
			Emails: []string{"test@example.com"},
		}

		err := repo.Create(context.Background(), obs)
		require.NoError(t, err)

		// Retrieve it
		retrieved, err := repo.GetByID(context.Background(), obs.ID)

		// Assert interaction fields preserved
		assert.NoError(t, err)
		assert.Equal(t, "interacting_object", retrieved.TimeSlots["10:00"][0].Behavior)
		assert.Equal(t, "newspaper", retrieved.TimeSlots["10:00"][0].Object)
		assert.Equal(t, "foraging", retrieved.TimeSlots["10:00"][0].InteractionType)
		assert.Equal(t, "Shredding paper", retrieved.TimeSlots["10:00"][0].Notes)
	})
}

// TestObservationRepository_List tests the List repository method
func TestObservationRepository_List(t *testing.T) {
	t.Run("list all with no filters", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create multiple observations
		for i := 0; i < 5; i++ {
			obs := &models.Observation{
				ObserverName:    "Observer" + string(rune('1'+i)),
				ObservationDate: time.Date(2024, 1, 15+i, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// List all
		filters := ObservationFilters{
			Limit:  50,
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 5, result.Total)
		assert.Len(t, result.Observations, 5)
		assert.Equal(t, 50, result.Limit)
		assert.Equal(t, 0, result.Offset)
	})

	t.Run("filter by aviary", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations in different aviaries
		aviaries := []string{"A1", "A1", "A2", "A1", "A3"}
		for i, aviary := range aviaries {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: time.Date(2024, 1, 15+i, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          aviary,
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter for A1
		targetAviary := "A1"
		filters := ObservationFilters{
			Aviary: &targetAviary,
			Limit:  50,
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 3, result.Total)
		assert.Len(t, result.Observations, 3)
		for _, obs := range result.Observations {
			assert.Equal(t, "A1", obs.Aviary)
		}
	})

	t.Run("filter by date range", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations on different dates
		dates := []time.Time{
			time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC),
			time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC),
			time.Date(2024, 1, 25, 0, 0, 0, 0, time.UTC),
		}

		for _, date := range dates {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: date,
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter for January 15-20 (inclusive)
		startDate := time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)
		endDate := time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC)
		filters := ObservationFilters{
			StartDate: &startDate,
			EndDate:   &endDate,
			Limit:     50,
			Offset:    0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 2, result.Total)
		assert.Len(t, result.Observations, 2)
	})

	t.Run("filter by observer name (case insensitive)", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with different observer names
		names := []string{"AliceObserver", "BobWatcher", "AliceSmith"}
		for _, name := range names {
			obs := &models.Observation{
				ObserverName:    name,
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter for "alice" (should match both AliceObserver and AliceSmith)
		searchName := "alice"
		filters := ObservationFilters{
			ObserverName: &searchName,
			Limit:        50,
			Offset:       0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 2, result.Total)
		assert.Len(t, result.Observations, 2)
	})

	t.Run("filter by mode", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with different modes
		modes := []string{"focal", "scan", "focal", "vod"}
		for _, mode := range modes {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            mode,
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter for focal mode
		targetMode := "focal"
		filters := ObservationFilters{
			Mode:   &targetMode,
			Limit:  50,
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 2, result.Total)
		assert.Len(t, result.Observations, 2)
		for _, obs := range result.Observations {
			assert.Equal(t, "focal", obs.Mode)
		}
	})

	t.Run("filter by babies present", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with different babies_present values
		babiesCounts := []int{0, 2, 0, 3, 2}
		for _, count := range babiesCounts {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   count,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter for observations with 2 babies
		targetBabies := 2
		filters := ObservationFilters{
			BabiesPresent: &targetBabies,
			Limit:         50,
			Offset:        0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 2, result.Total)
		assert.Len(t, result.Observations, 2)
		for _, obs := range result.Observations {
			assert.Equal(t, 2, obs.BabiesPresent)
		}
	})

	t.Run("pagination - first page", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create 15 observations
		for i := 0; i < 15; i++ {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Get first page (limit 10)
		filters := ObservationFilters{
			Limit:  10,
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 15, result.Total)
		assert.Len(t, result.Observations, 10)
		assert.Equal(t, 10, result.Limit)
		assert.Equal(t, 0, result.Offset)
	})

	t.Run("pagination - second page", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create 15 observations
		for i := 0; i < 15; i++ {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Get second page (offset 10, limit 10)
		filters := ObservationFilters{
			Limit:  10,
			Offset: 10,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 15, result.Total)
		assert.Len(t, result.Observations, 5) // Only 5 remaining
		assert.Equal(t, 10, result.Limit)
		assert.Equal(t, 10, result.Offset)
	})

	t.Run("sorting by observation_date ASC", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with different dates
		dates := []time.Time{
			time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC),
			time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC),
			time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
		}

		for _, date := range dates {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: date,
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Sort by observation_date ASC
		filters := ObservationFilters{
			Limit:     50,
			Offset:    0,
			SortBy:    "observation_date",
			SortOrder: "asc",
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Len(t, result.Observations, 3)
		assert.Equal(t, time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC), result.Observations[0].ObservationDate)
		assert.Equal(t, time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC), result.Observations[1].ObservationDate)
		assert.Equal(t, time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC), result.Observations[2].ObservationDate)
	})

	t.Run("sorting by observer_name DESC", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with different observer names
		names := []string{"Charlie", "Alice", "Bob"}
		for _, name := range names {
			obs := &models.Observation{
				ObserverName:    name,
				ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          "A1",
				Mode:            "focal",
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Sort by observer_name DESC
		filters := ObservationFilters{
			Limit:     50,
			Offset:    0,
			SortBy:    "observer_name",
			SortOrder: "desc",
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Len(t, result.Observations, 3)
		assert.Equal(t, "Charlie", result.Observations[0].ObserverName)
		assert.Equal(t, "Bob", result.Observations[1].ObserverName)
		assert.Equal(t, "Alice", result.Observations[2].ObserverName)
	})

	t.Run("invalid sort field defaults to submitted_at", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create an observation
		obs := &models.Observation{
			ObserverName:    "Observer",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "15:00",
			EndTime:         "16:00",
			Aviary:          "A1",
			Mode:            "focal",
			BabiesPresent:   0,
			TimeSlots: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
				},
			},
			Emails: []string{"test@example.com"},
		}
		err := repo.Create(context.Background(), obs)
		require.NoError(t, err)

		// Try to sort by invalid field (should default to submitted_at)
		filters := ObservationFilters{
			Limit:     50,
			Offset:    0,
			SortBy:    "invalid_field; DROP TABLE observations;", // SQL injection attempt
			SortOrder: "desc",
		}

		result, err := repo.List(context.Background(), filters)

		// Should succeed with default sort field (no SQL injection)
		assert.NoError(t, err)
		assert.NotNil(t, result)
	})

	t.Run("empty result set", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Don't create any observations

		filters := ObservationFilters{
			Limit:  50,
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert
		assert.NoError(t, err)
		assert.Equal(t, 0, result.Total)
		assert.Empty(t, result.Observations)
	})

	t.Run("max limit enforcement", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create one observation
		obs := &models.Observation{
			ObserverName:    "Observer",
			ObservationDate: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			StartTime:       "15:00",
			EndTime:         "16:00",
			Aviary:          "A1",
			Mode:            "focal",
			BabiesPresent:   0,
			TimeSlots: models.TimeSlots{
				"15:00": []models.SubjectObservation{
					{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
				},
			},
			Emails: []string{"test@example.com"},
		}
		err := repo.Create(context.Background(), obs)
		require.NoError(t, err)

		// Try to set limit higher than max (500)
		filters := ObservationFilters{
			Limit:  1000, // Above max
			Offset: 0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert - limit should be capped at 500
		assert.NoError(t, err)
		assert.Equal(t, 500, result.Limit)
	})

	t.Run("combined filters", func(t *testing.T) {
		db := setupTestDB(t)
		repo := NewObservationRepository(db)

		// Create observations with various attributes
		testData := []struct {
			aviary string
			mode   string
			date   time.Time
		}{
			{"A1", "focal", time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)},
			{"A1", "scan", time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)},
			{"A2", "focal", time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)},
			{"A1", "focal", time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC)},
		}

		for _, td := range testData {
			obs := &models.Observation{
				ObserverName:    "Observer",
				ObservationDate: td.date,
				StartTime:       "15:00",
				EndTime:         "16:00",
				Aviary:          td.aviary,
				Mode:            td.mode,
				BabiesPresent:   0,
				TimeSlots: models.TimeSlots{
					"15:00": []models.SubjectObservation{
						{SubjectType: "foster_parent", SubjectID: "Sayyida", Behavior: "resting_alert"},
					},
				},
				Emails: []string{"test@example.com"},
			}
			err := repo.Create(context.Background(), obs)
			require.NoError(t, err)
		}

		// Filter: A1 + focal mode + date = 2024-01-15
		targetAviary := "A1"
		targetMode := "focal"
		targetDate := time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)

		filters := ObservationFilters{
			Aviary:    &targetAviary,
			Mode:      &targetMode,
			StartDate: &targetDate,
			EndDate:   &targetDate,
			Limit:     50,
			Offset:    0,
		}

		result, err := repo.List(context.Background(), filters)

		// Assert - should only match first observation
		assert.NoError(t, err)
		assert.Equal(t, 1, result.Total)
		assert.Len(t, result.Observations, 1)
		assert.Equal(t, "A1", result.Observations[0].Aviary)
		assert.Equal(t, "focal", result.Observations[0].Mode)
	})
}
