package utils

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestSuccessResponse_BasicData(t *testing.T) {
	tests := []struct {
		name string
		data interface{}
	}{
		{
			name: "string data",
			data: "success message",
		},
		{
			name: "map data",
			data: gin.H{
				"id":   "123",
				"name": "test",
			},
		},
		{
			name: "slice data",
			data: []string{"item1", "item2", "item3"},
		},
		{
			name: "nil data",
			data: nil,
		},
		{
			name: "struct data",
			data: struct {
				ID   string
				Name string
			}{
				ID:   "abc",
				Name: "test",
			},
		},
		{
			name: "integer data",
			data: 42,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := SuccessResponse(tt.data)

			assert.NotNil(t, response)
			assert.Equal(t, true, response["success"])
			assert.Equal(t, tt.data, response["data"])

			// Verify only expected keys (no message)
			assert.Len(t, response, 2)
			assert.Contains(t, response, "success")
			assert.Contains(t, response, "data")
		})
	}
}

func TestSuccessResponse_WithMessage(t *testing.T) {
	data := gin.H{"id": "123"}
	message := "Operation completed successfully"

	response := SuccessResponse(data, message)

	assert.NotNil(t, response)
	assert.Equal(t, true, response["success"])
	assert.Equal(t, data, response["data"])
	assert.Equal(t, message, response["message"])

	// Should have 3 keys now
	assert.Len(t, response, 3)
}

func TestSuccessResponse_WithEmptyMessage(t *testing.T) {
	data := gin.H{"id": "123"}
	message := "" // Empty message should not be included

	response := SuccessResponse(data, message)

	assert.NotNil(t, response)
	assert.Equal(t, true, response["success"])
	assert.Equal(t, data, response["data"])

	// Should only have 2 keys (message not included when empty)
	assert.Len(t, response, 2)
	_, hasMessage := response["message"]
	assert.False(t, hasMessage)
}

func TestSuccessResponse_MultipleMessages_UsesFirst(t *testing.T) {
	data := gin.H{"id": "123"}
	response := SuccessResponse(data, "first message", "second message", "third message")

	assert.Equal(t, "first message", response["message"])
}

func TestErrorResponse_BasicError(t *testing.T) {
	tests := []struct {
		name            string
		code            string
		message         string
		expectedCode    string
		expectedMessage string
	}{
		{
			name:            "validation error",
			code:            "VALIDATION_ERROR",
			message:         "Invalid input provided",
			expectedCode:    "VALIDATION_ERROR",
			expectedMessage: "Invalid input provided",
		},
		{
			name:            "database error",
			code:            "DATABASE_ERROR",
			message:         "Connection failed",
			expectedCode:    "DATABASE_ERROR",
			expectedMessage: "Connection failed",
		},
		{
			name:            "not found error",
			code:            "NOT_FOUND",
			message:         "Resource not found",
			expectedCode:    "NOT_FOUND",
			expectedMessage: "Resource not found",
		},
		{
			name:            "empty message",
			code:            "ERROR",
			message:         "",
			expectedCode:    "ERROR",
			expectedMessage: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := ErrorResponse(tt.code, tt.message)

			assert.NotNil(t, response)
			assert.Equal(t, false, response["success"])

			// Access error object (it's gin.H, not map[string]interface{})
			errorObj, ok := response["error"].(gin.H)
			assert.True(t, ok, "error should be gin.H")
			assert.Equal(t, tt.expectedCode, errorObj["code"])
			assert.Equal(t, tt.expectedMessage, errorObj["message"])

			// Should only have 2 keys in error object (no details)
			assert.Len(t, errorObj, 2)
		})
	}
}

func TestErrorResponse_WithDetails(t *testing.T) {
	code := "VALIDATION_ERROR"
	message := "Validation failed"
	details := []string{
		"Field 'name' is required",
		"Field 'email' must be a valid email",
		"Field 'age' must be greater than 0",
	}

	response := ErrorResponse(code, message, details)

	assert.NotNil(t, response)
	assert.Equal(t, false, response["success"])

	errorObj, ok := response["error"].(gin.H)
	assert.True(t, ok)
	assert.Equal(t, code, errorObj["code"])
	assert.Equal(t, message, errorObj["message"])

	// Verify details
	detailsValue, hasDetails := errorObj["details"]
	assert.True(t, hasDetails)
	assert.Equal(t, details, detailsValue)

	// Should have 3 keys in error object
	assert.Len(t, errorObj, 3)
}

func TestErrorResponse_WithMapDetails(t *testing.T) {
	code := "VALIDATION_ERROR"
	message := "Validation failed"
	details := gin.H{
		"field":   "email",
		"problem": "invalid format",
	}

	response := ErrorResponse(code, message, details)

	errorObj := response["error"].(gin.H)
	assert.Equal(t, details, errorObj["details"])
}

func TestErrorResponse_WithNilDetails(t *testing.T) {
	code := "ERROR"
	message := "Something went wrong"

	response := ErrorResponse(code, message, nil)

	errorObj := response["error"].(gin.H)

	// Nil details should not be included
	_, hasDetails := errorObj["details"]
	assert.False(t, hasDetails)
	assert.Len(t, errorObj, 2)
}

func TestErrorResponse_MultipleDetails_UsesFirst(t *testing.T) {
	code := "ERROR"
	message := "Error"
	firstDetails := []string{"error1", "error2"}
	secondDetails := []string{"ignored1", "ignored2"}

	response := ErrorResponse(code, message, firstDetails, secondDetails)

	errorObj := response["error"].(gin.H)
	assert.Equal(t, firstDetails, errorObj["details"])
}

func TestSuccessResponse_Structure(t *testing.T) {
	data := gin.H{"key": "value"}
	response := SuccessResponse(data)

	// Verify response structure
	assert.IsType(t, gin.H{}, response)
	assert.Len(t, response, 2)
	assert.Contains(t, response, "success")
	assert.Contains(t, response, "data")
}

func TestErrorResponse_Structure(t *testing.T) {
	response := ErrorResponse("TEST_ERROR", "test message")

	// Verify response structure
	assert.IsType(t, gin.H{}, response)
	assert.Len(t, response, 2)
	assert.Contains(t, response, "success")
	assert.Contains(t, response, "error")

	// Verify error object structure
	errorObj := response["error"].(gin.H)
	assert.IsType(t, gin.H{}, errorObj)
	assert.Len(t, errorObj, 2)
	assert.Contains(t, errorObj, "code")
	assert.Contains(t, errorObj, "message")
}

func TestSuccessResponse_BooleanValue(t *testing.T) {
	// Test with boolean success value
	response := SuccessResponse(true)
	assert.Equal(t, true, response["success"])
	assert.Equal(t, true, response["data"])
}

func TestErrorResponse_LongMessage(t *testing.T) {
	code := "DATABASE_ERROR"
	longMessage := "A very long error message that describes in detail what went wrong with the database connection including timeout information and retry attempts that were made before finally giving up"

	response := ErrorResponse(code, longMessage)

	errorObj := response["error"].(gin.H)
	assert.Equal(t, longMessage, errorObj["message"])
}

func TestSuccessResponse_ComplexNestedData(t *testing.T) {
	complexData := gin.H{
		"user": gin.H{
			"id":   123,
			"name": "Alice",
			"metadata": gin.H{
				"lastLogin": "2025-11-29",
				"role":      "admin",
			},
		},
		"items": []gin.H{
			{"id": 1, "name": "Item 1"},
			{"id": 2, "name": "Item 2"},
		},
	}

	response := SuccessResponse(complexData)

	assert.Equal(t, complexData, response["data"])
}

func TestErrorResponse_ArrayDetails(t *testing.T) {
	code := "MULTIPLE_ERRORS"
	message := "Multiple validation errors occurred"
	details := []gin.H{
		{"field": "email", "error": "invalid format"},
		{"field": "password", "error": "too short"},
		{"field": "username", "error": "already taken"},
	}

	response := ErrorResponse(code, message, details)

	errorObj := response["error"].(gin.H)
	detailsValue := errorObj["details"].([]gin.H)

	assert.Len(t, detailsValue, 3)
	assert.Equal(t, "email", detailsValue[0]["field"])
	assert.Equal(t, "password", detailsValue[1]["field"])
	assert.Equal(t, "username", detailsValue[2]["field"])
}
