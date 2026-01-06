# Statistics API

## Overview
Endpoints for retrieving statistics and historical data.

---

## Endpoints

### GET `/api/v1/stats/`
Get lightweight statistics (no historical analysis).
- **Response:**
  - `currentCount`, `allTimeTotal`, `purgeWindow` (object with `receives`, `deletes`, `forwards`, `timeline`)

### GET `/api/v1/stats/enhanced`
Get full statistics with historical data and predictions.
- **Response:**
  - `currentCount`, `allTimeTotal`, `purgeWindow`, `historical`, `prediction`, `enhanced`

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
- `FEATURE_DISABLED`: Statistics are disabled

---

## Example Response
```
{
  "success": true,
  "data": {
    "currentCount": 123,
    "allTimeTotal": 4567,
    "purgeWindow": {
      "receives": 10,
      "deletes": 2,
      "forwards": 1,
      "timeline": [ ... ]
    },
    "historical": [ ... ],
    "prediction": [ ... ],
    "enhanced": { ... }
  }
}
```
