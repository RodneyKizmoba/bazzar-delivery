import { Router, type Request } from "express";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { orders } from "@shared/schema";
import { config } from "../config";
import { ah, HttpError, parse } from "../lib/http";
import { changeStatus } from "../lib/orderFlow";

export const webhookRouter = Router();

function checkSecret(req: Request, expected: string) {
  if (!expected) throw new HttpError(503, "Webhook não configurado", "WEBHOOK_DISABLED");
  const got = Buffer.from(String(req.header("x-webhook-secret") || ""));
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) throw new HttpError(401, "Assinatura inválida", "BAD_SIGNATURE");
}

/**
 * Actualizações do portal externo de estafetas (opcional).
 * Cabeçalho obrigatório: X-Webhook-Secret = DRIVER_WEBHOOK_SECRET
 */
webhookRouter.post("/driver-portal", ah(async (req, res) => {
  checkSecret(req, config.driverWebhookSecret);
  const body = parse(z.object({
    orderId: z.number().int().positive(),
    status: z.enum(["picked_up", "delivered"]).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }), req.body);
  if (body.latitude != null && body.longitude != null) {
    await db.update(orders).set({ driverLatitude: body.latitude, driverLongitude: body.longitude, driverLocationAt: new Date() })
      .where(eq(orders.id, body.orderId));
  }
  if (body.status) await changeStatus(body.orderId, body.status, { kind: "admin" }, "Actualizado pelo portal de estafetas");
  res.json({ ok: true });
}));

/**
 * Notificações do gateway de pagamento (quando for ligado um fornecedor real).
 * Por agora apenas verifica a assinatura e responde 501.
 */
webhookRouter.post("/payments", ah(async (req, res) => {
  checkSecret(req, config.paymentWebhookSecret);
  res.status(501).json({ message: "Integração do gateway ainda por ligar" });
}));
