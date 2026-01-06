# Inbox & Mail Retrieval API

## Overview
Endpoints for listing emails, retrieving full/raw emails, and downloading attachments.

---

## Endpoints

### GET `/api/v1/inbox/:address`
List mail summaries for an inbox.
- **Auth:** Optional
- **Response:**
  - Array of mail summary objects

### GET `/api/v1/inbox/:address/:uid`
Get full email by UID.
- **Auth:** Optional
- **Response:**
  - `uid`, `to`, `from`, `date`, `subject`, `text`, `html`, `attachments`
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`

### GET `/api/v1/inbox/:address/:uid/raw`
Get raw email source.
- **Auth:** Optional
- **Response:**
  - Raw email string
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`

### GET `/api/v1/inbox/:address/:uid/attachment/:checksum`
Download attachment by checksum.
- **Auth:** Optional
- **Response:**
  - Attachment file
- **Errors:**
  - `VALIDATION_ERROR`, `NOT_FOUND`

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

---

## Example Response
```
{
  "success": true,
  "data": {
    "uid": 123,
    "to": "user@example.com",
    "from": "sender@example.com",
    "date": "2026-01-05T12:00:00Z",
    "subject": "Hello",
    "text": "Plain text body",
    "html": "<p>Hello</p>",
    "attachments": [
      {
        "filename": "file.txt",
        "contentType": "text/plain",
        "size": 1024,
        "checksum": "abc123"
      }
    ]
  }
}
```
