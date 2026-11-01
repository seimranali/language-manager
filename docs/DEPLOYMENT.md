# Deployment

## Services

| Service | Notes |
|---|---|
| PostgreSQL | UTF8 encoding is required, because Arabic text fails on legacy encodings such as WIN1252. |
| Redis | Required in production. Use `maxmemory-policy noeviction`. |
| API | `node server.js` from the Next.js standalone build. |
| Worker | `node dist/worker.js`. Required for Telegram, jobs and retention. |

Serverless platforms are not supported, because the worker is a long-running process.

## JWT keys

Generate the key once and keep it in a secrets manager. Never generate it at startup.

```bash
openssl genpkey -algorithm ed25519 -out jwt-private.pem
openssl pkey -in jwt-private.pem -pubout -out jwt-public.pem
```

Store both as single-line values with newlines written as `\n`, or inject them through your secrets manager.

**To rotate keys:**

1. Add the current public key to `JWT_RETIRED_PUBLIC_KEYS` as `{"key-1":"<pem>"}`.
2. Set a new `JWT_KEY_ID`, `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, then deploy.
3. Remove the retired key once `JWT_ACCESS_TOKEN_TTL` has passed.

## Docker

```bash
cp .env.example .env     # set NODE_ENV=production and real values
echo 'POSTGRES_USER=...' >> .env; echo 'POSTGRES_PASSWORD=...' >> .env
docker compose up -d --build
docker compose exec api node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>r.text()).then(console.log)"
```

Seed the languages once:

```bash
docker compose run --rm migrate npm run db:seed
```

For Google, set `GOOGLE_API_KEY` and restrict the key to the Cloud Translation API, or mount a service-account file read-only and point `GOOGLE_APPLICATION_CREDENTIALS` at it, or use workload identity.

## Linux or VPS without Docker

```bash
npm ci && npm run build
cp -r .next/static .next/standalone/.next/static
npx prisma migrate deploy
```

Run two systemd units with `Restart=always`, a dedicated user and `EnvironmentFile=/etc/language-manager/env` (mode 600):

- API: `ExecStart=/usr/bin/node /opt/language-manager/.next/standalone/server.js`
- Worker: `ExecStart=/usr/bin/node /opt/language-manager/dist/worker.js`

## Windows Server

Install Node.js 24, then run the same build commands from an elevated PowerShell prompt:

```powershell
npm ci; npm run build
Copy-Item .next\static .next\standalone\.next\static -Recurse
npx prisma migrate deploy
```

Run the API and worker as two services with a tool such as NSSM or WinSW. Store environment variables in the service definition, and restrict access to it. Redis has no official Windows build, so use a Linux host, a managed service, or a compatible server such as Memurai. Create the database with `ENCODING 'UTF8'`.

## Reverse proxy and HTTPS

HTTPS is required in production, and the Telegram webhook only works over it. Example for nginx:

```nginx
server {
  listen 443 ssl;
  server_name api.example.com;
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Set `TRUST_PROXY=true` behind a proxy like this one. Without it, every client shares one IP rate-limit bucket. Never set it when clients can reach the app directly, because they could then forge the header. Keep `/api/v1/metrics` off the public internet where possible.

## Telegram

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_WEBHOOK_URL`, then run this once per environment:

```bash
npm run telegram:set-webhook          # or: node dist/set-webhook.js
```

## CI/CD

`.github/workflows/ci.yml` runs lint, type checks, tests and the build, then builds the images. It deploys only from `main`, only after those pass, and only when the repository variable `DEPLOY_ENABLED` is `true`. Set the `DEPLOY_SSH_KEY`, `DEPLOY_SSH_TARGET` and `DEPLOY_KNOWN_HOSTS` secrets on a protected `production` environment.

`scripts/deploy.sh` builds, runs migrations, starts the new version, waits for readiness, and restores the previous code if readiness fails.

## Migrations and rollback

Migrations run as a separate step before the new code starts. Make them backward compatible: add first, and remove in a later release. This keeps the previous version working during a rollback, since `deploy.sh` rolls back code but not schema.

**To roll back manually:**

```bash
git checkout <previous-sha>
docker compose up -d --build api worker
curl -f http://127.0.0.1:3000/api/v1/health/ready
```

If a migration itself must be undone, restore the backup taken before it, as described below.

## Backup and recovery

**PostgreSQL** holds all durable data. Take a daily backup and one before every migration:

```bash
pg_dump --format=custom --file=lm-$(date +%F).dump "$DATABASE_URL"
```

Keep backups encrypted and off the host, because they contain phone numbers and translated text. Keep them no longer than your retention policy allows.

**To restore:**

```bash
docker compose stop api worker
createdb --encoding=UTF8 --template=template0 language_manager_restored
pg_restore --dbname=language_manager_restored --no-owner lm-2026-11-01.dump
# Point DATABASE_URL at the restored database
docker compose up -d api worker
```

Test a restore at least quarterly.

**Redis** holds caches, counters and queued work. With AOF enabled, it recovers after a restart. If it is lost, the cache and counters rebuild themselves. Queued jobs stay `QUEUED` in PostgreSQL and must be resubmitted by clients.
