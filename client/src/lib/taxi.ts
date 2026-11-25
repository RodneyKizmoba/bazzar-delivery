import type { Tr } from "@/lib/i18n";

export type RideCategory = "moto" | "economy" | "comfort" | "xl";
export type RideStatus = "searching" | "accepted" | "arrived" | "in_progress" | "completed" | "cancelled" | "no_driver";
export interface Place { label: string; latitude: number; longitude: number; zone?: string | null }
export interface FareDetail {
  category: RideCategory; km: number; minutes: number; minFare: number; includedKm: number; includedMin: number;
  perKm: number; perMin: number; distance: number; time: number; surge: number; surgeAmount: number;
  pickupFee: number; stops: number; stopFee: number; rounding: number; total: number;
}
export interface Vehicle { make: string; model: string; colour: string; plate: string; category: RideCategory }

export const CATEGORY: Record<RideCategory, Tr & { icon: string; sub: Tr; seats: number }> = {
  moto: { pt: "Mota", en: "Moto", fr: "Moto", icon: "🏍️", seats: 1,
    sub: { pt: "Rápida no trânsito · 1 pessoa", en: "Beats traffic · 1 person", fr: "Rapide dans les bouchons · 1 personne" } },
  economy: { pt: "Económica", en: "Economy", fr: "Économique", icon: "🚕", seats: 4,
    sub: { pt: "O preço mais em conta · até 4", en: "Best price · up to 4", fr: "Meilleur prix · jusqu'à 4" } },
  comfort: { pt: "Conforto", en: "Comfort", fr: "Confort", icon: "🚘", seats: 4,
    sub: { pt: "Carros mais novos e espaçosos", en: "Newer, roomier cars", fr: "Voitures récentes et spacieuses" } },
  xl: { pt: "XL", en: "XL", fr: "XL", icon: "🚐", seats: 6,
    sub: { pt: "Até 6 pessoas ou malas", en: "Up to 6 people or bags", fr: "Jusqu'à 6 personnes ou bagages" } },
};

export const RIDE_STATUS: Record<RideStatus, Tr> = {
  searching: { pt: "À procura de motorista", en: "Finding a driver", fr: "Recherche d'un chauffeur" },
  accepted: { pt: "Motorista a caminho", en: "Driver on the way", fr: "Chauffeur en route" },
  arrived: { pt: "O motorista chegou", en: "Your driver has arrived", fr: "Le chauffeur est arrivé" },
  in_progress: { pt: "Em viagem", en: "On your trip", fr: "En course" },
  completed: { pt: "Viagem concluída", en: "Trip completed", fr: "Course terminée" },
  cancelled: { pt: "Viagem cancelada", en: "Trip cancelled", fr: "Course annulée" },
  no_driver: { pt: "Sem motoristas disponíveis", en: "No drivers available", fr: "Aucun chauffeur disponible" },
};

export const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace(".", ",")} km`);

export function km(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Abre o Google Maps com o caminho até ao ponto (no telemóvel abre a app). */
export const directionsUrl = (p: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=driving`;
