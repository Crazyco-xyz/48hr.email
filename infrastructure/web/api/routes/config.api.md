# Configuration API

## Overview
Public endpoints for configuration, domains, limits, and features.

---

## Endpoints

### GET `/api/v1/config/domains`
Get allowed email domains.
- **Response:**
  - `domains`: array of strings

### GET `/api/v1/config/limits`
Get rate limits and constraints.
- **Response:**
  - `api.rateLimit`, `email.purgeTime`, `email.purgeUnit`, `email.maxForwardedPerRequest`, `user.maxVerifiedEmails`, `user.maxLockedInboxes`, `user.lockReleaseHours`

### GET `/api/v1/config/features`
Get enabled features.
- **Response:**
  - `authentication`, `forwarding`, `statistics`

---

## Response Format
```
{
  success: true|false,
  data: ...
}
```

---

## Example Response
```
{
  "success": true,
  "data": {
    "domains": ["example.com", "demo.com"]
  }
}
```
