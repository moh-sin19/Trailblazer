# TrailBlazer (Angular + Tailwind + MapLibre • Django + DRF + PostGIS)

## Stack highlights
- **Backend:** Django 5, Django REST Framework, GeoDjango/PostGIS, Allauth authentication, CORS ready
- **Database:** PostgreSQL 17 with the PostGIS extension enabled during migrations
- **Frontend:** Angular 17 + Tailwind CSS + MapLibre preconfigured to hit the API
- **Tooling:** Docker Compose, Bash automation scripts, and npm workflows for local development

## Prerequisites
- Docker Desktop (Compose v2+) with enough resources for PostgreSQL + Django (≈1 GB free disk), user has access to the Docker daemon
- Node.js 18+ with `npm` (or `pnpm` if you prefer)
- Optional: `psql` or another Postgres client if you want to inspect the database manually

## Quick start
### Option A — one command (macOS/Linux/WSL)
```bash
./run.sh
```
The script builds the backend image, applies migrations (which also enable PostGIS), loads the bundled sample trails, starts the Docker services, installs frontend dependencies, and launches the Angular dev server. Press `Ctrl+C` to stop; the script will tear everything down cleanly.

### Option B — manual steps
```bash
# 1) Boot the stack (database + backend) and rebuild when Dockerfiles change
docker compose -f infra/docker-compose.yml up -d --build

# 2) Apply migrations (PostGIS extension is created automatically)
docker compose -f infra/docker-compose.yml run --rm backend python manage.py migrate --noinput

# 3) Optional: create/refresh the admin dashboard user
docker compose -f infra/docker-compose.yml run --rm backend \
  python manage.py bootstrap_admin --username admin --email admin@example.com --password Admin123! --noinput

# 4) Optional: load the bundled sample trails
docker compose -f infra/docker-compose.yml run --rm backend python manage.py bootstrap_trails

# 5) Optional: load the bundled badge data
docker compose -f infra/docker-compose.yml run --rm backend python manage.py seed_badges

# 6) (Optional) Enable Graphhopper snapping
# export GRAPHHOPPER_API_KEY=...

# 6) Start the Angular dev server
cd frontend
npm install      # or: npm ci
npm start
```

Backend API: http://localhost:8000/api/  
Angular UI: http://localhost:4200

## Windows setup notes
- Enable **WSL 2** (Ubuntu or Debian recommended) and install Docker Desktop with WSL integration. Run this project from the WSL filesystem so file watchers and bind mounts stay fast.
- Run the automation scripts from within WSL: `chmod +x run.sh test.sh` once, then execute `./run.sh` or `./test.sh` as needed.
- If you prefer PowerShell or Git Bash, use the manual Docker commands above and run `npm install` / `npm start` with Node.js 18+. The Bash scripts require a Unix-compatible shell.
- Install a Chromium-based browser (Chrome or Edge) so Angular’s `ChromeHeadless` test runner works. From WSL you can also swap to `npm run test:headless` if you rely on Playwright.
- Docker volume paths are Linux-style inside WSL; no additional `COMPOSE_CONVERT_WINDOWS_PATHS` flag is required.

## Useful commands
- `docker compose -f infra/docker-compose.yml logs -f backend` — follow the Django server output
- `docker compose -f infra/docker-compose.yml down -v` — stop containers and drop the Postgres volume
- `docker compose -f infra/docker-compose.yml exec backend bash` — open an interactive shell inside the backend container
- `./test.sh` — runs the Angular unit tests in headless mode, primes a dashboard admin via `bootstrap_admin`, then executes the Django test suite against Postgres inside Docker

## Repo layout
- `backend/` — Django project (`core`) and `trails` app exposing `/api/trails/`
- `frontend/` — Angular workspace (Tailwind + MapLibre preconfigured)
- `infra/` — Docker Compose definition for the stack
- `run.sh` — orchestrates full local startup (Docker + frontend)
- `test.sh` — convenience script for the backend + frontend test suites
- `.env` — environment defaults consumed by the backend container

### Email configuration
Registration sends verification emails. By default the backend writes emails to the console. To deliver real email, supply SMTP settings via environment variables (e.g. in `.env`):

```env
DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
DJANGO_DEFAULT_FROM_EMAIL=no-reply@trailblazer.local
DJANGO_EMAIL_HOST=smtp.example.com
DJANGO_EMAIL_PORT=587
DJANGO_EMAIL_HOST_USER=apikey
DJANGO_EMAIL_HOST_PASSWORD=secret
DJANGO_EMAIL_USE_TLS=1
FRONTEND_BASE_URL=http://localhost:4200
```

Any Compose restart will pick up the new values.

### Admin dashboard access
- `run.sh` automatically calls `python manage.py bootstrap_admin` with the environment variables `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (defaults: `admin`, `admin@example.com`, `Admin123!`).
- You can rerun the command at any time to rotate credentials:

```bash
docker compose -f infra/docker-compose.yml run --rm backend \
  python manage.py bootstrap_admin --username myadmin --email me@example.com --password "NewPassw0rd!" --noinput
```

The command updates the Django flags (`is_staff`, `is_superuser`) and lifts the profile role to `admin`, granting access to the custom moderation dashboard without touching unrelated user data.

### Graphhopper route fitting
The submit-trail UI can snap drawn lines to real-world paths via the Graphhopper Routing API. Configure these variables (in `.env` or your shell) before starting the backend:

```env
GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1
GRAPHHOPPER_API_KEY=your-api-key
GRAPHHOPPER_PROFILE=foot
GRAPHHOPPER_TIMEOUT=10
GRAPHHOPPER_CACHE_SECONDS=300
```

If no API key is supplied the backend gracefully disables the feature and the frontend will fall back to drawing raw segments.
