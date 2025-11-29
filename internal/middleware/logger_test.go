package middleware

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestLogger(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("logs successful request", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/test", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "success"})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		// Check that log contains key information
		assert.Contains(t, logOutput, "GET")
		assert.Contains(t, logOutput, "/test")
		assert.Contains(t, logOutput, "200")
	})

	t.Run("logs request with query parameters", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/search", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"results": []string{}})
		})

		req := httptest.NewRequest("GET", "/search?q=test&limit=10", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		// Check that query params are logged
		assert.Contains(t, logOutput, "/search?q=test&limit=10")
		assert.Contains(t, logOutput, "200")
	})

	t.Run("logs error status codes", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/error", func(c *gin.Context) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		})

		req := httptest.NewRequest("GET", "/error", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		assert.Contains(t, logOutput, "GET")
		assert.Contains(t, logOutput, "/error")
		assert.Contains(t, logOutput, "400")
	})

	t.Run("logs client IP", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/test", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "success"})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "192.168.1.1:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		assert.Contains(t, logOutput, "192.168.1.1")
	})

	t.Run("logs errors from context", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/with-error", func(c *gin.Context) {
			c.Error(assert.AnError)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server error"})
		})

		req := httptest.NewRequest("GET", "/with-error", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		// Should log both the request and the error
		assert.Contains(t, logOutput, "GET")
		assert.Contains(t, logOutput, "/with-error")
		assert.Contains(t, logOutput, "500")
		assert.Contains(t, logOutput, "ERROR:")
	})

	t.Run("includes latency in log", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.GET("/test", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "success"})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		// Log should contain time units (µs, ms, s, etc.)
		assert.Regexp(t, `\d+(\.\d+)?(µs|ms|s)`, logOutput)
	})

	t.Run("logs POST requests", func(t *testing.T) {
		// Capture log output
		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)

		router := gin.New()
		router.Use(Logger())
		router.POST("/create", func(c *gin.Context) {
			c.JSON(http.StatusCreated, gin.H{"id": "123"})
		})

		req := httptest.NewRequest("POST", "/create", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		logOutput := buf.String()

		assert.Contains(t, logOutput, "POST")
		assert.Contains(t, logOutput, "/create")
		assert.Contains(t, logOutput, "201")
	})
}
