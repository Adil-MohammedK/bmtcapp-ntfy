import type { Arrival } from "../types";
function etaLabel(bus: Arrival) { if (!bus.servesTarget) return "Does not serve stop"; if (bus.eta === null || bus.eta === "") return "ETA unavailable"; const value = String(bus.eta); return /min|:/.test(value) ? value : `~${value} min`; }
export function ArrivalList({ arrivals }: { arrivals: Arrival[] }) {
  if (!arrivals.length) return <div className="empty">No live buses currently report an arrival for this stop.</div>;
  return <div className="arrivals">{arrivals.map((bus) => <article className="arrival" key={bus.vehicleId}><div><strong>🚌 {bus.vehicleNumber}</strong><span>{bus.routeNo ?? "Route"} · {bus.direction.toUpperCase()}</span></div><b className={bus.servesTarget ? "" : "muted"}>{etaLabel(bus)}</b><small>Next stop: {bus.nextStop ?? "Not reported"}</small></article>)}</div>;
}
