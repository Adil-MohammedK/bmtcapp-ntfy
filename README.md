# BMTC Live Tracker for Home Assistant

Track live BMTC buses in Home Assistant and use your own automations to decide when and how to be notified. Choose a stop, optionally filter by route, view live bus ETAs and locations, and use Home Assistant schedules, presence, scripts, TTS, and notification integrations to customize your commute alerts.

The project includes a small transit-data service and a Home Assistant custom integration. The service fetches BMTC data; Home Assistant owns the commute rules and notifications. It does not impose a fixed schedule or notification provider.

> **Unofficial service:** This project uses the `bengaluru-transit` TypeScript SDK, an unofficial wrapper around BMTC's undocumented live-trip API. It is not affiliated with or endorsed by BMTC, may stop working if that API changes, and is provided without a reliability guarantee. Use at your own risk.

## Home Assistant quick start

### 1. Start the BMTC data service

Home Assistant needs to be able to reach the service. In this repository, start it with Docker:

```bash
docker compose up --build -d
```

Use the address that Home Assistant can reach, such as `http://bmtc-live-tracker:3001` when both services share a Docker network, or `http://<server-ip>:3001` on your LAN. Do not use `localhost` unless Home Assistant and the tracker run in the same network namespace.

### 2. Install the custom integration

Copy the contents of `custom_components/bmtc_live_tracker` into Home Assistant's `config/custom_components/bmtc_live_tracker` directory. The folder should contain `manifest.json` directly. Restart Home Assistant after copying the files.

### 3. Add a stop

In Home Assistant, go to **Settings → Devices & services → Add integration → BMTC Live Tracker**:

1. Enter the reachable tracker URL.
2. Search using a stop name or numeric stop ID.
3. Select the matching stop. Optionally enter a route number to limit the results to that route; leave it blank to track buses on all routes serving the stop.

Add another integration entry for each stop and route combination you want to monitor. You can change an entry's stop or route from its options.

![Home Assistant integration setup](assets/integration-config.png)

## Entities and dashboards

The integration creates:

- A **Next bus ETA** sensor for the selected stop, with the current bus list in its `buses` attribute.
- An ETA sensor for each live bus.
- A `device_tracker` entity for each bus with a reported location. Its attributes include bus ID, route, ETA, next stop, and stop ID.

The API reports arrival information that may be a clock time such as `08:42`; the integration presents ETA sensor states in minutes. Wall-clock arrival time is available as an `arrival_time` attribute when provided.

![Home Assistant entities](assets/integration-page.png)

For example, a Markdown card can list all bus trackers for a stop:

```yaml
type: markdown
title: Buses at stop 21945
content: |
  {% set buses = states.device_tracker
    | selectattr('attributes.stop_id', 'defined')
    | selectattr('attributes.stop_id', 'equalto', '21945')
    | list %}
  {% if buses %}
  | Bus | Route | ETA | Next stop |
  |---|---|---|---|
  {% for bus in buses %}
  | {{ bus.attributes.vehicleNumber }} | {{ bus.attributes.routeNo }} | {{ bus.attributes.eta }} | {{ bus.attributes.nextStop }} |
  {% endfor %}
  {% else %}
  No BMTC bus trackers found for this stop.
  {% endif %}
```

To show only a particular route, add this filter before `| list`:

```jinja
| selectattr('attributes.routeNo', 'equalto', '314-B')
```

Use the actual entity IDs and attribute names shown in **Developer Tools → States** if yours differ. The integration does not provide custom Lovelace cards; standard Home Assistant Markdown, Entities, Sensor, and Map cards work with its entities.

## Automations and notifications

Schedules, weekday/weekend choices, home/away checks, notification services, and TTS are configured in Home Assistant. For a route-specific integration entry, a basic weekday morning notification can use its Next bus ETA sensor:

```yaml
alias: BMTC weekday commute alert
triggers:
  - trigger: numeric_state
    entity_id: sensor.bmtc_stop_21945_314_b_next_bus_eta
    below: 10
conditions:
  - condition: time
    after: "08:00:00"
    before: "10:30:00"
    weekday: [mon, tue, wed, thu, fri]
  - condition: state
    entity_id: person.adil
    state: home
actions:
  - action: notify.mobile_app_phone
    data:
      title: Bus approaching
      message: >-
        The next bus is {{ states('sensor.bmtc_stop_21945_314_b_next_bus_eta') }}
        minutes away.
mode: single
```

To track all routes at a stop, use the `buses` attribute and a template trigger to filter by route and ETA, and send announcements for each bus that enters the threshold. For example, this automation notifies when a 314-series bus is within 15 minutes of the selected stop:
```yaml
alias: BMTC weekday morning bus alert
description: Notify when a 314-series bus is within 15 minutes of the selected stop.
triggers:
  - trigger: state
    entity_id: sensor.bmtc_stop_21945_all_routes_next_bus_eta
    attribute: buses
conditions:
  - condition: time
    after: '08:00:00'
    before: '10:30:00'
    weekday:
      - mon
      - tue
      - wed
      - thu
      - fri
  - condition: template
    value_template: >-
      {% set previous = trigger.from_state.attributes.get('buses', []) if
      trigger.from_state else [] %} {% set ns = namespace(entered=false) %} {%
      for bus in trigger.to_state.attributes.get('buses', []) %}
        {% set old = previous | selectattr('vehicleId', 'equalto', bus.get('vehicleId')) | list | first %}
        {% set old_eta = old.get('eta', 999) | float(999) if old else 999 %}
        {% if bus.get('routeNo', '') | string in ['314', '314-A', '314-B'] and bus.get('eta', 999) | float(999) <= 15 and old_eta > 15 %}
          {% set ns.entered = true %}
        {% endif %}
      {% endfor %} {{ ns.entered }}
actions:
  - variables:
      approaching: >-
        {% set previous = trigger.from_state.attributes.get('buses', []) if
        trigger.from_state else [] %} {% set ns = namespace(buses=[]) %} {% for
        bus in trigger.to_state.attributes.get('buses', []) %}
          {% set old = previous | selectattr('vehicleId', 'equalto', bus.get('vehicleId')) | list | first %}
          {% set old_eta = old.get('eta', 999) | float(999) if old else 999 %}
          {% if bus.get('routeNo', '') | string in ['314', '314-A', '314-B'] and bus.get('eta', 999) | float(999) <= 15 and old_eta > 15 %}
            {% set ns.buses = ns.buses + [bus] %}
          {% endif %}
        {% endfor %} {{ ns.buses }}
  - action: notify.mobile_app_adils_iphone
    data:
      title: BMTC bus approaching
      message: >-
        {% for bus in approaching %} Route {{ bus.routeNo }} — {{
        bus.vehicleNumber }} is about {{ bus.eta }} minutes away{% if
        bus.arrivalTime %} (arrival {{ bus.arrivalTime }}){% endif %}.{% if not
        loop.last %} {% endif %} {% endfor %}
  - action: openai_tts.say
    target:
      entity_id: media_player.adil_s_fire_tv
    data:
      tts_entity: tts.openai_tts_kokero
      message: >-
        Bus {{ repeat.item.get('vehicleNumber', repeat.item.get('vehicleId')) }}
        on route {{ repeat.item.get('routeNo', 'unknown') }} is about {{
        repeat.item.get('eta') }} away. Next stop: {{
        repeat.item.get('nextStop', 'not reported') }}.
mode: queued
```
<video src="https://github.com/user-attachments/assets/41750e51-3447-4a06-af82-96d53a707ff2" width="500" controls>
  Your browser does not support the video tag.
</video>



Replace the example sensor, person, and notify entity IDs with yours. You can add further notification actions, or use your configured TTS integration in the same automation. For a stop tracking all routes, use the `buses` attribute and template-filter by route and ETA; separate integration entries can also be used for weekday and weekend routes.

## Screenshots

![BMTC web tracker](assets/webui.png)
![Home Assistant dashboard](assets/hass.jpeg)
![ntfy example](assets/ntfy.jpeg)

## Transit service and API

The HTTP service is a data backend for the Home Assistant integration. It can also serve the included web tracker UI, but it does not run notification schedules or call notification providers.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Service health |
| `GET /api/routes?q=314-P` | Search routes |
| `GET /api/stops?q=Ganesha%20Temple` | Search stops by name or ID |
| `GET /api/stop?stop=21945&route=314-P` | Live buses and ETAs at a stop; `route` is optional |
| `GET /api/tracker?route=314-P&stop=21945` | Route stops and live vehicles as GeoJSON |

The service normalizes the upstream SDK response for the integration and web UI. Individual vehicle lookup failures do not fail the whole stop refresh.

## Continuous integration

GitHub Actions runs HACS repository validation and Home Assistant Hassfest on pushes, pull requests, and a daily schedule. Both checks must pass before publishing or submitting the integration.

## Community and contributions

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in project spaces. See
the [Contributing guide](./CONTRIBUTING.md) before opening a pull request, and
use the private reporting instructions in the [Security Policy](./SECURITY.md)
for suspected vulnerabilities.

## Run locally and develop

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

The web UI is at `http://localhost:5173`; Vite proxies `/api` requests to the Express API at port 3001. Create a production build with `npm run build`.

The project layout:

```text
apps/api       Express transit-data service
apps/web       React + Vite + Leaflet tracker UI
custom_components/bmtc_live_tracker  Home Assistant integration
Dockerfile     production service image
```

Thanks to the [`bengaluru-transit` SDK author](https://github.com/Sync271/bengaluru-transit). Contributions and bug reports are welcome.
