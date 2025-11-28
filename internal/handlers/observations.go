package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
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
