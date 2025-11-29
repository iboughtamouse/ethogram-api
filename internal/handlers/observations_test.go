package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/iboughtamouse/ethogram-api/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTestRouter creates a test Gin router with database connection
func setupTestRouter(t *testing.T) (*gin.Engine, *database.DB) {
	gin.SetMode(gin.TestMode)

	// Connect to test database
	// Using the same DATABASE_URL for now; in production, use separate test DB
	db, err := database.Connect("postgres://postgres:postgres@localhost:5432/ethogram?sslmode=disable")
	require.NoError(t, err)

	// Clean up after test
	t.Cleanup(func() {
		// Truncate observations table to ensure clean state
		_, err := db.Exec("TRUNCATE observations CASCADE")
		if err != nil {
			t.Logf("Warning: failed to truncate observations: %v", err)
		}
		db.Close()
	})

	// Set up router with handlers
	router := gin.New()
	observationRepo := database.NewObservationRepository(db)
	excelService := services.NewExcelService()
	emailService := services.NewEmailService("test-api-key", "test@example.com")
	observationService := services.NewObservationService(observationRepo, excelService, emailService)
	observationHandler := NewObservationHandler(observationService)

	router.POST("/api/observations", observationHandler.Create)

	return router, db
}

func TestCreateObservation_Success(t *testing.T) {
	router, db := setupTestRouter(t)

	// Create valid request
	reqBody := models.CreateObservationRequest{
		ObserverName:    "TestObserver",
		ObservationDate: time.Now().Format("2006-01-02"),
		StartTime:       "15:00",
		EndTime:         "16:00",
		Aviary:          "Flight Cage 1",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: map[string]models.FlatObservation{
			"15:00": {
				Behavior: "resting_alert",
				Location: "12",
				Notes:    "Test observation",
			},
			"15:05": {
				Behavior: "preening",
				Location: "12",
				Notes:    "",
			},
		},
		Emails: []string{"test@example.com"},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	// Make request
	req := httptest.NewRequest("POST", "/api/observations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	if w.Code != http.StatusCreated {
		t.Logf("Response body: %s", w.Body.String())
	}
	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.NotEmpty(t, data["id"])
	assert.Equal(t, "TestObserver", data["observerName"])
	assert.Equal(t, reqBody.ObservationDate, data["observationDate"])
	assert.Equal(t, "15:00", data["startTime"])
	assert.Equal(t, "16:00", data["endTime"])

	// Verify database insertion
	ctx := context.Background()
	var count int
	err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM observations WHERE observer_name = $1", "TestObserver").Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Verify transformation was applied (flat → array)
	var timeSlots models.TimeSlots
	err = db.QueryRowContext(ctx, "SELECT time_slots FROM observations WHERE observer_name = $1", "TestObserver").Scan(&timeSlots)
	require.NoError(t, err)

	// Check that time slots are arrays
	assert.IsType(t, []models.SubjectObservation{}, timeSlots["15:00"])
	assert.Len(t, timeSlots["15:00"], 1)

	// Verify Phase 2 hardcoded values
	assert.Equal(t, "foster_parent", timeSlots["15:00"][0].SubjectType)
	assert.Equal(t, "Sayyida", timeSlots["15:00"][0].SubjectID)
	assert.Equal(t, "resting_alert", timeSlots["15:00"][0].Behavior)
	assert.Equal(t, "12", timeSlots["15:00"][0].Location)
}

func TestCreateObservation_ValidationError_MissingRequiredFields(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Create request with missing observer name
	reqBody := map[string]interface{}{
		"observationDate": time.Now().Format("2006-01-02"),
		"startTime":       "15:00",
		"endTime":         "16:00",
		// Missing observerName
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/observations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert validation error
	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.False(t, response["success"].(bool))
	assert.NotNil(t, response["error"])
}

func TestCreateObservation_ValidationError_InvalidDateFormat(t *testing.T) {
	router, _ := setupTestRouter(t)

	reqBody := models.CreateObservationRequest{
		ObserverName:    "TestObserver",
		ObservationDate: "2024-13-45", // Invalid date
		StartTime:       "15:00",
		EndTime:         "16:00",
		Aviary:          "Flight Cage 1",
		Mode:            "live",
		TimeSlots: map[string]models.FlatObservation{
			"15:00": {
				Behavior: "resting_alert",
				Location: "12",
			},
		},
		Emails: []string{"test@example.com"},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/observations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert error
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.False(t, response["success"].(bool))
}

func TestCreateObservation_WithInteractionFields(t *testing.T) {
	router, db := setupTestRouter(t)

	reqBody := models.CreateObservationRequest{
		ObserverName:    "TestObserver2",
		ObservationDate: time.Now().Format("2006-01-02"),
		StartTime:       "15:00",
		EndTime:         "16:00",
		Aviary:          "Flight Cage 1",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: map[string]models.FlatObservation{
			"15:00": {
				Behavior:        "interacting_object",
				Location:        "GROUND",
				Notes:           "Playing with enrichment",
				Object:          "newspaper",
				InteractionType: "foraging",
			},
		},
		Emails: []string{"test@example.com"},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/observations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert success
	assert.Equal(t, http.StatusCreated, w.Code)

	// Verify interaction fields in database
	ctx := context.Background()
	var timeSlots models.TimeSlots
	err = db.QueryRowContext(ctx, "SELECT time_slots FROM observations WHERE observer_name = $1", "TestObserver2").Scan(&timeSlots)
	require.NoError(t, err)

	assert.Equal(t, "interacting_object", timeSlots["15:00"][0].Behavior)
	assert.Equal(t, "newspaper", timeSlots["15:00"][0].Object)
	assert.Equal(t, "foraging", timeSlots["15:00"][0].InteractionType)
}

func TestCreateObservation_MultipleTimeSlots(t *testing.T) {
	router, db := setupTestRouter(t)

	reqBody := models.CreateObservationRequest{
		ObserverName:    "TestObserver3",
		ObservationDate: time.Now().Format("2006-01-02"),
		StartTime:       "15:00",
		EndTime:         "16:00",
		Aviary:          "Flight Cage 1",
		Mode:            "live",
		BabiesPresent:   0,
		TimeSlots: map[string]models.FlatObservation{
			"15:00": {Behavior: "resting_alert", Location: "12"},
			"15:05": {Behavior: "preening", Location: "12"},
			"15:10": {Behavior: "flying", Location: "BB1"},
			"15:15": {Behavior: "drinking", Location: "BB1"},
		},
		Emails: []string{"test@example.com"},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/observations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert success
	assert.Equal(t, http.StatusCreated, w.Code)

	// Verify all time slots in database
	ctx := context.Background()
	var timeSlots models.TimeSlots
	err = db.QueryRowContext(ctx, "SELECT time_slots FROM observations WHERE observer_name = $1", "TestObserver3").Scan(&timeSlots)
	require.NoError(t, err)

	assert.Len(t, timeSlots, 4)
	assert.Contains(t, timeSlots, "15:00")
	assert.Contains(t, timeSlots, "15:05")
	assert.Contains(t, timeSlots, "15:10")
	assert.Contains(t, timeSlots, "15:15")
}
