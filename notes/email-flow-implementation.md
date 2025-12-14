# Email Flow Implementation Plan

**Created:** 2025-11-29
**Status:** Planning

---

## Overview

Redesign the submission flow so every observation is stored and emailed to WBS, with optional user sharing.

---

## User Flow

1. User fills out form
2. Clicks "Submit Observation"
3. Frontend validates, calls `POST /api/observations` with WBS email (from env var)
4. Backend stores observation, generates Excel, emails to WBS
5. User sees success modal: "Observation submitted and sent to WBS!"
6. Modal offers option to send Excel to another email address
7. If user enters email and clicks "Send Copy":
   - Calls `POST /api/observations/:id/share`
   - Shows success/error feedback
8. User closes modal, form clears

**Fallback:** If API is down, frontend can still generate Excel locally for download.

---

## API Endpoints

### `POST /api/observations` (modify existing)

**Request:**
```json
{
  "observation": {
    "metadata": { ... },
    "observations": { ... },
    "submittedAt": "2025-11-29T..."
  },
  "emails": ["research@worldbirdsanctuary.org"]
}
```

**Response (201):**
```json
{
  "success": true,
  "submissionId": "uuid",
  "message": "Observation submitted successfully",
  "emailsSent": 1
}
```

**Changes needed:**
- Generate Excel from observation data
- Send email with Excel attachment
- Return actual emailsSent count (currently faked)

### `POST /api/observations/:id/share` (new)

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Excel sent to user@example.com"
}
```

**Response (429 - rate limited):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many share requests. Try again later."
  }
}
```

**Rate limit:** 3 shares per observation per hour

### `GET /api/observations/:id/excel` (new)

**Response:** Excel file download (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)

**Purpose:** Frontend fallback if email fails but user wants the file.

---

## Backend Implementation

### Phase 1: Excel Generation
- [ ] Add `exceljs` dependency
- [ ] Create `src/services/excel.ts` - generates Excel from observation data
- [ ] Match format of frontend's existing Excel export
- [ ] Add tests

### Phase 2: Email Sending
- [ ] Choose email provider (Resend recommended - simple API, good free tier)
- [ ] Add `RESEND_API_KEY` to config
- [ ] Create `src/services/email.ts` - sends email with attachment
- [ ] Add `EMAIL_FROM` config (e.g., "noreply@ethogram.app")
- [ ] Add tests (mock email service)

### Phase 3: Wire Up Endpoints
- [ ] Update `POST /api/observations` to generate Excel + send email
- [ ] Add `POST /api/observations/:id/share` endpoint
- [ ] Add `GET /api/observations/:id/excel` endpoint
- [ ] Add rate limiting for share endpoint

---

## Frontend Implementation

### Environment Variables
```bash
# .env.development
VITE_DEFAULT_RECIPIENT_EMAIL=iboughtamouse+ethogram@gmail.com

# .env.production
VITE_DEFAULT_RECIPIENT_EMAIL=research@worldbirdsanctuary.org
```

### Changes Needed
- [ ] Update `handleSubmit` to call API immediately (not on "Send Email" click)
- [ ] Pass `import.meta.env.VITE_DEFAULT_RECIPIENT_EMAIL` in emails array
- [ ] Redesign SubmissionModal:
  - Initial state: "Submitting..." (API call in progress)
  - Success state: "Sent to WBS! Want a copy?" + email input + "Send Copy" button
  - Error state: Show error + "Download Locally" fallback
- [ ] Add share API call when user requests copy
- [ ] Keep local Excel generation as fallback

---

## Dev vs Prod Config

| Setting | Development | Production |
|---------|-------------|------------|
| `VITE_DEFAULT_RECIPIENT_EMAIL` | iboughtamouse+ethogram@gmail.com | research@worldbirdsanctuary.org |
| `RESEND_API_KEY` | Test key (sandbox) | Production key |
| Email actually sent? | Yes (to test address) | Yes (to WBS) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Email service down | Frontend fallback generates Excel locally |
| Rate limit abuse | Server-side rate limiting on /share |
| Large Excel files | Observations are small; not a concern |
| Email bounces | Log failures; WBS email is known-good |

---

## Open Questions

1. **Email template:** Plain text or HTML? (Suggest: simple HTML with WBS branding)
2. **Excel format:** Match frontend exactly, or improve? (Suggest: match for now)
3. **Observation retrieval auth:** Should /share require the submitter to prove ownership? (Suggest: no for v1, UUID is unguessable)

---

## Order of Work

1. **Backend: Excel generation** (can test independently)
2. **Backend: Email service** (can test with console logging first)
3. **Backend: Wire up POST /observations** (now actually sends email)
4. **Frontend: Update flow** (call API on submit, redesign modal)
5. **Backend: Add /share and /excel endpoints**
6. **Frontend: Add share functionality**
7. **End-to-end testing**
