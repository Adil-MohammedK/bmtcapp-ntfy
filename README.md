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
- `GET /api/monitor/status`
- `POST /api/monitor/check` (runs an immediate notification check)
- `POST /api/monitor/test` (sends a test notification; requires its token header)

`/api/tracker` returns GeoJSON feature collections for stops and live vehicles, the selected stop if it occurs on the route, and a sorted `approaching` list. Live trip lookups occur server-side and failures for an individual vehicle do not fail the whole refresh.

## Phone alerts

Copy `.env.example` to `.env`, then configure either provider or **both**:

- **ntfy:** Install the ntfy app, subscribe to a new private topic, then set `NTFY_TOPIC`. Set `NTFY_URL` only if you use a self-hosted ntfy server.
- **Home Assistant:** Create a long-lived access token and find your phone's `notify.mobile_app_*` service. Set `HA_URL`, `HA_TOKEN`, and the service suffix in `HA_NOTIFY_SERVICE`.

When both are configured, every test and live alert is delivered to both ntfy and Home Assistant. Set `INFO=true` to log monitor starts, windows, and delivery results; use `DEBUG=true` for per-bus ETA and delivery detail.

The server checks every minute in `Asia/Kolkata`: routes **314-A** and **314-B** in the **UP** direction from 4:00 AM to 10:30 AM for stop **21945**, then in the **DOWN** direction from 4:00 PM to 6:30 PM for stop **21702**. It sends one alert per bus per window when the SDK returns an ETA of 10 minutes or less. Use the `MORNING_*`, `EVENING_*`, and `ALERT_ETA_MINUTES` environment values to adjust that behavior.

To test your phone setup immediately, set a long random `NOTIFICATION_TEST_TOKEN` in `.env`, restart the API, then run:

```bash
curl -X POST http://localhost:3001/api/monitor/test \
  -H "x-notification-test-token: YOUR_TOKEN"
```

This sends a real test push but does not depend on the monitoring time window or live bus data.

## Structure

```text
apps/api       Express adapter around bengaluru-transit
apps/web       React + Vite + Leaflet interface
Dockerfile     production API/image build
```

## Notes

The dashboard shows the ETA returned by the live-trip API; it does not invent a predicted arrival when the upstream data has no ETA. Vehicle and stop field names are normalized in `apps/api/src/transit.ts`, the only place that should need adjustment if the SDK changes its response shape.
