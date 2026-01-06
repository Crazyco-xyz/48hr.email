# Mail Operations API

## Overview
Endpoints for deleting emails and forwarding mail.

---

## Endpoints

### DELETE `/api/v1/mail/inbox/:address/:uid`
Delete a single email by UID.
- **Auth:** Optional
- **Response:**
  - Success message
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`

### DELETE `/api/v1/mail/inbox/:address`
Delete all emails in an inbox (requires `?confirm=true`).
- **Auth:** Optional
- **Response:**
  - Success message, deleted count
- **Errors:**
  - `CONFIRMATION_REQUIRED`, `NOT_FOUND`

### POST `/api/v1/mail/forward`
Forward a single email.
- **Auth:** Required
- **Body:**
  - `address`, `uid`, `to`
- **Response:**
  - Success message
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`, `FORWARD_FAILED`

### POST `/api/v1/mail/forward-all`
Forward all emails in an inbox.
- **Auth:** Required
- **Body:**
  - `address`, `to`
- **Response:**
  - Success message
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`, `FORWARD_FAILED`

---

## Response Format
```
{
  success: true|false,
  data: ...,
  error?: ...,
  code?: ...
}
```

## Error Codes
- `VALIDATION_ERROR`: Invalid input
- `NOT_FOUND`: Resource not found
- `CONFIRMATION_REQUIRED`: Confirmation required for bulk delete
- `FORWARD_FAILED`: Forwarding failed

---

## Example Response
```
{
  "success": true,
  "data": {
    "message": "Email deleted successfully"
  }
}
```
