# Trailblazer

A full-stack trail discovery platform for finding, mapping and sharing hiking trails.
Users browse trails on an interactive map, import their own routes from GPX files, and
track engagement through live trail and user counters.

Built solo, Sep - Oct 2025. [Live demo](#) | 

---

## What it does

- **Map-first discovery** - every trail is a geospatial record. The map renders
  server-side clustered pins so dense regions stay fast instead of dumping thousands
  of markers into the browser.
- **GPX import** - upload a GPS track from a watch or phone and it is parsed,
  validated and stored as a PostGIS geometry, then rendered as a route on the map.
- **Event-driven counters** - trail views and user activity are counted through an
  event pipeline with Redis as the hot store, so counts update in real time without
  hammering Postgres on every page view.
- **Accounts and social login** - registration, email verification and third-party
  auth via django-allauth.
- **REST API** - the whole thing is API-first (Django REST Framework), so the web
  client is just one consumer.

## Tech stack

| Layer | Choice |
|---|---|
| API | Django, Django REST Framework |
| Geospatial | GeoDjango, PostGIS |
| Database | PostgreSQL |
| Cache / events | Redis |
| Auth | django-allauth |
| Packaging | Docker, docker-compose |
| Hosting | AWS ECS |
| CI/CD | GitHub Actions |

## Architecture

            +-----------------+
   client ->|  Django + DRF   |-> PostgreSQL + PostGIS   (trails, routes, users)
            |   (ECS tasks)   |-> Redis                  (counters, cache)
            +-----------------+
                    ^
                    |
        GitHub Actions: test -> build image -> push -> deploy to ECS

Application services are containerised and run as ECS tasks. Every push runs the test
suite, builds the image and, on main, rolls out a new task definition - no manual
deploys.

## Engineering notes

**Clustering.** Rendering raw markers does not scale past a few hundred trails. Pins
are clustered by bounding box and zoom level before serialisation, so the payload size
stays roughly constant as the dataset grows.

**GPX parsing.** GPX files are user-supplied and frequently malformed, so import is
defensive: parse, validate the track geometry, simplify the point set, then persist as
a PostGIS `LineString` rather than a blob of coordinates. That keeps spatial queries
(nearby trails, bounding-box search) in the database where they belong.

**Counters.** Writing a row per view does not survive traffic. Increments land in Redis
and are periodically flushed to Postgres, which keeps reads cheap and write amplification
bounded while staying eventually accurate.

**Spatial indexing.** PostGIS GiST indexes back the proximity and bounding-box queries
that drive both map panning and search.

## Running locally

git clone https://github.com/<you>/trailblazer.git
cd trailblazer
cp .env.example .env          # set DB, Redis and auth credentials
docker compose up --build     # app, PostGIS and Redis
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser

The API is then at `http://localhost:8000/api/`, the admin at `/admin/`.

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/trails/` | List trails; supports bounding-box and zoom params for clustering |
| `GET` | `/api/trails/{id}/` | Trail detail including route geometry |
| `POST` | `/api/trails/` | Create a trail |
| `POST` | `/api/trails/import/` | Upload a GPX file and create a trail from it |
| `GET` | `/api/users/{id}/` | Public user profile and activity counters |
| `POST` | `/api/auth/...` | Registration, login and social auth (allauth) |

## Screenshots

_Add: clustered map view, trail detail with imported GPX route, profile page._

## Roadmap

- Elevation profiles derived from GPX elevation data
- Trail reviews and photo uploads
- Offline route export back to GPX/KML
- Full-text and filter search (difficulty, distance, region)

## Licence

MIT
