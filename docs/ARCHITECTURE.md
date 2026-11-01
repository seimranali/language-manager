# Architecture

## Layers

| Layer | Location | Rule |
|---|---|---|
| Presentation | `src/app/api/v1`, `src/shared/http` | Validates, authenticates and formats. No queries or provider calls. |
| Business logic | `src/modules` | Workflows and rules. No HTTP or Prisma imports. |
| Data access | `src/repositories` | The only code that uses Prisma. |
| Provider adapters | `src/providers/translation` | The only code that calls Google or Claude. |

ESLint enforces the first two rules through `no-restricted-imports`. `src/container.ts` wires everything explicitly, and the API, the worker and the tests all use it.

## Telegram is a client

The webhook only verifies, dedupes and enqueues. `TelegramService` then calls the same `TranslationService` and `UserService` that a mobile app reaches over REST. No core service knows about Telegram.

## Translation flow

1. Validate input, then apply rate limits, and charge the daily quota.
2. For a multilingual request with `sourceLanguage: "auto"`, detect the language once.
3. Translate each target concurrently from the **original** text.
4. For each target: choose a provider, check the cache, join any identical in-flight call, then call the provider.
5. Save history unless the user, the server or the request has disabled it.

A failed target returns `text: null`, `status: "failed"` and an error code. Set `MULTILINGUAL_PARTIAL_FAILURE=fail` to reject the whole request instead.

## Provider selection

New and existing users default to `google`. Requests can still pass `claude` or `auto`.

| Mode | Behaviour |
|---|---|
| `google`, `claude` | Uses that provider. Switching needs both `TRANSLATION_ALLOW_FALLBACK=true` and `allowFallback: true` on the request. |
| `auto` | Regional targets, context, glossaries, and formal, business or technical styles go to Claude. Everything else goes to Google. Fallback needs the server setting. |

## Saudi Arabic

`ar-SA` does not guarantee regional output. Google has no such variant, so the adapter sends `ar` and reports `regionalized: false`. Claude receives explicit writing rules and reports `regionalized: true`. In `auto` mode the Saudi target therefore goes to Claude, and clients can see which treatment each result received.

## Concurrency and resilience

Each provider call passes through `ProviderGuard`, in this order: circuit breaker, distributed rate limit, bounded semaphore, then timeout with limited retries using exponential backoff and jitter. A full queue returns `503 OVERLOADED` rather than growing memory. Semaphores and circuit breakers are per process, so total concurrency is the configured limit multiplied by the number of processes.

If Redis fails, requests return 503 rather than hanging, and rate limits fail closed so brute-force protection never switches off. A cache failure alone counts as a miss.

## Added beyond the brief

- `sessions`: one row per login, and its id is the token family id. Each request checks it, so revocation takes effect immediately rather than when the access token expires.
- `translation_results`: child rows that let one request hold several targets. The brief's `TargetLanguage` and `TranslatedText` columns live here.
- `translation_jobs`, `provider_usage`, `mobile_verifications`, and the Telegram tables.

## Adding things later

- **A target language:** add an entry to `TARGET_PROFILES` and list its key in `MULTILINGUAL_TARGETS`.
- **A provider:** implement `TranslationProvider` and register it in `buildProviders`.
- **A mobile app:** use the existing REST API. `deviceName` and `/auth/sessions` already support device management. Push notifications for jobs are not built yet; they can be added where a job completes in `TranslationJobService.process`.
