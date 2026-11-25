import { Router } from "express";
import { parcelCreateSchema, parcelQuoteSchema } from "@shared/schema";
import { ah, parse } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { createParcel, quoteParcel } from "../lib/parcels";

/** Envios: preço (sem login) e criar um envio (cliente). O seguimento usa as rotas normais das encomendas. */
export const parcelsRouter = Router();

parcelsRouter.post("/quote", ah(async (req, res) => {
  res.json(await quoteParcel(parse(parcelQuoteSchema, req.body)));
}));

parcelsRouter.post("/", requireAuth, ah(async (req, res) => {
  const order = await createParcel(req.user!, parse(parcelCreateSchema, req.body));
  res.status(201).json({ order: { id: order.id, orderNumber: order.orderNumber, total: order.total, status: order.status } });
}));
