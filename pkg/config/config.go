package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port    string
	GinMode string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// Email
	ResendAPIKey string
	EmailFrom    string

	// CORS
	AllowedOrigins []string

	// Rate Limiting
	RateLimitRequests int
	RateLimitWindow   int
}

func Load() (*Config, error) {
	// Load .env file (ignore error if file doesn't exist)
	_ = godotenv.Load()

	cfg := &Config{
		Port:          getEnv("PORT", "8080"),
		GinMode:       getEnv("GIN_MODE", "debug"),
		DatabaseURL:   getEnv("DATABASE_URL", ""),
		RedisURL:      getEnv("REDIS_URL", "redis://localhost:6379"),
		ResendAPIKey:  getEnv("RESEND_API_KEY", ""),
		EmailFrom:     getEnv("EMAIL_FROM", ""),
		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:5173"), ","),
		RateLimitRequests: getEnvInt("RATE_LIMIT_REQUESTS", 10),
		RateLimitWindow:   getEnvInt("RATE_LIMIT_WINDOW", 3600),
	}

	// Validate required fields
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
