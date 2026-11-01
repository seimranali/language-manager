# Load testing

The k6 scripts in `tests/load` have **not been run yet**, so the system has no measured capacity. Do not quote a supported user count until these tests have passed in a documented environment.

## Targets

| Scenario | Script | Target |
|---|---|---|
| Registration and login | `auth.js` | p95 under 1.5 s, under 1% errors |
| Translation at 50 requests/s | `translations.js` | p95 under 2 s, under 2% unexpected errors |
| Telegram webhook at 200 requests/s | `telegram.js` | p95 under 300 ms |

These targets are starting proposals. Adjust them to your traffic.

## Running

Use a staging stack with production-sized settings, and with limits raised so that they do not hide the system's behaviour. Point providers at stubs unless you intend to pay for real traffic.

```bash
k6 run tests/load/auth.js -e BASE_URL=https://staging.example.com/api/v1
k6 run tests/load/translations.js -e RATE=50
k6 run tests/load/translations.js -e VARY=false      # cache performance
k6 run tests/load/telegram.js -e TELEGRAM_WEBHOOK_SECRET=...
```

Lower `TRANSLATION` limits or stop a provider stub to test slow and failed providers. Expect `503 OVERLOADED` and stable memory, not rising latency.

## What to record

Record requests per second, p50, p95 and p99 latency, and error rate from k6. Record database response time, pool wait time, CPU and memory from the host, and queue depth and job duration from `/api/v1/metrics` and BullMQ.

Argon2 is deliberately expensive and uses about 19 MB per hash, so login is usually the first CPU limit. Keep `connection_limit` multiplied by the process count below PostgreSQL's `max_connections`.
