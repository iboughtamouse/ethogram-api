package utils

import "github.com/gin-gonic/gin"

// SuccessResponse returns a standard success response
func SuccessResponse(data interface{}, message ...string) gin.H {
	response := gin.H{
		"success": true,
		"data":    data,
	}

	if len(message) > 0 && message[0] != "" {
		response["message"] = message[0]
	}

	return response
}

// ErrorResponse returns a standard error response
func ErrorResponse(code string, message string, details ...interface{}) gin.H {
	errorObj := gin.H{
		"code":    code,
		"message": message,
	}

	if len(details) > 0 && details[0] != nil {
		errorObj["details"] = details[0]
	}

	return gin.H{
		"success": false,
		"error":   errorObj,
	}
}
