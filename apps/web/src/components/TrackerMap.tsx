import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { Snapshot } from "../types";

function busIcon(direction: string) {
  const label = direction.toUpperCase() === "DOWN" ? "DOWN" : "UP";
  return L.divIcon({
    className: "bus-icon",
    html: `<span class="bus-direction ${label.toLowerCase()}">🚌<small>${label}</small></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}
function MapBounds({ snapshot }: { snapshot: Snapshot }) {
  const map = useMap();
  const positions = snapshot.stops.features.map((item) => [item.geometry.coordinates[1], item.geometry.coordinates[0]] as [number, number]);
  useEffect(() => { if (positions.length) map.fitBounds(positions, { padding: [34, 34], maxZoom: 15 }); }, [map, snapshot.refreshedAt]);
  return null;
}
const label = (feature: { properties: Record<string, unknown> }) => String(feature.properties.stopName ?? feature.properties.name ?? feature.properties.stopId ?? "Bus stop");

export function TrackerMap({ snapshot }: { snapshot: Snapshot }) {
  const routeLine = useMemo(() => snapshot.stops.features.map((item) => [item.geometry.coordinates[1], item.geometry.coordinates[0]] as [number, number]), [snapshot]);
  return <MapContainer className="map" center={[12.9716, 77.5946]} zoom={12} scrollWheelZoom>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.65 }} />}
    {snapshot.stops.features.map((stop, index) => <CircleMarker key={`stop-${index}`} center={[stop.geometry.coordinates[1], stop.geometry.coordinates[0]]} radius={4} pathOptions={{ color: "#1e40af", fillColor: "#fff", fillOpacity: 1, weight: 2 }}><Popup>{label(stop)}</Popup></CircleMarker>)}
    {snapshot.targetStop && <CircleMarker center={[snapshot.targetStop.geometry.coordinates[1], snapshot.targetStop.geometry.coordinates[0]]} radius={10} pathOptions={{ color: "#047857", fillColor: "#34d399", fillOpacity: 1, weight: 3 }}><Tooltip permanent direction="top" offset={[0, -10]} className="destination-label">{label(snapshot.targetStop)}</Tooltip><Popup><strong>Destination</strong><br />{label(snapshot.targetStop)}</Popup></CircleMarker>}
    {snapshot.vehicles.features.map((bus, index) => { const direction = String(bus.properties.direction ?? "up"); return <Marker key={`bus-${index}`} position={[bus.geometry.coordinates[1], bus.geometry.coordinates[0]]} icon={busIcon(direction)}><Popup><strong>{String(bus.properties.vehicleNumber ?? bus.properties.vehicleId ?? "Live bus")}</strong><br />{snapshot.routeNo} · {direction.toUpperCase()}</Popup></Marker>; })}
    <MapBounds snapshot={snapshot} />
  </MapContainer>;
}
