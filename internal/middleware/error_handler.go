package middleware

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ErrorHandler is a middleware that catches panics and returns standardized error responses
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				// Log the panic
				log.Printf("PANIC: %v", err)

				// Return standardized error response
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false,
					"error": gin.H{
						"code":    "INTERNAL_ERROR",
						"message": "An unexpected error occurred. Please try again later.",
					},
				})

				c.Abort()
			}
		}()

		c.Next()

		// Handle errors set during request processing
		if len(c.Errors) > 0 {
			err := c.Errors.Last()

			// Determine status code from context or default to 500
			statusCode := c.Writer.Status()
			if statusCode == http.StatusOK {
				statusCode = http.StatusInternalServerError
			}

			// Log the error
			log.Printf("ERROR: %v (status: %d)", err, statusCode)

			// If response hasn't been written yet, write error response
			if !c.Writer.Written() {
				c.JSON(statusCode, gin.H{
					"success": false,
					"error": gin.H{
						"code":    "REQUEST_ERROR",
						"message": err.Error(),
					},
				})
			}
		}
	}
}
