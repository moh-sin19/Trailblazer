#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
STACK_STARTED=false
CLEANED_UP=false
FRONTEND_PID=""
ATTACH_PID=""

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

cleanup() {
  local exit_code=${1:-$?}

  if [[ "$CLEANED_UP" == true ]]; then
    return
  fi
  CLEANED_UP=true

  if [[ -n "$ATTACH_PID" ]] && kill -0 "$ATTACH_PID" 2>/dev/null; then
    log "Stopping backend log stream"
    kill "$ATTACH_PID" 2>/dev/null || true
    wait "$ATTACH_PID" 2>/dev/null || true
  fi

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    log "Stopping frontend dev server"
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [[ "$STACK_STARTED" == true ]]; then
    log "Stopping application stack"
    docker compose -f "$COMPOSE_FILE" down 
  fi

  return "$exit_code"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130; exit 130' INT TERM

log "Building backend container image"
docker compose -f "$COMPOSE_FILE" build backend

log "Applying database migrations"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py migrate --noinput

log "Loading bundled sample trails"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py bootstrap_trails

ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-Admin123!}

log "Ensuring administrative user ($ADMIN_EMAIL) exists"
docker compose -f "$COMPOSE_FILE" run --rm backend \
  python manage.py bootstrap_admin \
  --username "$ADMIN_USERNAME" \
  --email "$ADMIN_EMAIL" \
  --password "$ADMIN_PASSWORD" \
  --noinput

log "Ensured badges exist"
docker compose -f "$COMPOSE_FILE" run --rm backend python manage.py seed_badges

log "Starting application stack"
docker compose -f "$COMPOSE_FILE" up -d
STACK_STARTED=true

log "Backend Deployment complete. Backend available on http://localhost:8000"

log "Installing frontend dependencies"
pushd "$ROOT_DIR/frontend" >/dev/null
npm ci --no-audit --no-fund

log "Running production frontend bundle"
npm start &
FRONTEND_PID=$!
popd >/dev/null
docker attach infra-backend-1 &
ATTACH_PID=$!

log "Services running. Press Ctrl+C to stop everything."

wait "$FRONTEND_PID" || true
wait "$ATTACH_PID" || true
