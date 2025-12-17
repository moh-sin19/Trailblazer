# Trailblazer — Angular + Tailwind frontend

**Stack:** Angular 17 (standalone), Tailwind CSS, MapLibre GL (no token required).

## Quick start

```bash
# Node 18+ recommended
npm i -g @angular/cli@17

# In this folder
npm install
npm start
```

Open http://localhost:4200

> If you prefer **Mapbox** styles, replace the MapLibre demo style URL with your Mapbox style + token.

## Folders

- `src/app/pages/discover-map` — Map-based discovery with filters and a list view.
- `src/app/pages/trail-detail` — Trail page with ratings & comments 
- `src/app/pages/submit-trail` — Submit form 
- `src/app/components/*` — Navbar, star rating, trail card.

Replace the mock service with real `HttpClient` calls and handle auth (JWT or session).

## Tailwind

Configured via `tailwind.config.js` and `postcss.config.js`. Classes are used directly in templates.

## Notes

- Map tiles use a **public MapLibre style** 
- Geolocation requires HTTPS or `localhost` in most browsers.

© 2025 Trailblazer
