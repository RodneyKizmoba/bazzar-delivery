import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Pt = { latitude: number; longitude: number } | null | undefined;

const icon = (emoji: string, bg: string) => L.divIcon({
  className: "",
  html: `<div style="background:${bg};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${emoji}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const STORE = icon("🏪", "#C2410C");
const HOME = icon("🏠", "#15803D");
const RIDER = icon("🛵", "#1D4ED8");

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [key]);
  return null;
}

/** Mapa de acompanhamento: loja, destino e posição do estafeta (OpenStreetMap). */
export function OrderMap({ store, destination, driver, labels, className }: {
  store?: Pt; destination?: Pt; driver?: Pt;
  labels?: { store?: string; destination?: string; driver?: string };
  className?: string;
}) {
  const pts: [number, number][] = [store, driver, destination]
    .filter((p): p is { latitude: number; longitude: number } => !!p && p.latitude != null && p.longitude != null)
    .map((p) => [p.latitude, p.longitude]);
  if (!pts.length) return null;
  return (
    <div className={className ?? "h-64 w-full overflow-hidden rounded-xl border"}>
      <MapContainer center={pts[0]} zoom={14} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }} attributionControl>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
        {store && <Marker position={[store.latitude, store.longitude]} icon={STORE}>{labels?.store && <Tooltip>{labels.store}</Tooltip>}</Marker>}
        {destination && <Marker position={[destination.latitude, destination.longitude]} icon={HOME}>{labels?.destination && <Tooltip>{labels.destination}</Tooltip>}</Marker>}
        {driver && <Marker position={[driver.latitude, driver.longitude]} icon={RIDER}>{labels?.driver && <Tooltip permanent>{labels.driver}</Tooltip>}</Marker>}
        {driver && destination && <Polyline positions={[[driver.latitude, driver.longitude], [destination.latitude, destination.longitude]]} pathOptions={{ color: "#1D4ED8", dashArray: "6 8" }} />}
        <Fit points={pts} />
      </MapContainer>
    </div>
  );
}
