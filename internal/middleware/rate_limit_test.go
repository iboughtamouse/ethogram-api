package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestRedis(t *testing.T) *redis.Client {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   1, // Use DB 1 for testing
	})

	ctx := context.Background()
	err := client.Ping(ctx).Err()
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}

	// Clear test database
	client.FlushDB(ctx)

	t.Cleanup(func() {
		client.FlushDB(ctx)
		client.Close()
	})

	return client
}

func TestNewRateLimiter(t *testing.T) {
	tests := []struct {
		name        string
		redisURL    string
		maxRequests int
		window      int
		wantErr     bool
	}{
		{
			name:        "valid configuration",
			redisURL:    "redis://localhost:6379/1",
			maxRequests: 10,
			window:      60,
			wantErr:     false,
		},
		{
			name:        "invalid redis URL",
			redisURL:    "invalid://url",
			maxRequests: 10,
			window:      60,
			wantErr:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.name == "valid configuration" {
				setupTestRedis(t)
			}

			rl, err := NewRateLimiter(tt.redisURL, tt.maxRequests, tt.window)

			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, rl)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, rl)
				if rl != nil {
					rl.Close()
				}
			}
		})
	}
}

func TestRateLimiter_Middleware(t *testing.T) {
	client := setupTestRedis(t)

	rl := &RateLimiter{
		client:       client,
		maxRequests:  3,
		windowPeriod: 10 * time.Second,
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(rl.Middleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "success"})
	})

	t.Run("allows requests under limit", func(t *testing.T) {
		// First request should succeed
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.1:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "3", w.Header().Get("X-RateLimit-Limit"))
		assert.Equal(t, "2", w.Header().Get("X-RateLimit-Remaining"))

		// Second request should succeed
		req = httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.1:1234"
		w = httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "1", w.Header().Get("X-RateLimit-Remaining"))
	})

	t.Run("blocks requests over limit", func(t *testing.T) {
		// Clear Redis for fresh test
		client.FlushDB(context.Background())

		// Make max requests
		for i := 0; i < 3; i++ {
			req := httptest.NewRequest("GET", "/test", nil)
			req.RemoteAddr = "192.168.1.2:1234"
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			assert.Equal(t, http.StatusOK, w.Code)
		}

		// Next request should be blocked
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.2:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusTooManyRequests, w.Code)
		assert.Contains(t, w.Body.String(), "RATE_LIMIT_EXCEEDED")
		assert.NotEmpty(t, w.Header().Get("Retry-After"))
	})

	t.Run("different IPs have separate limits", func(t *testing.T) {
		// Clear Redis for fresh test
		client.FlushDB(context.Background())

		// IP 1 - make max requests
		for i := 0; i < 3; i++ {
			req := httptest.NewRequest("GET", "/test", nil)
			req.RemoteAddr = "192.168.1.3:1234"
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)
		}

		// IP 2 - should still have full quota
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.4:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "2", w.Header().Get("X-RateLimit-Remaining"))
	})
}

func TestRateLimiter_RedisFailure(t *testing.T) {
	// Create rate limiter with invalid Redis client (will fail on operations)
	rl := &RateLimiter{
		client: redis.NewClient(&redis.Options{
			Addr: "localhost:9999", // Non-existent Redis
		}),
		maxRequests:  10,
		windowPeriod: 60 * time.Second,
	}
	defer rl.Close()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(rl.Middleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "success"})
	})

	t.Run("allows request when redis fails", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		// Should allow request even though Redis is down
		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestMax(t *testing.T) {
	tests := []struct {
		name string
		a    int
		b    int
		want int
	}{
		{"a greater", 5, 3, 5},
		{"b greater", 3, 5, 5},
		{"equal", 5, 5, 5},
		{"negative values", -3, -5, -3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := max(tt.a, tt.b)
			assert.Equal(t, tt.want, got)
		})
	}
}
