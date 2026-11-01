# Security and privacy

## Authentication

- Passwords use Argon2id. Hashes never leave the data layer.
- Access tokens are EdDSA JWTs, expire after 15 minutes by default, and have a fixed algorithm allowlist. Claims are limited to `sub`, `sid`, `iss`, `aud`, `iat` and `exp`.
- Refresh tokens hold 256 bits of randomness and are stored as SHA-256 hashes. Rotation is one transaction with a conditional update, so only one concurrent caller can win.
- A rotated token presented after `REFRESH_REUSE_LEEWAY_SECONDS` revokes its whole session. Within that window it returns `409` without revoking, so ordinary client races do not log users out. A token stolen and replayed inside the window is rejected but does not trigger revocation.
- Every authenticated request checks the session and account state, so logout and deactivation apply immediately.
- Failed logins share one message and equalised timing. Verification requests respond identically for unknown numbers.

## Telegram

- Webhook requests must carry the secret token, compared in constant time.
- A Telegram sender is anonymous until explicitly linked, and passwords and tokens never enter chat.
- Linking uses a single-use token, stored hashed and placed in the URL fragment so it stays out of logs. It requires the account password and passing verification checks.
- `/register` creates a Telegram-only account from first name, last name, gender and native language. It has no mobile or password, so it cannot use the REST login, and its identity is the Telegram user id from the verified webhook. Anyone with Telegram can create one, so quotas are the only limit on use.
- Only private chats are processed.

## Prompt injection

Source text is XML-escaped inside `<source_text>`, and the system prompt states it is data only. Claude has no tools, so injected text cannot trigger actions. Output must pass a schema. The realistic remaining risk is a mistranslation, not a system compromise.

## API protections

- Strict schemas reject unknown fields, which also blocks self-assigned roles.
- Requests are limited per IP and per account, with separate limits for login and verification.
- Body size is capped. Security headers and an origin allowlist for CORS are applied.
- Bearer tokens are used rather than cookies, so CSRF does not apply to the API.
- Prisma parameterises all queries, apart from one fixed health-check statement. Outbound calls go only to fixed provider hosts.
- `/api/v1/metrics` returns 404 without its bearer token.

## Secrets

Secrets come only from the environment or a secrets manager. `.env*` is ignored by Git, apart from the placeholder example. The application fails at startup if required production settings are missing, and it refuses console SMS delivery in production. Logs redact tokens, passwords and text fields.

## Privacy

Before launch, publish a notice covering the following:

- **Provider processing:** translation text is sent to Google and/or Anthropic, under their data terms. `auto` mode can use both in one request.
- **Cache:** plain results are stored in Redis for `TRANSLATION_CACHE_TTL` and shared between users with identical input. Requests with context, audience or a glossary are cached per user. `TRANSLATION_CACHE_ENABLED=false` turns caching off.
- **History:** kept for `HISTORY_RETENTION_DAYS`, then removed hourly by the worker. Users can turn it off or delete it. `HISTORY_ENABLED=false` turns it off globally.
- **Jobs:** job input and results stay in `translation_jobs` until the same retention period ends, even if history is off.
- **Sensitive mode:** `sensitive: true` skips cache and history, but the text still goes to the provider.
- **Account deletion:** removes the user, sessions, history and preferences. Audit and usage rows remain without the user link. Backups keep data until they expire.

## Reporting

Rotate any exposed credential immediately. For a suspected token compromise, use `POST /auth/logout-all` for the user, or deactivate the account. Rotating the JWT key without retiring the old one invalidates all access tokens.
