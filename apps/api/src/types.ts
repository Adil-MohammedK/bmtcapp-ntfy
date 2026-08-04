export type Position = [number, number];

export interface GeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Position };
  properties: Record<string, unknown>;
}

export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface ApproachingBus {
  vehicleId: string;
  vehicleNumber: string;
  direction: "up" | "down";
  position: Position;
  eta: string | number | null;
  nextStop: string | null;
  routeNo: string | null;
  servesTarget: boolean;
}

export interface TrackerSnapshot {
  routeNo: string;
  targetStopId: string;
  targetStop: GeoFeature | null;
  stops: GeoCollection;
  vehicles: GeoCollection;
  approaching: ApproachingBus[];
  refreshedAt: string;
}
