# API examples

All paths are under `/api/v1`. Responses use one envelope:

```json
{ "success": true, "data": {}, "error": null, "meta": { "requestId": "..." } }
```

## Register, verify and log in

```bash
curl -X POST $API/auth/register -H 'Content-Type: application/json' -d '{
  "firstName": "Ahmed", "lastName": "Ali", "gender": "male",
  "nativeLanguage": "ar", "mobile": "+966501234567", "password": "StrongPassword123!"
}'
# 201: data.user and data.verification = { "status": "pending", "channel": "sms" }

curl -X POST $API/auth/verify-mobile/confirm -H 'Content-Type: application/json' \
  -d '{ "mobile": "+966501234567", "code": "123456" }'

curl -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{ "mobile": "+966501234567", "password": "StrongPassword123!", "deviceName": "Pixel 9" }'
# 200: data.accessToken, data.refreshToken, data.expiresIn, data.user
```

## Refresh

Store the new refresh token every time. The old one stops working immediately.

```bash
curl -X POST $API/auth/refresh -H 'Content-Type: application/json' -d '{ "refreshToken": "..." }'
```

| Response | Meaning |
|---|---|
| `200` | New token pair |
| `409 REFRESH_CONFLICT` | A concurrent refresh won; use the newest token |
| `401 TOKEN_REUSED` | An old token was replayed; the session is revoked, so log in again |

## Multilingual translation

```bash
curl -X POST $API/translations/multilingual -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "text": "Bonjour, comment allez-vous ?", "sourceLanguage": "auto" }'
```

The translations below are illustrative.

```json
{
  "success": true,
  "data": {
    "sourceLanguage": { "code": "fr", "name": "French" },
    "originalText": "Bonjour, comment allez-vous ?",
    "translations": {
      "dutch": { "languageCode": "nl", "languageName": "Dutch", "text": "Hallo, hoe gaat het met u?", "status": "completed", "provider": "google", "cached": false, "regionalized": false, "fallbackUsed": false },
      "english": { "languageCode": "en", "languageName": "English", "text": "Hello, how are you?", "status": "completed", "provider": "google", "cached": false, "regionalized": false, "fallbackUsed": false },
      "arabicSaudiArabia": { "languageCode": "ar-SA", "languageName": "Arabic (Saudi Arabia)", "text": null, "status": "failed", "error": { "code": "PROVIDER_TIMEOUT" } }
    },
    "metadata": { "provider": "google", "cached": false, "status": "partial", "processingDurationMs": 812 }
  },
  "error": null,
  "meta": { "requestId": "..." }
}
```

`metadata.provider` is `mixed` when targets used different providers, and a target's `provider` is `none` when the source was already in that language and the text was returned unchanged.

## Roman Urdu

When the user's native language is Urdu (`ur`) and the source is `auto` or `ur`, text in Latin letters goes to Claude first. Roman Urdu is rewritten in Urdu script and then translated with `sourceLanguage` `ur`; `originalText` keeps what the user wrote. Other text is translated as written, and so is everything if that step fails.

## Pronunciation

Add `"includePronunciation": true` to a multilingual request. Each completed target gains `pronunciation`, in simple Latin letters, or `null` if it could not be produced. The translated text is sent to Claude even when `provider` is `google`.

## Single translation

```bash
curl -X POST $API/translations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "text": "Hello, how are you?", "targetLanguage": "ar", "provider": "claude",
  "style": "formal", "context": "Customer email", "glossary": { "invoice": "فاتورة" }
}'
```

Set `"sensitive": true` to skip both cache and history.

## Background jobs

```bash
curl -X POST $API/translations/jobs -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: order-42' -H 'Content-Type: application/json' -d '{ "text": "..." }'
# 202: data.jobId
curl $API/translations/jobs/$JOB_ID -H "Authorization: Bearer $TOKEN"
curl -X POST $API/translations/jobs/$JOB_ID/cancel -H "Authorization: Bearer $TOKEN"
```

Omit `targetLanguage` for the multilingual set.

## History

```bash
curl "$API/translations/history?page=1&pageSize=20" -H "Authorization: Bearer $TOKEN"
curl -X DELETE $API/translations/history/$ID -H "Authorization: Bearer $TOKEN"
curl -X DELETE $API/translations/history -H "Authorization: Bearer $TOKEN"
```

## Errors

```json
{
  "success": false, "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "The request contains invalid data.", "fields": [{ "field": "mobile", "message": "..." }] },
  "meta": { "requestId": "..." }
}
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_INVALID`, `TOKEN_REUSED` |
| 403 | `FORBIDDEN`, `MOBILE_NOT_VERIFIED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `MOBILE_ALREADY_REGISTERED`, `REFRESH_CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `UNSUPPORTED_LANGUAGE_PAIR` |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED` (with `Retry-After`) |
| 500 | `INTERNAL_ERROR` |
| 502 | `PROVIDER_ERROR`, `PROVIDER_REFUSED` |
| 503 | `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `OVERLOADED`, `SERVICE_DISABLED` |
