.PHONY: help dev build test docker-up docker-down migrate-up migrate-down migrate-create clean

# Go binary path (adjust if needed)
GO := /usr/local/go/bin/go

# Database URL for migrations
DATABASE_URL := postgres://postgres:postgres@localhost:5432/ethogram?sslmode=disable

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

dev: ## Run development server
	$(GO) run cmd/api/main.go

build: ## Build the application
	$(GO) build -o bin/api cmd/api/main.go

test: ## Run tests
	$(GO) test -v ./...

docker-up: ## Start Docker containers (PostgreSQL + Redis)
	docker compose up -d

docker-down: ## Stop Docker containers
	docker compose down

docker-logs: ## Show Docker container logs
	docker compose logs -f

migrate-up: ## Run database migrations
	migrate -path migrations -database "$(DATABASE_URL)" up

migrate-down: ## Rollback last migration
	migrate -path migrations -database "$(DATABASE_URL)" down 1

migrate-create: ## Create a new migration (usage: make migrate-create name=add_users)
	migrate create -ext sql -dir migrations -seq $(name)

clean: ## Clean build artifacts
	rm -rf bin/
	$(GO) clean

.DEFAULT_GOAL := help
