# Authentication API

## Overview
User registration, login, logout, and session management.

---

## Endpoints

### POST `/api/v1/auth/register`
Register a new user.
- **Body:**
  - `username`: string (3-20 chars, alphanumeric/underscore)
  - `password`: string (min 8 chars)
- **Response:**
  - `userId`, `username`, `message`
- **Errors:**
  - `VALIDATION_ERROR`, `REGISTRATION_FAILED`, `AUTH_DISABLED`

### POST `/api/v1/auth/login`
Login user.
- **Body:**
  - `username`, `password`
- **Response:**
  - `userId`, `username`, `message`
- **Errors:**
  - `VALIDATION_ERROR`, `AUTH_DISABLED`

### POST `/api/v1/auth/logout`
Logout user.
- **Response:**
  - Success or error

### GET `/api/v1/auth/session`
Get current session info.
- **Response:**
  - `userId`, `username`, `isAuthenticated`, `createdAt`

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
- `AUTH_DISABLED`: Authentication is disabled
- `VALIDATION_ERROR`: Invalid input
- `REGISTRATION_FAILED`: Registration failed

---

## Example Response
```
{
  "success": true,
  "data": {
    "userId": "abc123",
    "username": "user1",
    "message": "Registration successful"
  }
}
```
