import { BengaluruTransitClient } from "bengaluru-transit";
import type { ApproachingBus, GeoCollection, GeoFeature, Position, StopBus, StopSnapshot, TrackerSnapshot } from "./types.js";

// The SDK returns GeoJSON. Keeping the small adapter here makes SDK upgrades
// isolated from the HTTP contract consumed by the frontend.
const client = new BengaluruTransitClient({ language: "en" }) as unknown as {
  routes: {
    searchRoutes(input: { query: string }): Promise<{ items: Array<{ parentRouteId: string; routeNo?: string; [key: string]: unknown }> }>;
    searchByRouteDetails(input: { parentRouteId: string }): Promise<{ up: DirectionDetails; down: DirectionDetails }>;
    getStationTrips(input: { stationId: string; tripType: "running" }): Promise<{ items: Array<{ routeNo: string; routeName: string; fromStationName: string; toStationName: string; vehicleId: string; busNo: string; arrivalTime?: string; deviceStatusFlag: number }> }>;
  };
  stops: { searchBusStops(input: { stationName: string }): Promise<{ items: Array<{ stationId: string; stationName: string }> }> };
  vehicles: { getVehicleTrip(input: { vehicleId: string }): Promise<{ routeStops: GeoCollection }> };
};

type DirectionDetails = { stops: GeoCollection; liveVehicles: GeoCollection };
const asText = (value: unknown): string | null => typeof value === "string" || typeof value === "number" ? String(value) : null;
const emptyCollection = (): GeoCollection => ({ type: "FeatureCollection", features: [] });

function mergeCollections(...collections: GeoCollection[]): GeoCollection {
  return { type: "FeatureCollection", features: collections.flatMap((collection) => collection?.features ?? []) };
}

function withDirection(collection: GeoCollection, direction: "up" | "down"): GeoCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, direction },
    })),
  };
}

function stopId(feature: GeoFeature): string | null {
  return asText(feature.properties.stopId ?? feature.properties.id ?? feature.properties.stop_id);
}

export function arrivalTimeToEtaMinutes(
  value: string | undefined,
  now = Date.now(),
): number | null {
  const bmtcMatch = value?.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  const isoMatch = value?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  const match = bmtcMatch ?? isoMatch;
  if (!match) {
    if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= now
      ? Math.ceil((timestamp - now) / 60_000)
      : null;
  }

  const [, first, second, third, hour, minute, seconds] = match;
  const [day, month, year] = bmtcMatch
    ? [first, second, third]
    : [third, second, first];
  const utcTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(seconds),
  );
  const arrivalTime = utcTime - (5 * 60 + 30) * 60_000;
  const date = new Date(utcTime);
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour)
    || date.getUTCMinutes() !== Number(minute)
    || date.getUTCSeconds() !== Number(seconds)
  ) {
    return null;
  }

  const minutesRemaining = (arrivalTime - now) / 60_000;
  return minutesRemaining < 0 ? null : Math.ceil(minutesRemaining);
}

function clockTimeToEtaMinutes(value: string, now = Date.now()): number | null {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const arrivalTime = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    Number(match[1]),
    Number(match[2]),
  ) - (5 * 60 + 30) * 60_000;
  const minutesRemaining = (arrivalTime - now) / 60_000;
  return minutesRemaining < 0 ? null : Math.ceil(minutesRemaining);
}

function normalizeEta(value: unknown, fallback: string | undefined): string | number | null {
  const eta = asText(value)?.trim();
  if (eta) {
    if (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(eta)) {
      return clockTimeToEtaMinutes(eta) ?? arrivalTimeToEtaMinutes(fallback);
    }
    const isDateTime = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(eta)
      || /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(eta);
    if (!isDateTime) return eta;
    return arrivalTimeToEtaMinutes(eta) ?? arrivalTimeToEtaMinutes(fallback);
  }
  return arrivalTimeToEtaMinutes(fallback);
}

function normalizeArrivalTime(value: unknown, fallback: string | undefined): string | null {
  const eta = asText(value)?.trim();
  const clock = eta?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}`;

  const timestamp = eta ?? fallback;
  const bmtcMatch = timestamp?.match(/^\d{2}-(\d{2})-\d{4} (\d{2}:\d{2}):\d{2}$/);
  if (bmtcMatch) return bmtcMatch[2];

  const isoMatch = timestamp?.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}):\d{2}/);
  if (isoMatch) return isoMatch[1];

  return null;
}

async function etaForVehicle(feature: GeoFeature, direction: "up" | "down", targetStopId: string): Promise<ApproachingBus | null> {
  const vehicleId = asText(feature.properties.vehicleId ?? feature.properties.vehicle_id ?? feature.properties.id);
  if (!vehicleId) return null;

  const trip = await client.vehicles.getVehicleTrip({ vehicleId });
  const target = trip.routeStops.features.find((stop) => stopId(stop) === targetStopId);

  return {
    vehicleId,
    vehicleNumber: asText(feature.properties.vehicleNumber ?? feature.properties.vehicle_number) ?? vehicleId,
    direction,
    position: feature.geometry.coordinates as Position,
    eta: normalizeEta(
      target?.properties.eta ?? feature.properties.eta,
      undefined,
    ),
    nextStop: target ? asText(target.properties.nextStop ?? target.properties.next_stop) : asText(feature.properties.nextStop ?? feature.properties.next_stop),
    routeNo: target ? asText(target.properties.routeNo ?? target.properties.route_no) : null,
    servesTarget: target !== undefined,
    targetStopName: target ? asText(target.properties.stopName ?? target.properties.stop_name) : null,
    routeStart: target ? asText(target.properties.sourceStation ?? target.properties.source_station) : null,
    routeEnd: target ? asText(target.properties.destinationStation ?? target.properties.destination_station) : null,
  };
}

function etaSortValue(eta: ApproachingBus["eta"]): number {
  if (typeof eta === "number") return eta;
  const parsed = Number.parseFloat(eta ?? "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

async function liveVehicleLocations(routeNo: string): Promise<Map<string, GeoFeature>> {
  const routes = await client.routes.searchRoutes({ query: routeNo });
  const route = routes.items[0];
  if (!route) return new Map();
  const details = await client.routes.searchByRouteDetails({ parentRouteId: route.parentRouteId });
  const vehicles = [
    ...withDirection(details.up.liveVehicles ?? emptyCollection(), "up").features,
    ...withDirection(details.down.liveVehicles ?? emptyCollection(), "down").features,
  ];
  const locations = new Map<string, GeoFeature>();
  for (const vehicle of vehicles) {
    const id = asText(vehicle.properties.vehicleId ?? vehicle.properties.vehicle_id ?? vehicle.properties.id);
    if (id) locations.set(id, vehicle);
  }
  return locations;
}

/** Lists all running buses reported for a stop, optionally limited to one route. */
export async function getStopSnapshot(targetStopId: string, routeFilter?: string): Promise<StopSnapshot> {
  const stationTrips = await client.routes.getStationTrips({ stationId: targetStopId, tripType: "running" });
  const matching = stationTrips.items.filter((item) => !routeFilter || item.routeNo.toLowerCase() === routeFilter.toLowerCase());
  const routeLocations = new Map<string, Map<string, GeoFeature>>();
  await Promise.all([...new Set(matching.map((item) => item.routeNo))].map(async (routeNo) => {
    try { routeLocations.set(routeNo, await liveVehicleLocations(routeNo)); } catch { routeLocations.set(routeNo, new Map()); }
  }));
  const buses = await Promise.all(matching.map(async (item): Promise<StopBus | null> => {
    try {
      const vehicle = routeLocations.get(item.routeNo)?.get(item.vehicleId);
      const trip = await client.vehicles.getVehicleTrip({ vehicleId: item.vehicleId });
      const target = trip.routeStops.features.find((stop) => stopId(stop) === targetStopId);
      return {
        vehicleId: item.vehicleId,
        vehicleNumber: item.busNo || item.vehicleId,
        direction: (asText(vehicle?.properties.direction) ?? "up").toLowerCase() === "down" ? "down" : "up",
        position: (vehicle?.geometry.coordinates ?? [0, 0]) as Position,
        eta: normalizeEta(target?.properties.eta, item.arrivalTime),
        arrivalTime: normalizeArrivalTime(target?.properties.eta, item.arrivalTime),
        nextStop: target ? asText(target.properties.nextStop ?? target.properties.next_stop) : null,
        routeNo: item.routeNo,
        servesTarget: true,
        targetStopName: target ? asText(target.properties.stopName ?? target.properties.stop_name) : null,
        routeStart: item.fromStationName,
        routeEnd: item.toStationName,
      };
    } catch { return null; }
  }));
  const sorted = buses.filter((item): item is StopBus => item !== null).sort((a, b) => etaSortValue(a.eta) - etaSortValue(b.eta));
  return { stopId: targetStopId, routeFilter: routeFilter || null, buses: sorted, nextBus: sorted[0] ?? null, refreshedAt: new Date().toISOString() };
}

export async function searchRoutes(query: string) {
  const result = await client.routes.searchRoutes({ query });
  return result.items.map((item) => ({ parentRouteId: item.parentRouteId, routeNo: asText(item.routeNo ?? item.route_no) ?? query }));
}

export async function searchStops(query: string) {
  if (/^\d+$/.test(query)) return [{ stationId: query, stationName: `Stop ${query}` }];
  const result = await client.stops.searchBusStops({ stationName: query });
  return result.items.map((item) => ({ stationId: item.stationId, stationName: item.stationName }));
}

export interface LiveStopBus {
  routeNo: string;
  vehicleNumber: string;
  routeStart: string;
  routeEnd: string;
  targetStopName: string | null;
  eta: string | null;
}

/** Finds one currently running service reported at a stop, for test alerts. */
export async function getAnyLiveBusAtStop(stopId: string): Promise<LiveStopBus | null> {
  const stationTrips = await client.routes.getStationTrips({ stationId: stopId, tripType: "running" });
  const candidate = stationTrips.items.find((item) => item.deviceStatusFlag === 1) ?? stationTrips.items[0];
  if (!candidate) return null;

  const vehicleTrip = await client.vehicles.getVehicleTrip({ vehicleId: candidate.vehicleId });
  const target = vehicleTrip.routeStops.features.find((stop) => stopId === asText(stop.properties.stopId));
  return {
    routeNo: candidate.routeNo,
    vehicleNumber: candidate.busNo,
    routeStart: candidate.fromStationName,
    routeEnd: candidate.toStationName,
    targetStopName: target ? asText(target.properties.stopName) : null,
    eta: target ? asText(target.properties.eta) : null,
  };
}

export async function getTrackerSnapshot(routeNo: string, targetStopId: string): Promise<TrackerSnapshot> {
  const routes = await client.routes.searchRoutes({ query: routeNo });
  const route = routes.items[0];
  if (!route) throw new Error(`No route found for ${routeNo}`);

  const details = await client.routes.searchByRouteDetails({ parentRouteId: route.parentRouteId });
  const stops = mergeCollections(details.up.stops ?? emptyCollection(), details.down.stops ?? emptyCollection());
  const vehicles = mergeCollections(
    withDirection(details.up.liveVehicles ?? emptyCollection(), "up"),
    withDirection(details.down.liveVehicles ?? emptyCollection(), "down"),
  );
  const targetStop = stops.features.find((stop) => stopId(stop) === targetStopId) ?? null;

  // Fetch trip details concurrently, but let one unavailable vehicle fail softly.
  const arrivals = await Promise.all([
    ...details.up.liveVehicles.features.map((vehicle) => etaForVehicle(vehicle, "up", targetStopId)),
    ...details.down.liveVehicles.features.map((vehicle) => etaForVehicle(vehicle, "down", targetStopId)),
  ].map(async (request) => { try { return await request; } catch { return null; } }));

  return {
    routeNo,
    targetStopId,
    targetStop,
    stops,
    vehicles,
    approaching: arrivals.filter((item): item is ApproachingBus => item !== null).sort((a, b) => etaSortValue(a.eta) - etaSortValue(b.eta)),
    refreshedAt: new Date().toISOString(),
  };
}
