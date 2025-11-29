package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/iboughtamouse/ethogram-api/internal/services"
	"github.com/iboughtamouse/ethogram-api/pkg/utils"
)

// ObservationHandler handles observation HTTP requests
type ObservationHandler struct {
	service *services.ObservationService
}

// NewObservationHandler creates a new observation handler
func NewObservationHandler(service *services.ObservationService) *ObservationHandler {
	return &ObservationHandler{service: service}
}

// Create handles POST /api/observations
func (h *ObservationHandler) Create(c *gin.Context) {
	var req models.CreateObservationRequest

	// Bind and validate request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, utils.ErrorResponse(
			"VALIDATION_ERROR",
			"Invalid request data",
			err.Error(),
		))
		return
	}

	// Create observation
	obs, err := h.service.Create(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.ErrorResponse(
			"INTERNAL_ERROR",
			"Failed to create observation",
			err.Error(),
		))
		return
	}

	// Build response
	response := models.CreateObservationResponse{
		ID:              obs.ID,
		ObserverName:    obs.ObserverName,
		ObservationDate: obs.ObservationDate.Format("2006-01-02"),
		StartTime:       obs.StartTime,
		EndTime:         obs.EndTime,
		SubmittedAt:     obs.SubmittedAt,
		EmailsSent:      false, // TODO: Implement email sending
		EmailRecipients: obs.Emails,
	}

	c.JSON(http.StatusCreated, utils.SuccessResponse(
		response,
		"Observation submitted successfully",
	))
}

// GetByID handles GET /api/observations/:id
func (h *ObservationHandler) GetByID(c *gin.Context) {
	id := c.Param("id")

	// Get observation
	obs, err := h.service.GetByID(c.Request.Context(), id)
	if err != nil {
		if err.Error() == "invalid observation ID" || err.Error() == "sql: no rows in result set" {
			c.JSON(http.StatusNotFound, utils.ErrorResponse(
				"NOT_FOUND",
				"Observation not found",
				err.Error(),
			))
			return
		}

		c.JSON(http.StatusInternalServerError, utils.ErrorResponse(
			"INTERNAL_ERROR",
			"Failed to retrieve observation",
			err.Error(),
		))
		return
	}

	c.JSON(http.StatusOK, utils.SuccessResponse(obs, ""))
}

// List handles GET /api/observations
func (h *ObservationHandler) List(c *gin.Context) {
	// Parse query parameters into filters
	var filters database.ObservationFilters

	// String filters
	if aviary := c.Query("aviary"); aviary != "" {
		filters.Aviary = &aviary
	}
	if observerName := c.Query("observerName"); observerName != "" {
		filters.ObserverName = &observerName
	}
	if mode := c.Query("mode"); mode != "" {
		filters.Mode = &mode
	}

	// Date filters
	if startDate := c.Query("startDate"); startDate != "" {
		parsed, err := time.Parse("2006-01-02", startDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"Invalid startDate format. Use YYYY-MM-DD",
				err.Error(),
			))
			return
		}
		filters.StartDate = &parsed
	}

	if endDate := c.Query("endDate"); endDate != "" {
		parsed, err := time.Parse("2006-01-02", endDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"Invalid endDate format. Use YYYY-MM-DD",
				err.Error(),
			))
			return
		}
		filters.EndDate = &parsed
	}

	// Integer filters
	if babiesPresent := c.Query("babiesPresent"); babiesPresent != "" {
		var bp int
		if _, err := fmt.Sscanf(babiesPresent, "%d", &bp); err != nil {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"Invalid babiesPresent value",
				err.Error(),
			))
			return
		}
		if bp < 0 {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"babiesPresent must be non-negative",
				"",
			))
			return
		}
		filters.BabiesPresent = &bp
	}

	// Pagination
	if limit := c.Query("limit"); limit != "" {
		var l int
		if _, err := fmt.Sscanf(limit, "%d", &l); err != nil {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"Invalid limit value",
				err.Error(),
			))
			return
		}
		if l < 0 {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"limit must be non-negative",
				"",
			))
			return
		}
		filters.Limit = l
	}

	if offset := c.Query("offset"); offset != "" {
		var o int
		if _, err := fmt.Sscanf(offset, "%d", &o); err != nil {
			c.JSON(http.StatusBadRequest, utils.ErrorResponse(
				"VALIDATION_ERROR",
				"Invalid offset value",
				err.Error(),
			))
			return
		}
		filters.Offset = o
	}

	// Sorting
	if sortBy := c.Query("sortBy"); sortBy != "" {
		filters.SortBy = sortBy
	}
	if sortOrder := c.Query("sortOrder"); sortOrder != "" {
		filters.SortOrder = sortOrder
	}

	// Get observations
	result, err := h.service.List(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, utils.ErrorResponse(
			"INTERNAL_ERROR",
			"Failed to retrieve observations",
			err.Error(),
		))
		return
	}

	// Build response
	response := gin.H{
		"observations": result.Observations,
		"pagination": gin.H{
			"total":  result.Total,
			"limit":  result.Limit,
			"offset": result.Offset,
		},
	}

	c.JSON(http.StatusOK, utils.SuccessResponse(response, ""))
}
