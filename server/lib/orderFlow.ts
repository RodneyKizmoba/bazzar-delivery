import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, type DbOrTx } from "../db";
import {
  addresses, orderEvents, orderItems, orders, pointsLedger, promoCodes, stores, users,
  type CartLine, type Order, type OrderStatus, type PaymentMethod, type User,
} from "@shared/schema";
import { config } from "../config";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { assertDailyCapacity, assertStoreCanTakeOrder, buildQuote, validateSchedule } from "./pricing";
import { assertMethodAvailable, refundOrderPayment, startOrderPayment } from "./payments";
import { notifyOrderStatus } from "./notify";
import { notifyExternalDispatch } from "./dispatch";
import { sendPosWebhook } from "./pos";
import { publishOffer, publishOrder } from "./realtime";
import { assertNotReservedForOther, closeOffersOnClaim, dispatchTimes } from "./dispatchEngine";

export type Actor = { kind: "customer" | "store" | "driver" | "admin" | "system"; userId?: number };

/** Transições permitidas por tipo de ator. */
const TRANSITIONS: Record<Actor["kind"], Partial<Record<OrderStatus, OrderStatus[]>>> = {
  customer: { scheduled: ["cancelled"], pending: ["cancelled"], accepted: ["cancelled"] },
  store: { scheduled: ["rejected"], pending: ["accepted", "rejected"], accepted: ["preparing", "rejected"], preparing: ["ready"] },
  driver: { ready: ["picked_up"], picked_up: ["delivered"] },
  admin: {
    scheduled: ["pending", "cancelled"], pending: ["accepted", "rejected", "cancelled"], accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"], ready: ["picked_up", "cancelled"], picked_up: ["delivered", "cancelled"],
  },
  system: { scheduled: ["pending"] },
};

export function canTransition(actor: Actor["kind"], from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `PJ-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function addPoints(tx: DbOrTx, userId: number, delta: number, reason: string, orderId?: number) {
  if (!delta) return;
  await tx.update(users).set({ loyaltyPoints: sql`${users.loyaltyPoints} + ${delta}` }).where(eq(users.id, userId));
  await tx.insert(pointsLedger).values({ userId, delta, reason, orderId });
}

export interface CreateOrderInput {
  user: User;
  storeId: number;
  lines: (CartLine & { addedBy?: string | null })[];
  addressId: number;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  scheduledFor?: Date | null;
  promoCode?: string | null;
  usePoints?: number;
  groupOrderId?: number | null;
  priority?: boolean;
  riderTip?: number;
  cutlery?: boolean;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  assertMethodAvailable(input.paymentMethod);

  if (input.user.userType !== "customer" && input.user.userType !== "admin") {
    throw forbidden("Só contas de cliente podem fazer encomendas.");
  }
  const created = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.user.id)).for("update");
    const [addr] = await tx.select().from(addresses).where(eq(addresses.id, input.addressId));
    if (!addr || addr.userId !== user.id) throw badRequest("Morada inválida.", "INVALID_ADDRESS");

    if (input.priority && input.scheduledFor) {
      throw badRequest("A entrega prioritária não se aplica a encomendas agendadas.", "PRIORITY_NOT_FOR_SCHEDULED");
    }
    const quote = await buildQuote(tx, {
      storeId: input.storeId, lines: input.lines, user, promoCode: input.promoCode, usePoints: input.usePoints,
      priority: !!input.priority, riderTip: input.riderTip ?? 0,
    });
    const store = quote.store;
    validateSchedule(input.scheduledFor ?? null, store);
    assertStoreCanTakeOrder(store, input.scheduledFor ?? null);
    await tx.execute(sql`select pg_advisory_xact_lock(${store.id})`); // evita ultrapassar a capacidade diária em pedidos simultâneos
    await assertDailyCapacity(tx, store, input.scheduledFor ?? new Date());
    if (store.zonesServed.length > 0 && !store.zonesServed.some((z) => z.toLowerCase() === addr.zone.toLowerCase())) {
      throw conflict(`${store.name} não entrega na zona "${addr.zone}".`, "ZONE_NOT_SERVED");
    }

    const now = new Date();
    const etaMin = input.priority ? Math.max(10, store.deliveryTimeMin - config.priorityMinutesSaved) : store.deliveryTimeMin;
    const etaBase = input.scheduledFor ?? new Date(now.getTime() + etaMin * 60_000);
    const [order] = await tx.insert(orders).values({
      orderNumber: newOrderNumber(),
      customerId: user.id,
      storeId: store.id,
      groupOrderId: input.groupOrderId ?? null,
      status: input.scheduledFor ? "scheduled" : "pending",
      scheduledFor: input.scheduledFor ?? null,
      deliveryAddress: {
        label: addr.label, street: addr.street, zone: addr.zone, city: addr.city,
        reference: addr.reference, latitude: addr.latitude, longitude: addr.longitude,
      },
      notes: input.notes || null,
      subtotal: quote.subtotal,
      deliveryFee: quote.deliveryFee,
      priorityFee: quote.priorityFee,
      riderTip: quote.riderTip,
      cutlery: !!input.cutlery,
      discount: quote.discount + quote.pointsDiscount,
      pointsRedeemed: quote.pointsRedeemed,
      total: quote.total,
      promoCode: quote.promo?.code ?? null,
      paymentMethod: input.paymentMethod,
      estimatedDeliveryAt: etaBase,
    }).returning();

    await tx.insert(orderItems).values(quote.lines.map((l, i) => ({
      orderId: order.id,
      menuItemId: l.menuItem.id,
      name: l.menuItem.name,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      selectedOptions: l.selectedOptions,
      specialInstructions: l.specialInstructions,
      addedBy: input.lines[i]?.addedBy ?? null,
    })));
    await tx.insert(orderEvents).values({ orderId: order.id, status: order.status, actorId: user.id, note: "Encomenda criada" });

    if (quote.promo) {
      // incremento atómico: nunca ultrapassa maxUses mesmo com pedidos simultâneos
      const [claimed] = await tx.update(promoCodes).set({ usedCount: sql`${promoCodes.usedCount} + 1` })
        .where(and(eq(promoCodes.id, quote.promo.id), sql`(${promoCodes.maxUses} is null or ${promoCodes.usedCount} < ${promoCodes.maxUses})`))
        .returning({ id: promoCodes.id });
      if (!claimed) throw badRequest("Este código já atingiu o limite de utilizações.", "PROMO_EXHAUSTED");
    }
    if (quote.pointsRedeemed > 0) await addPoints(tx, user.id, -quote.pointsRedeemed, "order_redeemed", order.id);

    await startOrderPayment(tx, order);
    const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id));
    return fresh;
  });

  void sendPosWebhook(created.storeId, "order.created", created.id);
  publishOrder(created, "created");
  return created;
}

/** Mudança de estado com bloqueio de linha, validação de transição e efeitos colaterais. */
export async function changeStatus(orderId: number, to: OrderStatus, actor: Actor, note?: string | null, opts: { prepMinutes?: number } = {}): Promise<Order> {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw notFound("Encomenda não encontrada");

    // permissões de propriedade
    if (actor.kind === "customer" && order.customerId !== actor.userId) throw forbidden();
    if (actor.kind === "driver" && order.driverId !== actor.userId) throw forbidden("Esta entrega não está atribuída a si.");
    if (actor.kind === "store") {
      const [store] = await tx.select().from(stores).where(eq(stores.id, order.storeId));
      if (!store || store.ownerId !== actor.userId) throw forbidden();
    }
    if (actor.kind === "driver" && to === "picked_up" && !order.driverId) throw conflict("Aceite a entrega primeiro.");

    if (!canTransition(actor.kind, order.status, to)) {
      if (actor.kind === "customer" && to === "cancelled") {
        throw conflict("A loja já começou a preparar a encomenda; já não é possível cancelar. Contacte o suporte.", "NOT_CANCELLABLE");
      }
      throw conflict(`Não é possível passar de "${order.status}" para "${to}".`, "INVALID_TRANSITION");
    }

    const now = new Date();
    const patch: Partial<Order> = { status: to, updatedAt: now };
    if (to === "cancelled" || to === "rejected") patch.cancelReason = note || null;
    if (to === "delivered") {
      patch.deliveredAt = now;
      if (order.paymentMethod === "cash") patch.paymentStatus = "paid";
    }
    if (to === "accepted") {
      const [store] = await tx.select().from(stores).where(eq(stores.id, order.storeId));
      if (store) {
        // a loja diz quanto tempo precisa para ESTA encomenda; o estafeta é chamado para chegar a essa hora
        const prep = opts.prepMinutes ?? store.prepTimeMin;
        const rideMin = Math.max(10, store.deliveryTimeMin - store.prepTimeMin);
        let readyAt = new Date(now.getTime() + prep * 60_000);
        if (order.scheduledFor) {
          const wanted = new Date(order.scheduledFor.getTime() - rideMin * 60_000);
          if (wanted > readyAt) readyAt = wanted;
        } else {
          patch.estimatedDeliveryAt = new Date(readyAt.getTime() + rideMin * 60_000);
        }
        patch.prepMinutes = prep;
        Object.assign(patch, dispatchTimes(now, readyAt, order.priorityFee > 0));
      }
    }
    if (to === "ready") {
      // pronta mais cedo (ou à hora): procurar estafeta já
      if (!order.readyEstimateAt || order.readyEstimateAt > now) patch.readyEstimateAt = now;
      if (!order.dispatchAt || order.dispatchAt > now) patch.dispatchAt = now;
      if (!order.scheduledFor && order.readyEstimateAt && order.readyEstimateAt > now && order.estimatedDeliveryAt) {
        // pronta antes do previsto: a hora de chegada do cliente também avança
        patch.estimatedDeliveryAt = new Date(order.estimatedDeliveryAt.getTime() - (order.readyEstimateAt.getTime() - now.getTime()));
      }
    }
    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, order.id)).returning();
    await tx.insert(orderEvents).values({ orderId: order.id, status: to, actorId: actor.userId ?? null, note: note || null });

    if (to === "delivered") {
      if (order.paymentMethod === "cash") {
        await tx.execute(sql`update payments set status = 'paid', updated_at = now() where order_id = ${order.id}`);
      }
      const earned = Math.floor(order.total / config.kzPerPointEarned);
      await addPoints(tx, order.customerId, earned, "order_earned", order.id);
      // bónus de convite: primeira entrega do convidado
      const [cust] = await tx.select().from(users).where(eq(users.id, order.customerId));
      if (cust?.referredBy) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders)
          .where(and(eq(orders.customerId, cust.id), eq(orders.status, "delivered"), ne(orders.id, order.id)));
        if (n === 0) await addPoints(tx, cust.referredBy, config.referralBonusPoints, "referral_bonus", order.id);
      }
    }
    if (to === "cancelled" || to === "rejected") {
      if (order.pointsRedeemed > 0) await addPoints(tx, order.customerId, order.pointsRedeemed, "refund", order.id);
      if (order.promoCode) {
        await tx.update(promoCodes).set({ usedCount: sql`greatest(${promoCodes.usedCount} - 1, 0)` }).where(eq(promoCodes.code, order.promoCode));
      }
      await refundOrderPayment(tx, order);
    }
    return updated;
  });

  // efeitos externos (fora da transacção, nunca bloqueiam)
  const [cust] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, result.customerId));
  if (cust) notifyOrderStatus(cust.phone, result.orderNumber, to);
  void sendPosWebhook(result.storeId, "order.status_changed", result.id);
  publishOrder(result);
  if (to === "ready") {
    const [store] = await db.select().from(stores).where(eq(stores.id, result.storeId));
    if (store) {
      const ext = await notifyExternalDispatch(result, store, cust?.phone ?? "");
      if (ext) await db.update(orders).set({ externalDispatchId: ext }).where(eq(orders.id, result.id));
    }
  }
  return result;
}

/** Estafeta aceita uma entrega disponível (sem corrida entre estafetas). */
export async function claimDelivery(orderId: number, driverId: number): Promise<Order> {
  const claimed = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, driverId)).for("update");
    const [active] = await tx.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.driverId, driverId), inArray(orders.status, ["accepted", "preparing", "ready", "picked_up"])));
    if (active) throw conflict("Já tem uma entrega em curso. Termine-a antes de aceitar outra.", "DRIVER_BUSY");
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
    await assertNotReservedForOther(tx, orderId, driverId);
    const [updated] = await tx.update(orders)
      .set({ driverId, driverAssignedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), sql`${orders.driverId} is null`, inArray(orders.status, ["accepted", "preparing", "ready"])))
      .returning();
    if (!updated) throw conflict("Esta entrega já não está disponível.", "NOT_AVAILABLE");
    await tx.insert(orderEvents).values({ orderId, status: updated.status, actorId: driverId, note: "Estafeta atribuído" });
    const gone = await closeOffersOnClaim(tx, orderId, driverId);
    return { updated, gone };
  });
  for (const g of claimed.gone) publishOffer(g.driverId, orderId, g.offerId, "gone");
  publishOrder(claimed.updated, "assigned");
  return claimed.updated;
}

/** O estafeta chegou à loja (antes de recolher) ou ao cliente (depois de recolher). */
export async function markArrived(orderId: number, driverId: number, at: "store" | "customer"): Promise<Order> {
  const done = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o || o.driverId !== driverId) throw notFound("Entrega não encontrada");
    const ok = at === "store" ? ["accepted", "preparing", "ready"].includes(o.status) : o.status === "picked_up";
    if (!ok) throw conflict(at === "store" ? "Já recolheu esta encomenda." : "Recolha primeiro a encomenda na loja.", "BAD_STEP");
    const now = new Date();
    const patch = at === "store" ? { driverAtStoreAt: o.driverAtStoreAt ?? now } : { driverAtCustomerAt: o.driverAtCustomerAt ?? now };
    const [updated] = await tx.update(orders).set({ ...patch, updatedAt: now }).where(eq(orders.id, orderId)).returning();
    if (at === "store" ? !o.driverAtStoreAt : !o.driverAtCustomerAt) {
      await tx.insert(orderEvents).values({ orderId, status: o.status, actorId: driverId, note: at === "store" ? "Estafeta chegou à loja" : "Estafeta chegou ao cliente" });
    }
    return updated;
  });
  publishOrder(done, at === "store" ? "at_store" : "at_customer");
  return done;
}

/** A loja precisa de mais tempo: adia "pronto às", a hora prevista e a chamada do estafeta. */
export async function delayPrep(orderId: number, ownerId: number, minutes: number): Promise<Order> {
  const done = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw notFound("Encomenda não encontrada");
    const [store] = await tx.select().from(stores).where(eq(stores.id, o.storeId));
    if (!store || store.ownerId !== ownerId) throw forbidden();
    if (!["accepted", "preparing"].includes(o.status)) throw conflict("Só pode adiar enquanto prepara a encomenda.", "BAD_STEP");
    const now = new Date();
    const base = o.readyEstimateAt && o.readyEstimateAt > now ? o.readyEstimateAt : now;
    const readyAt = new Date(base.getTime() + minutes * 60_000);
    const shift = readyAt.getTime() - (o.readyEstimateAt?.getTime() ?? now.getTime());
    const patch: Partial<Order> = {
      readyEstimateAt: readyAt, prepMinutes: (o.prepMinutes ?? store.prepTimeMin) + minutes, updatedAt: now,
      estimatedDeliveryAt: o.estimatedDeliveryAt && !o.scheduledFor ? new Date(o.estimatedDeliveryAt.getTime() + Math.max(0, shift)) : o.estimatedDeliveryAt,
    };
    if (!o.driverId) Object.assign(patch, { dispatchAt: dispatchTimes(now, readyAt, o.priorityFee > 0).dispatchAt });
    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, orderId)).returning();
    await tx.insert(orderEvents).values({ orderId, status: o.status, actorId: ownerId, note: `Loja precisa de mais ${minutes} min` });
    return updated;
  });
  publishOrder(done, "updated");
  return done;
}

/** Alterar encomenda (itens, morada, notas, hora) enquanto a loja ainda não a aceitou. */
export async function modifyOrder(
  orderId: number, user: User,
  patch: { lines?: CartLine[]; addressId?: number; notes?: string | null; scheduledFor?: Date | null },
): Promise<Order> {
  const modified = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw notFound("Encomenda não encontrada");
    if (order.customerId !== user.id) throw forbidden();
    if (!(config.modifiableStatuses as readonly string[]).includes(order.status)) {
      throw conflict("A loja já aceitou a encomenda; já não é possível alterá-la.", "NOT_MODIFIABLE");
    }
    if (order.paymentStatus === "paid" && patch.lines) {
      throw conflict("Encomendas já pagas online não podem mudar de itens. Cancele e faça uma nova (sem custos).", "PAID_NOT_MODIFIABLE");
    }
    if (order.groupOrderId && patch.lines) throw conflict("Itens de encomendas em grupo não podem ser alterados aqui.");

    const update: Partial<Order> = { updatedAt: new Date() };
    if (patch.notes !== undefined) update.notes = patch.notes || null;

    if (patch.scheduledFor !== undefined) {
      if (order.status === "pending" && patch.scheduledFor) throw conflict("A encomenda já foi enviada à loja; não pode ser agendada.");
      if (order.status === "scheduled") {
        if (!patch.scheduledFor) throw badRequest("Indique a nova hora de entrega.");
        const [store] = await tx.select().from(stores).where(eq(stores.id, order.storeId));
        validateSchedule(patch.scheduledFor, store);
        assertStoreCanTakeOrder(store, patch.scheduledFor);
        await assertDailyCapacity(tx, store, patch.scheduledFor, order.id);
        update.scheduledFor = patch.scheduledFor;
        update.estimatedDeliveryAt = patch.scheduledFor;
      }
    }

    if (patch.addressId) {
      const [addr] = await tx.select().from(addresses).where(eq(addresses.id, patch.addressId));
      if (!addr || addr.userId !== user.id) throw badRequest("Morada inválida.");
      const [store] = await tx.select().from(stores).where(eq(stores.id, order.storeId));
      if (store.zonesServed.length > 0 && !store.zonesServed.some((z) => z.toLowerCase() === addr.zone.toLowerCase())) {
        throw conflict(`${store.name} não entrega na zona "${addr.zone}".`, "ZONE_NOT_SERVED");
      }
      update.deliveryAddress = {
        label: addr.label, street: addr.street, zone: addr.zone, city: addr.city,
        reference: addr.reference, latitude: addr.latitude, longitude: addr.longitude,
      };
    }

    if (patch.lines) {
      // Recalcular preço; mantém o mesmo código promocional se continuar válido (ignora limite de uso desta encomenda)
      const [freshUser] = await tx.select().from(users).where(eq(users.id, user.id));
      const quote = await buildQuote(tx, { storeId: order.storeId, lines: patch.lines, user: { ...freshUser, loyaltyPoints: 0 }, promoCode: null });
      let discount = 0;
      if (order.promoCode) {
        const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, order.promoCode));
        if (promo && quote.subtotal >= promo.minOrder) {
          discount = promo.discountType === "percent"
            ? Math.min(Math.floor((quote.subtotal * promo.value) / 100), promo.maxDiscount ?? Infinity)
            : promo.discountType === "fixed" ? Math.min(promo.value, quote.subtotal) : quote.deliveryFee;
        }
      }
      // pontos: respeitar o limite percentual e devolver os pontos que deixam de ser usados
      const remaining = Math.max(0, quote.subtotal + quote.deliveryFee - discount);
      const capKz = Math.floor((remaining * config.maxPointsDiscountPct) / 100);
      const keepPoints = Math.min(order.pointsRedeemed, Math.floor(capKz / config.pointValueKz));
      const pointsDiscount = keepPoints * config.pointValueKz;
      if (keepPoints < order.pointsRedeemed) {
        await addPoints(tx, order.customerId, order.pointsRedeemed - keepPoints, "refund", order.id);
        update.pointsRedeemed = keepPoints;
      }
      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
      await tx.insert(orderItems).values(quote.lines.map((l) => ({
        orderId: order.id, menuItemId: l.menuItem.id, name: l.menuItem.name, unitPrice: l.unitPrice,
        quantity: l.quantity, selectedOptions: l.selectedOptions, specialInstructions: l.specialInstructions,
      })));
      update.subtotal = quote.subtotal;
      update.deliveryFee = quote.deliveryFee;
      update.discount = discount + pointsDiscount;
      update.total = Math.max(0, quote.subtotal + quote.deliveryFee - discount - pointsDiscount) + order.priorityFee + order.riderTip;
      await tx.execute(sql`update payments set amount = ${update.total}, updated_at = now() where order_id = ${order.id}`);
    }

    const [updated] = await tx.update(orders).set(update).where(eq(orders.id, order.id)).returning();
    await tx.insert(orderEvents).values({ orderId: order.id, status: updated.status, actorId: user.id, note: "Encomenda alterada pelo cliente" });
    return updated;
  });
  publishOrder(modified, "updated");
  return modified;
}

/** Liberta encomendas agendadas para a loja quando falta o tempo de preparação + 15 min. */
export async function releaseScheduledOrders(): Promise<number> {
  const due = await db.select({ id: orders.id, scheduledFor: orders.scheduledFor, prep: stores.prepTimeMin })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.status, "scheduled"), lte(orders.scheduledFor, sql`now() + interval '3 hours'`)));
  let n = 0;
  for (const o of due) {
    if (!o.scheduledFor) continue;
    const releaseAt = o.scheduledFor.getTime() - (o.prep + 15) * 60_000;
    if (releaseAt <= Date.now()) {
      try {
        await changeStatus(o.id, "pending", { kind: "system" }, "Agendamento libertado para a loja");
        n++;
      } catch (e) {
        console.warn("[scheduler] não libertou", o.id, (e as Error).message);
      }
    }
  }
  return n;
}

/** A loja confirma uma encomenda agendada (ex.: bolo para daqui a 2 dias) sem a pôr já em preparação. */
export async function confirmScheduled(orderId: number, ownerId: number): Promise<Order> {
  const confirmed = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw notFound("Encomenda não encontrada");
    const [store] = await tx.select().from(stores).where(eq(stores.id, order.storeId));
    if (!store || store.ownerId !== ownerId) throw forbidden();
    if (order.status !== "scheduled") throw conflict("Só encomendas agendadas podem ser confirmadas antecipadamente.", "INVALID_TRANSITION");
    if (order.storeConfirmedAt) return order;
    const [updated] = await tx.update(orders).set({ storeConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    await tx.insert(orderEvents).values({ orderId: order.id, status: "scheduled", actorId: ownerId, note: "Confirmada pela loja" });
    return updated;
  });
  publishOrder(confirmed, "updated");
  return confirmed;
}
