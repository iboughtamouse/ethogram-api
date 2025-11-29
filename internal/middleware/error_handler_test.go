package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestErrorHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("catches panic and returns error response", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/panic", func(c *gin.Context) {
			panic("something went wrong")
		})

		req := httptest.NewRequest("GET", "/panic", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
		assert.Contains(t, w.Body.String(), "INTERNAL_ERROR")
		assert.Contains(t, w.Body.String(), "An unexpected error occurred")
		assert.Contains(t, w.Body.String(), `"success":false`)
	})

	t.Run("handles errors from context", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/error", func(c *gin.Context) {
			c.Error(errors.New("validation failed"))
			c.AbortWithStatus(http.StatusBadRequest)
		})

		req := httptest.NewRequest("GET", "/error", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "REQUEST_ERROR")
		assert.Contains(t, w.Body.String(), "validation failed")
		assert.Contains(t, w.Body.String(), `"success":false`)
	})

	t.Run("passes through successful requests", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/success", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"data":    "test",
			})
		})

		req := httptest.NewRequest("GET", "/success", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"success":true`)
		assert.Contains(t, w.Body.String(), `"data":"test"`)
	})

	t.Run("handles multiple errors", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/multi-error", func(c *gin.Context) {
			c.Error(errors.New("first error"))
			c.Error(errors.New("second error"))
			c.AbortWithStatus(http.StatusBadRequest)
		})

		req := httptest.NewRequest("GET", "/multi-error", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		// Should use the last error
		assert.Contains(t, w.Body.String(), "second error")
	})

	t.Run("defaults to 500 when no status set", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/no-status", func(c *gin.Context) {
			c.Error(errors.New("error without status"))
			// Note: Not calling AbortWithStatus
		})

		req := httptest.NewRequest("GET", "/no-status", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
		assert.Contains(t, w.Body.String(), "error without status")
	})

	t.Run("does not override already written response", func(t *testing.T) {
		router := gin.New()
		router.Use(ErrorHandler())
		router.GET("/written", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"custom": "response"})
			c.Error(errors.New("this should be ignored"))
		})

		req := httptest.NewRequest("GET", "/written", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"custom":"response"`)
		assert.NotContains(t, w.Body.String(), "REQUEST_ERROR")
	})
}
