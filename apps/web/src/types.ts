export type Position = [number, number];
export interface Feature { type: "Feature"; geometry: { type: "Point"; coordinates: Position }; properties: Record<string, unknown>; }
export interface Collection { type: "FeatureCollection"; features: Feature[]; }
export interface Arrival { vehicleId: string; vehicleNumber: string; direction: "up" | "down"; position: Position; eta: string | number | null; nextStop: string | null; routeNo: string | null; servesTarget: boolean; }
export interface Snapshot { routeNo: string; targetStopId: string; targetStop: Feature | null; stops: Collection; vehicles: Collection; approaching: Arrival[]; refreshedAt: string; }
