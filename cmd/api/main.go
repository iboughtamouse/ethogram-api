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

	// Create router (without default middleware, we'll add our own)
	router := gin.New()

	// Initialize rate limiter
	rateLimiter, err := middleware.NewRateLimiter(cfg.RedisURL, cfg.RateLimitRequests, cfg.RateLimitWindow)
	if err != nil {
		log.Fatalf("Failed to initialize rate limiter: %v", err)
	}
	defer rateLimiter.Close()
	log.Println("✓ Connected to Redis")

	// Apply middleware in order
	router.Use(middleware.Logger())        // Request/response logging
	router.Use(middleware.ErrorHandler())  // Panic recovery and error handling
	router.Use(middleware.CORS(cfg.AllowedOrigins)) // CORS headers
	router.Use(rateLimiter.Middleware())   // Rate limiting

	// Initialize repositories
	observationRepo := database.NewObservationRepository(db)

	// Initialize services
	excelService := services.NewExcelService()
	emailService := services.NewEmailService(cfg.ResendAPIKey, cfg.EmailFrom)
	observationService := services.NewObservationService(observationRepo, excelService, emailService)

	// Initialize handlers
	healthHandler := handlers.NewHealthHandler()
	observationHandler := handlers.NewObservationHandler(observationService)

	// Register routes
	api := router.Group("/api")
	{
		api.GET("/health", healthHandler.HealthCheck)
		api.POST("/observations", observationHandler.Create)
		api.GET("/observations", observationHandler.List)
		api.GET("/observations/:id", observationHandler.GetByID)
	}

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting server on %s", addr)
	log.Printf("Allowed origins: %v", cfg.AllowedOrigins)

	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
