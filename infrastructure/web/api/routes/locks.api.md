# Inbox Lock Management API

## Overview
APIs for managing locked inboxes for users. All responses include a `templateContext` for UI integration.

---

## Endpoints

### GET `/api/v1/locks/`
List all inboxes locked by the authenticated user.
- **Auth:** Required
- **Response:**
  - `success`: true
  - `data`: array of locked inboxes
  - `templateContext`: `{ userId, config: { maxLockedInboxes } }`

### POST `/api/v1/locks/`
Lock an inbox for the authenticated user.
- **Auth:** Required
- **Body:**
  - `address`: string (email, required)
  - `password`: string (optional)
- **Response:**
  - `success`: true
  - `data`: `{ message, address }`
  - `templateContext`: `{ userId, address }`
- **Errors:**
  - Validation error: `VALIDATION_ERROR`
  - Max locks reached: `MAX_LOCKS_REACHED`
  - Already locked: `ALREADY_LOCKED`
  - Locked by other: `LOCKED_BY_OTHER`
  - All errors include `templateContext`

### DELETE `/api/v1/locks/:address`
Unlock/release a locked inbox.
- **Auth:** Required
- **Response:**
  - `success`: true
  - `data`: `{ message }`
  - `templateContext`: `{ userId, address }`
- **Errors:**
  - Not found/unauthorized: `NOT_FOUND` (includes `templateContext`)

### GET `/api/v1/locks/:address/status`
Check if an inbox is locked and if owned by the user.
- **Auth:** Optional
- **Response:**
  - `success`: true
  - `data`: `{ address, locked, ownedByYou? }`
  - `templateContext`: `{ address, isLocked, ownedByYou? }`

---

## Response Format
All responses include a `templateContext` field for UI rendering context.

```
{
  success: true|false,
  data: ...,
  error?: ...,
  code?: ...,
  templateContext: {...}
}
```

## Error Codes
- `FEATURE_DISABLED`: Inbox locking is disabled
- `VALIDATION_ERROR`: Invalid email address
- `MAX_LOCKS_REACHED`: Maximum locked inboxes reached
- `ALREADY_LOCKED`: User already owns the lock
- `LOCKED_BY_OTHER`: Inbox locked by another user
- `NOT_FOUND`: Lock not found or unauthorized

---

## Example Response
```
{
  "success": true,
  "data": ["user1@example.com", "user2@example.com"],
  "count": 2,
  "total": 2,
  "templateContext": {
    "userId": "abc123",
    "config": { "maxLockedInboxes": 3 }
  }
}
```
