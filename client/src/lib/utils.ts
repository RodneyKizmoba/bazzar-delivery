import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-AO', {
    style: 'currency',
    currency: 'AOA',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-AO').format(value);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function getInitials(name: string): string {
  if (!name) return '';

  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function getRandomDeliveryTime(min = 15, max = 45): string {
  const start = Math.floor(min / 5) * 5;
  const end = Math.ceil(max / 5) * 5;
  return `${start}-${end} min`;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return parseFloat(d.toFixed(1));
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

export function calculateDeliveryFee(distance: number, basePrice: number = 300): number {
  const rate = 100; // AOA per km
  return basePrice + Math.round(distance * rate);
}

export function getDeliveryStatus(status: string): { label: string; color: string } {
  const statusMap: Record<string, { label: string; color: string }> = {
    'pending': { label: 'Pendente', color: 'bg-yellow-500' },
    'confirmed': { label: 'Confirmado', color: 'bg-blue-500' },
    'preparing': { label: 'Preparando', color: 'bg-blue-500' },
    'ready': { label: 'Pronto', color: 'bg-blue-500' },
    'delivering': { label: 'Em Entrega', color: 'bg-secondary' },
    'delivered': { label: 'Entregue', color: 'bg-secondary' },
    'cancelled': { label: 'Cancelado', color: 'bg-red-500' },
  };

  return statusMap[status] || { label: 'Desconhecido', color: 'bg-gray-500' };
}
