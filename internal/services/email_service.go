package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/iboughtamouse/ethogram-api/internal/models"
)

// EmailService handles email delivery via Resend API
type EmailService struct {
	apiKey    string
	fromEmail string
	client    *http.Client
}

// NewEmailService creates a new email service
func NewEmailService(apiKey, fromEmail string) *EmailService {
	return &EmailService{
		apiKey:    apiKey,
		fromEmail: fromEmail,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ResendEmailRequest represents the Resend API email request
type ResendEmailRequest struct {
	From        string                   `json:"from"`
	To          []string                 `json:"to"`
	Subject     string                   `json:"subject"`
	HTML        string                   `json:"html"`
	Attachments []ResendAttachment       `json:"attachments,omitempty"`
}

// ResendAttachment represents an email attachment
type ResendAttachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"` // Base64 encoded
}

// ResendResponse represents the Resend API response
type ResendResponse struct {
	ID    string `json:"id"`
	Error string `json:"message,omitempty"`
}

// SendObservationEmail sends an email with Excel attachment
// Implements retry logic: 3 attempts with exponential backoff
func (s *EmailService) SendObservationEmail(obs *models.Observation, excelData *bytes.Buffer) error {
	if len(obs.Emails) == 0 {
		return nil // No emails to send
	}

	// Generate email content
	subject := fmt.Sprintf("Your WBS Ethogram Observation - %s %s",
		obs.ObservationDate.Format("2006-01-02"),
		obs.StartTime,
	)

	htmlBody := s.generateEmailHTML(obs)

	// Prepare attachment (base64 encode)
	excelService := NewExcelService()
	filename := excelService.GenerateFilename(obs)

	// Base64 encode the Excel data
	encodedContent := base64Encode(excelData.Bytes())

	// Prepare request
	reqData := ResendEmailRequest{
		From:    s.fromEmail,
		To:      obs.Emails,
		Subject: subject,
		HTML:    htmlBody,
		Attachments: []ResendAttachment{
			{
				Filename: filename,
				Content:  encodedContent,
			},
		},
	}

	// Retry logic: 3 attempts with exponential backoff
	var lastErr error
	backoff := time.Second

	for attempt := 1; attempt <= 3; attempt++ {
		err := s.sendEmail(reqData)
		if err == nil {
			return nil // Success
		}

		lastErr = err

		// Don't retry on the last attempt
		if attempt < 3 {
			time.Sleep(backoff)
			backoff *= 2 // Exponential backoff: 1s, 2s, 4s
		}
	}

	return fmt.Errorf("email delivery failed after 3 attempts: %w", lastErr)
}

// sendEmail makes the actual API request to Resend
func (s *EmailService) sendEmail(reqData ResendEmailRequest) error {
	// Marshal request
	jsonData, err := json.Marshal(reqData)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create HTTP request
	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.apiKey))
	req.Header.Set("Content-Type", "application/json")

	// Send request
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var resendResp ResendResponse
		if err := json.Unmarshal(body, &resendResp); err == nil && resendResp.Error != "" {
			return fmt.Errorf("resend API error: %s", resendResp.Error)
		}
		return fmt.Errorf("resend API returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// generateEmailHTML creates the HTML email body
func (s *EmailService) generateEmailHTML(obs *models.Observation) string {
	patient := "Sayyida" // Phase 2 hardcoded
	modeDisplay := "Live"
	if obs.Mode == "vod" {
		modeDisplay = "VOD"
	}

	return fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4A90E2; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
        .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
        .detail-row { margin: 10px 0; }
        .detail-label { font-weight: bold; display: inline-block; width: 150px; }
        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Your WBS Ethogram Observation</h2>
        </div>
        <div class="content">
            <p>Hi %s,</p>

            <p>Thank you for submitting your behavioral observation of <strong>%s</strong> at <strong>%s</strong>!</p>

            <h3>Observation Details:</h3>
            <div class="detail-row">
                <span class="detail-label">Date:</span> %s
            </div>
            <div class="detail-row">
                <span class="detail-label">Time:</span> %s - %s
            </div>
            <div class="detail-row">
                <span class="detail-label">Mode:</span> %s
            </div>
            <div class="detail-row">
                <span class="detail-label">Submitted:</span> %s
            </div>

            <p>Your Excel file is attached. This file contains your observation data in the standard WBS ethogram format with metadata header rows and a behavioral matrix layout.</p>

            <div class="footer">
                <p>If you have any questions or notice any issues, please reply to this email.</p>
                <p>Thank you for contributing to our research!</p>
                <p><strong>World Bird Sanctuary Ethogram Team</strong></p>
            </div>
        </div>
    </div>
</body>
</html>
`, obs.ObserverName, patient, obs.Aviary,
		obs.ObservationDate.Format("2006-01-02"),
		obs.StartTime, obs.EndTime, modeDisplay,
		obs.SubmittedAt.Format("2006-01-02 15:04:05 MST"))
}

// base64Encode encodes bytes to base64 string
func base64Encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}
