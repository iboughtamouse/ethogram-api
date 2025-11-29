package database

import (
	"context"

	"github.com/google/uuid"
	"github.com/iboughtamouse/ethogram-api/internal/models"
	"github.com/stretchr/testify/mock"
)

// MockObservationRepository is a mock implementation of ObservationRepository for testing
type MockObservationRepository struct {
	mock.Mock
}

func (m *MockObservationRepository) Create(ctx context.Context, obs *models.Observation) error {
	args := m.Called(ctx, obs)
	return args.Error(0)
}

func (m *MockObservationRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.Observation, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Observation), args.Error(1)
}

func (m *MockObservationRepository) List(ctx context.Context, filters ObservationFilters) (*ObservationListResult, error) {
	args := m.Called(ctx, filters)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*ObservationListResult), args.Error(1)
}
