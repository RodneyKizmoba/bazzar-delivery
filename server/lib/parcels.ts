import { and, eq } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { db } from "../db";
import { config } from "../config";
import { orderEvents, orders, stores, type Order, type ParcelSize, type PaymentMethod, type User } from "@shared/schema";
import { badRequest, forbidden } from "./http";
import { assertMethodAvailable, startOrderPayment } from "./payments";
import { currentBusyLevel, customerDeliveryFee, riderPayFor, roadKm } from "./fees";
import { dispatchTimes, advanceOrder } from "./dispatchEngine";
import { publishOrder } from "./realtime";

/**
 * Envios: o cliente manda um pacote da morada A (quem envia) para a morada B (quem recebe).
 * Cada envio é uma encomenda (kind "parcel") da loja interna "PedeJá Envios": usa o mesmo despacho,
 * a mesma app do estafeta, o mesmo código de entrega e as mesmas contas. Não há loja a aceitar:
 * o envio nasce "pronto" e o despacho procura logo o estafeta mais perto do ponto de recolha.
 * Preço: a taxa de entrega normal por distância + um extra por tamanho (médio/grande);
 * parte do extra vai para o estafeta (PARCEL_RIDER_SHARE_PCT). O resto fica para a PedeJá.
 */

const SYSTEM_STORE = "PedeJá Envios";
let cachedStoreId: number | null = null;

/** A loja interna dos envios (criada uma vez; nunca aparece aos clientes nem na lista de lojas). */
export async function parcelStoreId() {
  if (cachedStoreId) return cachedStoreId;
  const [found] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.isSystem, true), eq(stores.name, SYSTEM_STORE)));
  if (found) return (cachedStoreId = found.id);
  const [s] = await db.insert(stores).values({
    name: SYSTEM_STORE, storeType: "other", isSystem: true, isApproved: false, ownerId: null,
    description: "Envios de pacotes entre clientes (loja interna).", phone: "+244900000000", street: "—", zone: "Luanda",
    deliveryFee: 0, prepTimeMin: 0, deliveryTimeMin: 45, cuisines: [],
  }).returning({ id: stores.id });
  return (cachedStoreId = s.id);
}

export function sizeFeeFor(size: ParcelSize) {
  return size === "large" ? config.parcelLargeFee : size === "medium" ? config.parcelMediumFee : 0;
}

type Point = { label: string; street?: string; zone?: string; reference?: string | null; latitude: number; longitude: number };

export async function quoteParcel(input: { pickup: Point; dropoff: Point; size: ParcelSize }) {
  const km = Math.round(roadKm(input.pickup, input.dropoff) * 10) / 10;
  if (km < 0.2) throw badRequest("A recolha e a entrega são no mesmo sítio.", "SAME_PLACE");
  if (km > config.dispatchRadiusKm * 6) throw badRequest("Destino demasiado longe para um envio.", "TOO_FAR");
  const busy = await currentBusyLevel(db);
  const sizeFee = sizeFeeFor(input.size);
  // Nos envios não há comissão de comida a pagar o estafeta: o preço cobre sempre o que ele ganha + uma margem.
  const rider = riderPayFor({ pickupKm: 2, dropKm: km, vehicle: input.size === "large" ? "car" : "moto", at: new Date(), busy });
  const riderShare = Math.round((sizeFee * config.parcelRiderSharePct) / 100);
  const floorFee = Math.ceil(((rider.total * (1 + config.parcelMinMarginPct / 100)) + riderShare - sizeFee) / 50) * 50;
  const deliveryFee = Math.max(customerDeliveryFee(km, busy, 1000), floorFee);
  const etaMin = Math.round(15 + (km / 20) * 60); // estafeta chega + viagem a ~20 km/h
  return { km, busyLevel: busy, deliveryFee, sizeFee, total: deliveryFee + sizeFee, etaMin, largeNeedsCar: input.size === "large" };
}

export async function createParcel(user: User, input: {
  pickup: Point; dropoff: Point; size: ParcelSize; senderName: string; senderPhone: string;
  recipientName: string; recipientPhone: string; description: string; fragile: boolean;
  notes?: string | null; riderTip: number; paymentMethod: PaymentMethod;
}): Promise<Order> {
  if (user.userType !== "customer") throw forbidden("Só contas de cliente podem fazer envios.");
  assertMethodAvailable(input.paymentMethod);
  const q = await quoteParcel(input);
  const storeId = await parcelStoreId();
  const now = new Date();
  const created = await db.transaction(async (tx) => {
    const total = q.deliveryFee + q.sizeFee + input.riderTip;
    const [order] = await tx.insert(orders).values({
      orderNumber: `PJ-ENV-${randomBytes(3).toString("hex").toUpperCase()}`,
      customerId: user.id, storeId, kind: "parcel", fulfilment: "delivery",
      status: "ready", // não há loja: o envio está pronto para recolha
      pickupAddress: {
        label: input.pickup.label, street: input.pickup.street || input.pickup.label, zone: input.pickup.zone || "",
        reference: input.pickup.reference ?? null, latitude: input.pickup.latitude, longitude: input.pickup.longitude,
        contactName: input.senderName, contactPhone: input.senderPhone,
      },
      deliveryAddress: {
        label: input.recipientName, street: input.dropoff.street || input.dropoff.label, zone: input.dropoff.zone || "",
        city: "Luanda", reference: input.dropoff.reference ?? null, latitude: input.dropoff.latitude, longitude: input.dropoff.longitude,
      },
      parcel: { size: input.size, description: input.description, recipientName: input.recipientName, recipientPhone: input.recipientPhone, fragile: input.fragile, sizeFee: q.sizeFee },
      notes: input.notes || null,
      // o extra de tamanho entra como taxa de serviço (fica para a PedeJá; a parte do estafeta vai no pagamento dele)
      subtotal: 0, deliveryFee: q.deliveryFee, serviceFee: q.sizeFee, smallOrderFee: 0, deliveryKm: q.km, busyLevel: q.busyLevel,
      riderTip: input.riderTip, total, paymentMethod: input.paymentMethod,
      estimatedDeliveryAt: new Date(now.getTime() + q.etaMin * 60_000),
      deliveryPin: String(randomInt(0, 10000)).padStart(4, "0"), // quem recebe diz o código ao estafeta
      ...dispatchTimes(now, now, true),
    }).returning();
    await tx.insert(orderEvents).values({ orderId: order.id, status: "ready", actorId: user.id, note: "Envio criado: à espera de estafeta para recolha" });
    await startOrderPayment(tx, order);
    const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id));
    return fresh;
  });
  publishOrder(created, "created");
  void advanceOrder(created.id).catch((e) => console.error("[envios]", e));
  return created;
}
