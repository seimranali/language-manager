#!/usr/bin/env bash
# Usage: deploy.sh <git-ref>. Run on the host from a checkout of this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

ref="$1"
previous="$(git rev-parse HEAD)"
health() {
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${PORT:-3000}/api/v1/health/ready" >/dev/null && return 0
    sleep 2
  done
  return 1
}

git fetch --all --tags
git checkout "$ref"
docker compose build api worker migrate
docker compose run --rm migrate
docker compose up -d api worker

if ! health; then
  echo "Health check failed; rolling back code to $previous" >&2
  git checkout "$previous"
  docker compose build api worker
  docker compose up -d api worker
  # Migrations are not reversed automatically. See docs/DEPLOYMENT.md.
  exit 1
fi
echo "Deployed $ref"
