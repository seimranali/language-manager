# Install Language Manager

Download the archive for your system from the GitHub release:

| System | Archive |
|---|---|
| Linux x64 | `linux-x64.tar.gz` |
| Linux ARM64 | `linux-arm64.tar.gz` |
| macOS Apple silicon | `darwin-arm64.tar.gz` |
| Windows x64 | `win32-x64.zip` |

## Requirements

- Node.js 24
- PostgreSQL
- Redis (required when `NODE_ENV=production`)

## Set up

Extract the archive, open a terminal in the folder, and create your settings:

```
cp .env.example .env
```

On Windows use `copy .env.example .env`. Fill in `.env`; every setting is described there.

Create the database tables and language list. Run these again after each upgrade:

```
npx --yes prisma@6.19.3 migrate deploy
node --env-file=.env dist/seed.js
```

## Run

Start each in its own terminal:

```
node --env-file=.env server.js
node --env-file=.env dist/worker.js
```

The API listens on port 3000. Check it at `http://localhost:3000/api/v1/health`.

To use the Telegram bot, point its webhook at your public address:

```
node --env-file=.env dist/set-webhook.js
```
