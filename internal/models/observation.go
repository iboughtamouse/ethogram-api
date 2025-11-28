package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Observation represents a behavioral observation session
type Observation struct {
	ID                 uuid.UUID  `db:"id" json:"id"`
	ObserverName       string     `db:"observer_name" json:"observerName"`
	ObservationDate    time.Time  `db:"observation_date" json:"observationDate"`
	StartTime          string     `db:"start_time" json:"startTime"`
	EndTime            string     `db:"end_time" json:"endTime"`
	Aviary             string     `db:"aviary" json:"aviary"`
	Mode               string     `db:"mode" json:"mode"`
	BabiesPresent      int        `db:"babies_present" json:"babiesPresent"`
	EnvironmentalNotes *string    `db:"environmental_notes" json:"environmentalNotes"`
	TimeSlots          TimeSlots  `db:"time_slots" json:"timeSlots"`
	Emails             []string   `db:"emails" json:"emails"`
	SubmittedAt        time.Time  `db:"submitted_at" json:"submittedAt"`
	CreatedAt          time.Time  `db:"created_at" json:"createdAt"`
	UpdatedAt          time.Time  `db:"updated_at" json:"updatedAt"`
	UserID             *uuid.UUID `db:"user_id" json:"userId"`
}

// TimeSlots represents the JSONB structure for time slot observations
// Structure: { "15:00": [SubjectObservation, ...], "15:05": [...], ... }
type TimeSlots map[string][]SubjectObservation

// SubjectObservation represents a single subject's observation at a time slot
type SubjectObservation struct {
	SubjectType           string `json:"subjectType"`
	SubjectID             string `json:"subjectId"`
	Behavior              string `json:"behavior"`
	Location              string `json:"location"`
	Notes                 string `json:"notes"`
	Object                string `json:"object,omitempty"`
	ObjectOther           string `json:"objectOther,omitempty"`
	Animal                string `json:"animal,omitempty"`
	AnimalOther           string `json:"animalOther,omitempty"`
	InteractionType       string `json:"interactionType,omitempty"`
	InteractionTypeOther  string `json:"interactionTypeOther,omitempty"`
	Description           string `json:"description,omitempty"`
}

// Value implements driver.Valuer for database storage
func (ts TimeSlots) Value() (driver.Value, error) {
	return json.Marshal(ts)
}

// Scan implements sql.Scanner for database retrieval
func (ts *TimeSlots) Scan(value interface{}) error {
	if value == nil {
		*ts = make(TimeSlots)
		return nil
	}

	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}

	return json.Unmarshal(bytes, ts)
}

// CreateObservationRequest represents the incoming request from frontend
// Phase 2: Frontend sends flat structure per time slot
type CreateObservationRequest struct {
	ObserverName       string                       `json:"observerName" binding:"required,min=2,max=32"`
	ObservationDate    string                       `json:"observationDate" binding:"required"`
	StartTime          string                       `json:"startTime" binding:"required"`
	EndTime            string                       `json:"endTime" binding:"required"`
	Aviary             string                       `json:"aviary" binding:"required"`
	Mode               string                       `json:"mode" binding:"required,oneof=live vod"`
	BabiesPresent      int                          `json:"babiesPresent"`
	EnvironmentalNotes *string                      `json:"environmentalNotes"`
	TimeSlots          map[string]FlatObservation   `json:"timeSlots" binding:"required"`
	Emails             []string                     `json:"emails"`
}

// FlatObservation represents Phase 2 frontend structure (single subject, flat)
type FlatObservation struct {
	Behavior              string `json:"behavior" binding:"required"`
	Location              string `json:"location"`
	Notes                 string `json:"notes"`
	Object                string `json:"object,omitempty"`
	ObjectOther           string `json:"objectOther,omitempty"`
	Animal                string `json:"animal,omitempty"`
	AnimalOther           string `json:"animalOther,omitempty"`
	InteractionType       string `json:"interactionType,omitempty"`
	InteractionTypeOther  string `json:"interactionTypeOther,omitempty"`
	Description           string `json:"description,omitempty"`
}

// CreateObservationResponse represents the success response
type CreateObservationResponse struct {
	ID               uuid.UUID `json:"id"`
	ObserverName     string    `json:"observerName"`
	ObservationDate  string    `json:"observationDate"`
	StartTime        string    `json:"startTime"`
	EndTime          string    `json:"endTime"`
	SubmittedAt      time.Time `json:"submittedAt"`
	EmailsSent       bool      `json:"emailsSent"`
	EmailRecipients  []string  `json:"emailRecipients,omitempty"`
}
