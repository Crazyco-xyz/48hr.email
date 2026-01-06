# Account Management API

## Overview
Manage user accounts, forwarding emails, locked inboxes, and API tokens.

---

## Endpoints

### GET `/api/account/`
Get account info and stats for the authenticated user.
- **Auth:** Required
- **Response:**
  - `userId`, `username`, `createdAt`, `lastLogin`, `verifiedEmails`, `lockedInboxes`, `apiToken`

### POST `/api/account/verify-email`
Add a forwarding email (triggers verification).
- **Auth:** Required
- **Body:**
  - `email`: string (required)
- **Response:**
  - Success or error

### DELETE `/api/account/verify-email/:id`
Remove a forwarding email by ID.
- **Auth:** Required
- **Response:**
  - Success or error

### POST `/api/account/change-password`
Change account password.
- **Auth:** Required
- **Body:**
  - `oldPassword`, `newPassword`
- **Response:**
  - Success or error

### DELETE `/api/account/`
Delete the user account.
- **Auth:** Required
- **Response:**
  - Success or error

### GET `/api/account/token`
Get API token info (not the token itself).
- **Auth:** Required
- **Response:**
  - `hasToken`, `createdAt`, `lastUsed`

### POST `/api/account/token`
Generate or regenerate API token.
- **Auth:** Required
- **Response:**
  - Success or error

### DELETE `/api/account/token`
Revoke API token.
- **Auth:** Required
- **Response:**
  - Success or error

---

## Response Format
All responses follow:
```
{
  success: true|false,
  data: ...,
  error?: ...,
  code?: ...
}
```

## Error Codes
- `AUTH_DISABLED`: Authentication is disabled
- `VALIDATION_ERROR`: Invalid input
- `REGISTRATION_FAILED`: Registration failed
- `NOT_FOUND`: Resource not found
- `FORBIDDEN`: Unauthorized

---

## Example Response
```
{
  "success": true,
  "data": {
    "userId": "abc123",
    "username": "user1",
    "createdAt": "2026-01-01T00:00:00Z",
    "lastLogin": "2026-01-05T12:00:00Z",
    "verifiedEmails": ["forward@example.com"],
    "lockedInboxes": ["inbox1@example.com"],
    "apiToken": {
      "hasToken": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "lastUsed": "2026-01-05T12:00:00Z"
    }
  }
}
```
