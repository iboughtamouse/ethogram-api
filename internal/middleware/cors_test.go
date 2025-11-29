package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	return router
}

func TestCORS_AllowedOrigin(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000", "http://localhost:5173"}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	tests := []struct {
		name           string
		origin         string
		expectedOrigin string
	}{
		{
			name:           "first allowed origin",
			origin:         "http://localhost:3000",
			expectedOrigin: "http://localhost:3000",
		},
		{
			name:           "second allowed origin",
			origin:         "http://localhost:5173",
			expectedOrigin: "http://localhost:5173",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			req.Header.Set("Origin", tt.origin)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			assert.Equal(t, 200, w.Code)
			assert.Equal(t, tt.expectedOrigin, w.Header().Get("Access-Control-Allow-Origin"))
			assert.Equal(t, "GET, POST, PUT, DELETE, OPTIONS", w.Header().Get("Access-Control-Allow-Methods"))
			assert.Equal(t, "Content-Type, Authorization, Idempotency-Key", w.Header().Get("Access-Control-Allow-Headers"))
			assert.Equal(t, "86400", w.Header().Get("Access-Control-Max-Age"))
		})
	}
}

func TestCORS_DisallowedOrigin(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://evil.com")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Request should still succeed (CORS is not authentication)
	assert.Equal(t, 200, w.Code)

	// But CORS headers should not be set
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Methods"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Headers"))
}

func TestCORS_NoOriginHeader(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	// No Origin header set (same-origin request or non-browser client)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Request succeeds
	assert.Equal(t, 200, w.Code)

	// No CORS headers set
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_PreflightRequest_AllowedOrigin(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.POST("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("OPTIONS", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Preflight requests should return 204 No Content
	assert.Equal(t, 204, w.Code)

	// CORS headers should be set
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "GET, POST, PUT, DELETE, OPTIONS", w.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "Content-Type, Authorization, Idempotency-Key", w.Header().Get("Access-Control-Allow-Headers"))
	assert.Equal(t, "86400", w.Header().Get("Access-Control-Max-Age"))
}

func TestCORS_PreflightRequest_DisallowedOrigin(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.POST("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("OPTIONS", "/test", nil)
	req.Header.Set("Origin", "http://evil.com")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Preflight still returns 204 (middleware doesn't block, browser does)
	assert.Equal(t, 204, w.Code)

	// But no CORS headers are set
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_MultipleAllowedOrigins(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{
		"http://localhost:3000",
		"http://localhost:5173",
		"https://production.example.com",
	}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	tests := []struct {
		name           string
		origin         string
		expectedOrigin string
		shouldHaveCORS bool
	}{
		{
			name:           "first allowed origin",
			origin:         "http://localhost:3000",
			expectedOrigin: "http://localhost:3000",
			shouldHaveCORS: true,
		},
		{
			name:           "second allowed origin",
			origin:         "http://localhost:5173",
			expectedOrigin: "http://localhost:5173",
			shouldHaveCORS: true,
		},
		{
			name:           "third allowed origin",
			origin:         "https://production.example.com",
			expectedOrigin: "https://production.example.com",
			shouldHaveCORS: true,
		},
		{
			name:           "disallowed origin",
			origin:         "https://evil.com",
			expectedOrigin: "",
			shouldHaveCORS: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			req.Header.Set("Origin", tt.origin)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			assert.Equal(t, 200, w.Code)

			if tt.shouldHaveCORS {
				assert.Equal(t, tt.expectedOrigin, w.Header().Get("Access-Control-Allow-Origin"))
				assert.NotEmpty(t, w.Header().Get("Access-Control-Allow-Methods"))
			} else {
				assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}

func TestCORS_EmptyAllowedOrigins(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Request succeeds
	assert.Equal(t, 200, w.Code)

	// No CORS headers (no origins allowed)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_CaseSensitivity(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	tests := []struct {
		name             string
		origin           string
		shouldHaveCORS   bool
		expectedOrigin   string
	}{
		{
			name:           "exact match",
			origin:         "http://localhost:3000",
			shouldHaveCORS: true,
			expectedOrigin: "http://localhost:3000",
		},
		{
			name:           "uppercase HTTP (no match - case sensitive)",
			origin:         "HTTP://localhost:3000",
			shouldHaveCORS: false,
			expectedOrigin: "",
		},
		{
			name:           "different port (no match)",
			origin:         "http://localhost:3001",
			shouldHaveCORS: false,
			expectedOrigin: "",
		},
		{
			name:           "https vs http (no match)",
			origin:         "https://localhost:3000",
			shouldHaveCORS: false,
			expectedOrigin: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			req.Header.Set("Origin", tt.origin)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			assert.Equal(t, 200, w.Code)

			if tt.shouldHaveCORS {
				assert.Equal(t, tt.expectedOrigin, w.Header().Get("Access-Control-Allow-Origin"))
			} else {
				assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}

func TestCORS_AllHeadersSet(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Verify all CORS headers are set
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "GET, POST, PUT, DELETE, OPTIONS", w.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "Content-Type, Authorization, Idempotency-Key", w.Header().Get("Access-Control-Allow-Headers"))
	assert.Equal(t, "86400", w.Header().Get("Access-Control-Max-Age"))
}

func TestCORS_NonPreflightMethodsPassThrough(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	handlerCalled := false
	router.POST("/test", func(c *gin.Context) {
		handlerCalled = true
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("POST", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Handler should be called (not aborted)
	assert.True(t, handlerCalled)
	assert.Equal(t, 200, w.Code)

	// CORS headers still set
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_PreflightDoesNotCallHandler(t *testing.T) {
	router := setupTestRouter()
	allowedOrigins := []string{"http://localhost:3000"}
	router.Use(CORS(allowedOrigins))

	handlerCalled := false
	router.POST("/test", func(c *gin.Context) {
		handlerCalled = true
		c.JSON(200, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest("OPTIONS", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Handler should NOT be called (aborted with 204)
	assert.False(t, handlerCalled)
	assert.Equal(t, 204, w.Code)
}
