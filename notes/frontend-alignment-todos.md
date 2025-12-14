# Frontend Alignment TODOs

**Created:** 2025-11-29
**Purpose:** Track changes needed on wbs-ethogram-form to align with API schema

---

## Context

The current frontend schema doesn't match the API schema. Rather than having the API transform data, the frontend should send data in the correct format. This reduces complexity and keeps the API focused on storage/retrieval.

---

## TODOs

### ~~1. Align API response format with spec (or update spec)~~ ✅ DONE

**Resolved:** Updated implementation to match spec. Error responses now use nested format:
```javascript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [...]
  }
}
```

Frontend `emailService.js` updated to handle the new format.

---

### 2. Send `time_slots` as array of objects, not flat object

**Current (frontend sends):**
```javascript
observations: {
  "14:00": {
    behavior: "resting_alert",
    location: "12",
    notes: "Alert, watching stream"
  },
  "14:05": {
    behavior: "flying",
    location: "",
    notes: ""
  }
}
```

**Should be:**
```javascript
time_slots: {
  "14:00": [
    {
      subjectType: "foster_parent",
      subjectId: "Sayyida",
      behavior: "resting_alert",
      location: "12",
      notes: "Alert, watching stream",
      object: "",
      objectOther: "",
      animal: "",
      animalOther: "",
      interactionType: "",
      interactionTypeOther: "",
      description: ""
    }
  ],
  "14:05": [
    {
      subjectType: "foster_parent",
      subjectId: "Sayyida",
      behavior: "flying",
      location: "",
      notes: "",
      // ... other fields
    }
  ]
}
```

**Why arrays?** Phase 4+ will support multiple subjects per time slot (foster parent + babies).

**Files to update:**
- `src/services/formSubmission.js` - Transform observations to array format before submission
- Or do it in the hook/component that calls the API

---

### 3. Rename `patient` to `subjectId` (or remove from metadata)

**Current (frontend sends):**
```javascript
metadata: {
  observerName: "TestObserver",
  date: "2025-11-29",
  startTime: "14:00",
  endTime: "14:30",
  aviary: "Sayyida's Cove",
  patient: "Sayyida",  // <-- This
  mode: "live"
}
```

**Options:**

**Option A: Remove `patient` from metadata entirely**
- The `subjectId` is already in each time slot observation
- Metadata becomes simpler: just session context (who observed, when, where)
- API doesn't need to store it redundantly

**Option B: Rename to `primarySubject` or similar**
- Keep it for display purposes, session labeling
- But not used for data storage - only `time_slots` has subject info

**Recommendation:** Option A - remove from metadata. The subject is captured in every time slot entry. The frontend can still display "Observing: Sayyida" by reading from the first time slot or from hardcoded config.

**Files to update:**
- `src/hooks/useFormState.js` - Remove `patient` from metadata shape
- `src/components/MetadataSection.jsx` - Remove patient input (or keep as display-only from config)
- Update validation in `useFormValidation.js` if needed

---

### 4. Consider: rename `aviary` to something more generic?

**Low priority.** Current name is fine for WBS context. Could become `location` or `enclosure` for reusability, but not urgent.

---

## Implementation Notes

### Transformation location

The frontend should transform data in `formSubmission.js` before sending to API. This keeps:
- Form state simple (flat observations, easy to edit)
- API payload correct (arrays with subject info)

### Backward compatibility

Since the API isn't in production yet, we can make breaking changes freely. Once deployed, we'd need versioning.

---

## Related

- API Schema: `docs/api-specification.md`
- Database Schema: `docs/database-schema.md`
- Frontend submission service: `wbs-ethogram-form/src/services/formSubmission.js`
