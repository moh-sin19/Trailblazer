#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

cleanup() {
  log "Stopping Docker services"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

pushd "$ROOT_DIR/frontend" >/dev/null
log "Running frontend test suite"
npm ci 

npm test -- --watch=false --browsers=ChromeHeadless
popd >/dev/null

log "Ensuring database container is ready"
docker compose -f "$COMPOSE_FILE" up -d --wait db

log "Building backend image"
docker compose -f "$COMPOSE_FILE" build backend

log "Applying database migrations"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py migrate --noinput

ADMIN_USERNAME=${ADMIN_USERNAME:-ci-admin}
ADMIN_EMAIL=${ADMIN_EMAIL:-ci-admin@example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-Admin123!}

log "Bootstrapping default admin user for tests"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py bootstrap_admin \
  --username "$ADMIN_USERNAME" \
  --email "$ADMIN_EMAIL" \
  --password "$ADMIN_PASSWORD" \
  --noinput

log "Seeding badges for tests"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py seed_badges

log "Running backend test suite"
docker compose -f "$COMPOSE_FILE" run --rm backend coverage run --source='.' manage.py test
docker compose -f "$COMPOSE_FILE" run --rm backend coverage report --skip-empty 

log "All tests completed"
