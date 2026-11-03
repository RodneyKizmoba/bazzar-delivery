import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { DbOrTx } from "../db";
import { orders, payments, type Order, type PaymentMethod } from "@shared/schema";
import { config } from "../config";
import { conflict } from "./http";

/**
 * Pagamentos.
 * - Numerário na entrega: sempre disponível; fica "pago" quando o estafeta marca a entrega.
 * - Métodos online (Multicaixa Express, Unitel Money, cartão, transferência):
 *     PAYMENTS_MODE=sandbox  → simulação para testes (marcado claramente como SANDBOX);
 *     PAYMENTS_MODE=live     → requer um gateway real configurado (ver docs/PAGAMENTOS.md);
 *     PAYMENTS_MODE=disabled → indisponíveis ("brevemente").
 */
export const ONLINE_METHODS: PaymentMethod[] = ["multicaixa_express", "unitel_money", "card", "bank_transfer"];

export interface MethodInfo { id: PaymentMethod; available: boolean; sandbox: boolean; reason?: string }

function liveGatewayConfigured(): boolean {
  // Ligar aqui o fornecedor real (EMIS/AppyPay/ProxyPay) quando houver credenciais.
  return false;
}

export function paymentMethods(): MethodInfo[] {
  return (["cash", ...ONLINE_METHODS] as PaymentMethod[]).map((id) => {
    if (id === "cash") return { id, available: true, sandbox: false };
    if (config.paymentsMode === "sandbox") return { id, available: true, sandbox: true };
    if (config.paymentsMode === "live" && liveGatewayConfigured()) return { id, available: true, sandbox: false };
    return { id, available: false, sandbox: false, reason: "Brevemente" };
  });
}

export function assertMethodAvailable(method: PaymentMethod) {
  const m = paymentMethods().find((x) => x.id === method);
  if (!m?.available) throw conflict("Este método de pagamento ainda não está disponível. Escolha numerário na entrega.", "PAYMENT_METHOD_UNAVAILABLE");
}

/** Inicia o pagamento de uma encomenda (dentro da transacção de criação). */
export async function startOrderPayment(db: DbOrTx, order: Order) {
  if (order.paymentMethod === "cash") {
    await db.insert(payments).values({
      orderId: order.id, userId: order.customerId, amount: order.total, method: "cash", provider: "cash", status: "pending",
    });
    return { status: "pending" as const };
  }
  assertMethodAvailable(order.paymentMethod);
  if (config.paymentsMode === "sandbox") {
    const ref = `SANDBOX-${randomBytes(6).toString("hex").toUpperCase()}`;
    await db.insert(payments).values({
      orderId: order.id, userId: order.customerId, amount: order.total, method: order.paymentMethod,
      provider: "sandbox", status: "paid", providerReference: ref,
    });
    await db.update(orders).set({ paymentStatus: "paid" }).where(eq(orders.id, order.id));
    return { status: "paid" as const, reference: ref };
  }
  throw conflict("Gateway de pagamento não configurado.", "PAYMENT_GATEWAY_MISSING");
}

/** Marca reembolso quando uma encomenda paga online é cancelada. */
export async function refundOrderPayment(db: DbOrTx, order: Order) {
  if (order.paymentStatus !== "paid") {
    await db.update(payments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(payments.orderId, order.id));
    return;
  }
  // Em sandbox o reembolso é imediato; num gateway real seria pedido ao fornecedor.
  await db.update(payments).set({ status: "refunded", updatedAt: new Date() }).where(eq(payments.orderId, order.id));
  await db.update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, order.id));
}

/** Pagamento da subscrição Plus (sandbox ativa de imediato). */
export async function chargeSubscription(db: DbOrTx, userId: number, subscriptionId: number, method: PaymentMethod) {
  if (method === "cash") throw conflict("A subscrição não pode ser paga em numerário. Escolha um método online ou peça ativação ao suporte.", "PLUS_CASH");
  assertMethodAvailable(method);
  if (config.paymentsMode !== "sandbox") throw conflict("Gateway de pagamento não configurado.", "PAYMENT_GATEWAY_MISSING");
  const ref = `SANDBOX-${randomBytes(6).toString("hex").toUpperCase()}`;
  await db.insert(payments).values({
    subscriptionId, userId, amount: config.plusMonthlyPrice, method, provider: "sandbox", status: "paid", providerReference: ref,
  });
  return ref;
}
