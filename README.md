# Language Manager API

A multilingual translation backend built with Next.js and TypeScript. It serves a Telegram bot today and a future mobile app through the same versioned REST API, using Google Cloud Translation and Anthropic Claude.

Its main feature, `POST /api/v1/translations/multilingual`, translates a paragraph from any supported language into Dutch, English and Saudi-appropriate Arabic in one response.

## Requirements

- Node.js 24 LTS
- PostgreSQL 16 or later, with a **UTF8** database
- Redis 7 or later (required in production; optional in development)

## Quick start

```bash
npm ci
cp .env.example .env        # then fill in DATABASE_URL and the JWT keys
npx prisma migrate deploy
npm run db:seed
npm run dev
```

With no PostgreSQL available, run `npm run db:local` in a second terminal. It starts a development database on port 54320 and applies migrations and seed data.

Generate the JWT keys as shown in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#jwt-keys).

The API runs at `http://localhost:3000/api/v1`, with Swagger UI at `/docs`. A provider is enabled when its credentials are set. Without Redis, queued work runs in the API process, and this is for development only.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Background worker (after a build) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm test` | Unit and integration tests; starts its own PostgreSQL |
| `npm run db:deploy` / `npm run db:seed` | Apply migrations / seed languages |
| `npm run languages:sync` | Import languages from configured providers |
| `npm run telegram:set-webhook` | Register the Telegram webhook |

Set `TEST_DATABASE_URL` to test against your own PostgreSQL, and `TEST_REDIS_URL` to include the Redis adapter tests.

## Documentation

- [Architecture and decisions](docs/ARCHITECTURE.md)
- [API examples](docs/API-EXAMPLES.md), plus OpenAPI at `/api/v1/openapi.json`
- [Deployment, backup and rollback](docs/DEPLOYMENT.md)
- [Security and privacy](docs/SECURITY.md)
- [Load testing](docs/LOAD-TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
