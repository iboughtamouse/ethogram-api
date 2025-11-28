package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/iboughtamouse/ethogram-api/internal/database"
	"github.com/iboughtamouse/ethogram-api/internal/handlers"
	"github.com/iboughtamouse/ethogram-api/internal/middleware"
	"github.com/iboughtamouse/ethogram-api/internal/services"
	"github.com/iboughtamouse/ethogram-api/pkg/config"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Connect to database
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("✓ Connected to database")

	// Set Gin mode
	gin.SetMode(cfg.GinMode)

	// Create router
	router := gin.Default()

	// Apply middleware
	router.Use(middleware.CORS(cfg.AllowedOrigins))

	// Initialize repositories
	observationRepo := database.NewObservationRepository(db)

	// Initialize services
	observationService := services.NewObservationService(observationRepo)

	// Initialize handlers
	healthHandler := handlers.NewHealthHandler()
	observationHandler := handlers.NewObservationHandler(observationService)

	// Register routes
	api := router.Group("/api")
	{
		api.GET("/health", healthHandler.HealthCheck)
		api.POST("/observations", observationHandler.Create)
	}

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting server on %s", addr)
	log.Printf("Allowed origins: %v", cfg.AllowedOrigins)

	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
