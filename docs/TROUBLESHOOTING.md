# Troubleshooting

Every response carries `meta.requestId`. Search the JSON logs for it first.

| Symptom | Likely cause | Fix |
|---|---|---|
| Exits with `Invalid environment configuration` | A required variable is missing | The message names each field. In production, `REDIS_URL` and a real SMS provider are required. |
| `character ... has no equivalent in encoding` | The database is not UTF8 | Recreate it with `ENCODING 'UTF8'`. |
| `503 SERVICE_DISABLED` on translation | No provider credentials | Set `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_CLOUD_PROJECT_ID` with credentials. |
| `403 MOBILE_NOT_VERIFIED` | Mobile not verified | Call `/auth/verify-mobile/request`, then `/confirm`. In development the code appears in the logs. |
| All users hit `429` together | `TRUST_PROXY` is off behind a proxy | Set `TRUST_PROXY=true` and make the proxy overwrite `X-Forwarded-For`. |
| `503 OVERLOADED` | Concurrency, rate or queue limit reached | Check provider quotas, then raise `*_CONCURRENCY`, `*_RATE_PER_MINUTE` or `PROVIDER_QUEUE_LIMIT`, or add workers. |
| `503 PROVIDER_UNAVAILABLE` for 30 s | Circuit open | Search logs for `provider_circuit_open`, then check the provider's status. |
| `502 PROVIDER_ERROR` | Bad credentials or a rejected request | Check the key, project and model. These are not retried. |
| `502 PROVIDER_REFUSED` | The model declined the content | Try another provider or rephrase. |
| Every API call returns `503 OVERLOADED` | Redis is down; rate limits fail closed | Restore Redis. `/health/ready` also returns 503. |
| Bot silent | Worker down, or webhook not set | Check the worker logs, and call Telegram's `getWebhookInfo` for `last_error_message`. |
| Webhook returns 401 | Secret mismatch | Run `telegram:set-webhook` again with the current secret. |
| Update never answered | Update failed after retries | `telegram_updates.status = 'FAILED'`, and the worker log holds the reason. A failed update is not reprocessed. |
| Job stuck in `queued` | Worker not running, or Redis was lost | Start the worker. After Redis loss, resubmit the job. |
| Prisma `P1001` or pool timeouts | Database unreachable or pool too small | Check `DATABASE_URL`, `connection_limit` and `max_connections`. |
| `prisma generate` or Argon2 errors after install | Install scripts blocked | Run `npm install-scripts ls` and approve what is needed. |
