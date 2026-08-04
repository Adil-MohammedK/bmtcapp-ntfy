# BMTC Live Tracker

A full-stack tracker for live BMTC route vehicles using the `bengaluru-transit` TypeScript SDK. It starts on route **314-P** and destination stop **21945**, draws the route's reported stops, displays live buses, and queries each live vehicle's trip to list reported ETAs to the selected stop.

## Prerequisites

- Node.js 20 or newer (the SDK requires Node 18+)
- npm 9 or newer

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` to the Express API at port 3001. Production builds are created with `npm run build`.

## Docker

```bash
docker compose up --build
```

Open `http://localhost:3001`. The container serves the built frontend and the Express API together; during development use Vite at port 5173.

## API

- `GET /health`
- `GET /api/routes?q=314-P`
- `GET /api/tracker?route=314-P&stop=21945`

`/api/tracker` returns GeoJSON feature collections for stops and live vehicles, the selected stop if it occurs on the route, and a sorted `approaching` list. Live trip lookups occur server-side and failures for an individual vehicle do not fail the whole refresh.

## Structure

```text
apps/api       Express adapter around bengaluru-transit
apps/web       React + Vite + Leaflet interface
Dockerfile     production API/image build
```

## Notes

The dashboard shows the ETA returned by the live-trip API; it does not invent a predicted arrival when the upstream data has no ETA. Vehicle and stop field names are normalized in `apps/api/src/transit.ts`, the only place that should need adjustment if the SDK changes its response shape.
