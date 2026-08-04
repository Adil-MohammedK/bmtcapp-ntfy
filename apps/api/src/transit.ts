import { BengaluruTransitClient } from "bengaluru-transit";
import type { ApproachingBus, GeoCollection, GeoFeature, Position, TrackerSnapshot } from "./types.js";

// The SDK returns GeoJSON. Keeping the small adapter here makes SDK upgrades
// isolated from the HTTP contract consumed by the frontend.
const client = new BengaluruTransitClient({ language: "en" }) as unknown as {
  routes: {
    searchRoutes(input: { query: string }): Promise<{ items: Array<{ parentRouteId: string; routeNo?: string; [key: string]: unknown }> }>;
    searchByRouteDetails(input: { parentRouteId: string }): Promise<{ up: DirectionDetails; down: DirectionDetails }>;
    getStationTrips(input: { stationId: string; tripType: "running" }): Promise<{ items: Array<{ routeNo: string; routeName: string; fromStationName: string; toStationName: string; vehicleId: string; busNo: string; arrivalTime?: string; deviceStatusFlag: number }> }>;
  };
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
    eta: target ? asText(target.properties.eta) : null,
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

export async function searchRoutes(query: string) {
  const result = await client.routes.searchRoutes({ query });
  return result.items.map((item) => ({ parentRouteId: item.parentRouteId, routeNo: asText(item.routeNo ?? item.route_no) ?? query }));
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
