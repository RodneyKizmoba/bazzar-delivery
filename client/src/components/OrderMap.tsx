import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Pt = { latitude: number; longitude: number } | null | undefined;

/**
 * Mapa gratuito: OpenStreetMap. Para muito tráfego (milhares de utilizadores) a política do OSM pede
 * um fornecedor de mosaicos próprio: basta definir VITE_MAP_TILE_URL (ex.: MapTiler, Stadia, Thunderforest).
 */
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const icon = (emoji: string, bg: string) => L.divIcon({
  className: "",
  html: `<div style="background:${bg};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${emoji}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const STORE = icon("🏪", "#00A99C");
const HOME = icon("🏠", "#15803D");
const RIDER = icon("🛵", "#1D4ED8");
const PICKUP = icon("📍", "#00A99C");
const FLAG = icon("🏁", "#15803D");
const CAR = icon("🚕", "#1D4ED8");
const MOTO = icon("🏍️", "#1D4ED8");

/** Enquadra os pontos ao abrir; depois só volta a enquadrar se o estafeta sair do mapa (não salta a cada posição). */
function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const count = points.length;
  useEffect(() => {
    if (count === 1) map.setView(points[0], 15);
    else if (count > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [count]);
  useEffect(() => {
    if (count > 1 && !points.every((p) => map.getBounds().contains(p))) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [points.map((p) => p.join(",")).join(";")]);
  return null;
}

/** Mapa de acompanhamento: loja, destino e posição do estafeta (OpenStreetMap). */
export function OrderMap({ store, destination, driver, labels, className, ride, lineTo = "destination" }: {
  store?: Pt; destination?: Pt; driver?: Pt;
  labels?: { store?: string; destination?: string; driver?: string };
  className?: string;
  /** viagem de táxi: partida (📍), destino (🏁) e carro/mota */
  ride?: "car" | "moto";
  /** linha tracejada do estafeta/motorista até: destino (por defeito) ou ponto de recolha */
  lineTo?: "destination" | "store";
}) {
  const [S, D, R] = ride ? [PICKUP, FLAG, ride === "moto" ? MOTO : CAR] : [STORE, HOME, RIDER];
  const pts: [number, number][] = [store, driver, destination]
    .filter((p): p is { latitude: number; longitude: number } => !!p && p.latitude != null && p.longitude != null)
    .map((p) => [p.latitude, p.longitude]);
  if (!pts.length) return null;
  return (
    <div className={className ?? "h-64 w-full overflow-hidden rounded-xl border"}>
      <MapContainer center={pts[0]} zoom={14} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }} attributionControl>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {store && <Marker position={[store.latitude, store.longitude]} icon={S}>{labels?.store && <Tooltip>{labels.store}</Tooltip>}</Marker>}
        {destination && <Marker position={[destination.latitude, destination.longitude]} icon={D}>{labels?.destination && <Tooltip>{labels.destination}</Tooltip>}</Marker>}
        {driver && <Marker position={[driver.latitude, driver.longitude]} icon={R}>{labels?.driver && <Tooltip permanent>{labels.driver}</Tooltip>}</Marker>}
        {(() => {
          const to = lineTo === "store" ? store : destination;
          const from = driver ?? (ride ? store : null);
          return from && to && from !== to
            ? <Polyline positions={[[from.latitude, from.longitude], [to.latitude, to.longitude]]} pathOptions={{ color: "#1D4ED8", dashArray: "6 8" }} />
            : null;
        })()}
        <Fit points={pts} />
      </MapContainer>
    </div>
  );
}

function ClickToMove({ onPick }: { onPick: (p: { latitude: number; longitude: number }) => void }) {
  const map = useMap();
  useEffect(() => {
    const h = (e: L.LeafletMouseEvent) => onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    map.on("click", h);
    return () => { map.off("click", h); };
  }, [map, onPick]);
  return null;
}
function Recenter({ at }: { at: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(at, Math.max(map.getZoom(), 16)); }, [at[0], at[1]]);
  return null;
}

const LUANDA: [number, number] = [-8.8383, 13.2344];

/** Escolher um ponto no mapa: tocar no mapa ou arrastar o pino (mapa gratuito OpenStreetMap). */
export function PinPicker({ value, onChange, emoji = "📍", className }: {
  value: { latitude: number; longitude: number } | null;
  onChange: (p: { latitude: number; longitude: number }) => void;
  emoji?: string; className?: string;
}) {
  const at: [number, number] = value ? [value.latitude, value.longitude] : LUANDA;
  return (
    <div className={className ?? "h-56 w-full overflow-hidden rounded-xl border"}>
      <MapContainer center={at} zoom={value ? 16 : 12} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {value && (
          <Marker position={at} icon={icon(emoji, "#00CCBC")} draggable
            eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onChange({ latitude: ll.lat, longitude: ll.lng }); } }} />
        )}
        <ClickToMove onPick={onChange} />
        {value && <Recenter at={at} />}
      </MapContainer>
    </div>
  );
}
