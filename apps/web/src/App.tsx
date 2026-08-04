import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrivalList } from "./components/ArrivalList";
import { TrackerMap } from "./components/TrackerMap";
import { loadTracker } from "./lib/api";
import type { Snapshot } from "./types";

const REFRESH_MS = 15_000;
export default function App() {
  const [route, setRoute] = useState("314-P"); const [stop, setStop] = useState("21945");
  const [active, setActive] = useState({ route: "314-P", stop: "21945" });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setLoading(true); try { setSnapshot(await loadTracker(active.route, active.stop)); setError(null); } catch (err) { setError(err instanceof Error ? err.message : "Unable to load transit data"); } finally { setLoading(false); } }, [active]);
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), REFRESH_MS); return () => window.clearInterval(interval); }, [refresh]);
  function submit(event: FormEvent) { event.preventDefault(); setActive({ route: route.trim(), stop: stop.trim() }); }
  return <main><header><div><p className="eyebrow">BENGALURU TRANSIT</p><h1>BMTC Live Tracker</h1></div><p className="status">{loading ? "Refreshing…" : "Live · refreshes every 15 sec"}</p></header>
    <form onSubmit={submit} className="search"><label>Route<input value={route} onChange={(e) => setRoute(e.target.value)} required /></label><label>Destination stop ID<input value={stop} onChange={(e) => setStop(e.target.value)} required /></label><button type="submit">Track route</button></form>
    {error && <div className="error">{error}</div>}
    {snapshot && <section className="layout"><div className="map-card"><TrackerMap snapshot={snapshot} /><p className="caption">{snapshot.vehicles.features.length} live buses · {snapshot.stops.features.length} stops · Updated {new Date(snapshot.refreshedAt).toLocaleTimeString()}</p></div><aside><h2>Approaching stop {snapshot.targetStopId}</h2><ArrivalList arrivals={snapshot.approaching} /></aside></section>}
    {!snapshot && !error && <div className="loading">Loading route data…</div>}
  </main>;
}
