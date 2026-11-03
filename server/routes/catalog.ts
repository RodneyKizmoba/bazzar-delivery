import { Router } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  favorites, menuItems, menuSections, optionGroups, options, reviews, stores, users,
  ALLERGENS, DIETARY_TAGS, STORE_TYPES, type Store,
} from "@shared/schema";
import { config } from "../config";
import { ah, idParam, notFound, parse } from "../lib/http";
import { isWithinOpeningHours, maxAheadHoursFor } from "../lib/pricing";
import { paymentMethods } from "../lib/payments";

export const catalogRouter = Router();

export const ZONES = [
  "Talatona", "Kilamba", "Maianga", "Ingombota", "Alvalade", "Maculusso", "Miramar", "Ilha de Luanda",
  "Viana", "Benfica", "Camama", "Cazenga", "Rangel", "Sambizanga", "Morro Bento", "Zango", "Patriota", "Cacuaco",
];

export function storeCard(s: Store, now = new Date()) {
  return {
    id: s.id,
    name: s.name,
    storeType: s.storeType,
    description: s.description,
    cuisines: s.cuisines,
    isChain: s.isChain,
    isHomeBusiness: s.isHomeBusiness,
    minNoticeMin: s.minNoticeMin,
    maxAheadHours: maxAheadHoursFor(s),
    zone: s.zone,
    street: s.street,
    zonesServed: s.zonesServed,
    logoUrl: s.logoUrl,
    coverUrl: s.coverUrl,
    deliveryFee: s.deliveryFee,
    minOrder: s.minOrder,
    deliveryTimeMin: s.deliveryTimeMin,
    ratingAvg: Math.round(s.ratingAvg * 10) / 10,
    ratingCount: s.ratingCount,
    openingTime: s.openingTime,
    closingTime: s.closingTime,
    isOpenNow: s.isOpen && isWithinOpeningHours(s, now),
    latitude: s.latitude,
    longitude: s.longitude,
  };
}

catalogRouter.get("/meta", ah(async (_req, res) => {
  const cuisineRows = await db.execute<{ c: string }>(sql`select distinct unnest(cuisines) as c from stores where is_approved order by 1`);
  res.json({
    storeTypes: STORE_TYPES,
    dietaryTags: DIETARY_TAGS,
    allergens: ALLERGENS,
    zones: ZONES,
    cuisines: cuisineRows.rows.map((r) => r.c),
    paymentMethods: paymentMethods(),
    paymentsMode: config.paymentsMode,
    plus: { monthlyPrice: config.plusMonthlyPrice, freeDeliveryMinOrder: config.plusFreeDeliveryMinOrder },
    schedule: { minLeadMin: config.scheduleMinLeadMin, maxAheadHours: config.scheduleMaxAheadHours },
    points: {
      pointValueKz: config.pointValueKz, kzPerPointEarned: config.kzPerPointEarned, maxDiscountPct: config.maxPointsDiscountPct,
      welcomeBonusPoints: config.welcomeBonusPoints, referralBonusPoints: config.referralBonusPoints,
    },
    welcomeBonusPoints: config.welcomeBonusPoints,
  });
}));

catalogRouter.get("/payment-methods", (_req, res) => res.json({ methods: paymentMethods(), mode: config.paymentsMode }));

const searchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(STORE_TYPES).optional(),
  cuisine: z.string().trim().max(40).optional(),
  dietary: z.string().optional(), // lista separada por vírgulas
  zone: z.string().trim().max(60).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxDeliveryTime: z.coerce.number().int().min(5).max(300).optional(),
  freeDelivery: z.enum(["1", "true"]).optional(),
  openNow: z.enum(["1", "true"]).optional(),
  chain: z.enum(["chain", "independent"]).optional(),
  homeBusiness: z.enum(["1", "true"]).optional(),
  excludeType: z.enum(STORE_TYPES).optional(),
  sort: z.enum(["recommended", "rating", "delivery_time", "delivery_fee", "name"]).default("recommended"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

catalogRouter.get("/stores", ah(async (req, res) => {
  const f = parse(searchSchema, req.query);
  const dietary = (f.dietary || "").split(",").map((s) => s.trim()).filter((s) => (DIETARY_TAGS as readonly string[]).includes(s));
  const conds: SQL[] = [eq(stores.isApproved, true)];

  if (f.type) conds.push(eq(stores.storeType, f.type));
  if (f.cuisine) conds.push(sql`exists (select 1 from unnest(${stores.cuisines}) c where lower(c) = lower(${f.cuisine}))`);
  if (f.zone) conds.push(sql`(cardinality(${stores.zonesServed}) = 0 or exists (select 1 from unnest(${stores.zonesServed}) z where lower(z) = lower(${f.zone})))`);
  if (f.minRating) conds.push(sql`${stores.ratingAvg} >= ${f.minRating}`);
  if (f.maxDeliveryTime) conds.push(sql`${stores.deliveryTimeMin} <= ${f.maxDeliveryTime}`);
  if (f.freeDelivery) conds.push(eq(stores.deliveryFee, 0));
  if (f.chain) conds.push(eq(stores.isChain, f.chain === "chain"));
  if (f.homeBusiness) conds.push(eq(stores.isHomeBusiness, true));
  if (f.excludeType) conds.push(sql`${stores.storeType} <> ${f.excludeType}`);
  for (const tag of dietary) {
    conds.push(sql`exists (select 1 from menu_items mi where mi.store_id = ${stores.id} and mi.is_available and ${tag} = any(mi.dietary_tags))`);
  }
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(
      ilike(stores.name, like),
      ilike(stores.description, like),
      sql`exists (select 1 from unnest(${stores.cuisines}) c where c ilike ${like})`,
      sql`exists (select 1 from menu_items mi where mi.store_id = ${stores.id} and mi.is_available and (mi.name ilike ${like} or mi.description ilike ${like}))`,
    )!);
  }

  const order = {
    recommended: [desc(stores.isOpen), desc(sql`${stores.ratingAvg} * ln(${stores.ratingCount} + 2)`)],
    rating: [desc(stores.ratingAvg), desc(stores.ratingCount)],
    delivery_time: [asc(stores.deliveryTimeMin)],
    delivery_fee: [asc(stores.deliveryFee)],
    name: [asc(stores.name)],
  }[f.sort];

  const rows = await db.select().from(stores).where(and(...conds)).orderBy(...order).limit(f.limit);
  let list = rows.map((s) => storeCard(s));
  if (f.openNow) list = list.filter((s) => s.isOpenNow);

  // pratos que correspondem à pesquisa (para mostrar "Encontrámos: Hambúrguer duplo…")
  let matchingItems: Record<number, { id: number; name: string; price: number }[]> = {};
  if (f.q && list.length) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    const itemConds: SQL[] = [inArray(menuItems.storeId, list.map((s) => s.id)), eq(menuItems.isAvailable, true),
      or(ilike(menuItems.name, like), ilike(menuItems.description, like))!];
    for (const tag of dietary) itemConds.push(sql`${tag} = any(${menuItems.dietaryTags})`);
    const items = await db.select({ id: menuItems.id, name: menuItems.name, price: menuItems.price, storeId: menuItems.storeId })
      .from(menuItems).where(and(...itemConds)).limit(200);
    for (const it of items) (matchingItems[it.storeId] ||= []).push({ id: it.id, name: it.name, price: it.price });
  }

  res.json({ stores: list.map((s) => ({ ...s, matchingItems: matchingItems[s.id]?.slice(0, 3) ?? [] })) });
}));

catalogRouter.get("/stores/:id", ah(async (req, res) => {
  const id = idParam(req);
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  const isOwner = req.user && store && store.ownerId === req.user.id;
  if (!store || (!store.isApproved && !isOwner && req.user?.userType !== "admin")) throw notFound("Loja não encontrada");

  const sections = await db.select().from(menuSections).where(eq(menuSections.storeId, id)).orderBy(asc(menuSections.sortOrder));
  const items = await db.select().from(menuItems).where(eq(menuItems.storeId, id)).orderBy(asc(menuItems.id));
  const itemIds = items.map((i) => i.id);
  const groups = itemIds.length ? await db.select().from(optionGroups).where(inArray(optionGroups.menuItemId, itemIds)).orderBy(asc(optionGroups.sortOrder)) : [];
  const groupIds = groups.map((g) => g.id);
  const opts = groupIds.length ? await db.select().from(options).where(inArray(options.groupId, groupIds)).orderBy(asc(options.id)) : [];

  let isFavorite = false;
  if (req.user) {
    const [fav] = await db.select().from(favorites).where(and(eq(favorites.userId, req.user.id), eq(favorites.storeId, id)));
    isFavorite = !!fav;
  }

  res.json({
    store: { ...storeCard(store), phone: store.phone, isApproved: store.isApproved },
    isFavorite,
    sections,
    items: items.map((i) => ({
      ...i,
      optionGroups: groups.filter((g) => g.menuItemId === i.id).map((g) => ({
        ...g, options: opts.filter((o) => o.groupId === g.id),
      })),
    })),
  });
}));

catalogRouter.get("/stores/:id/reviews", ah(async (req, res) => {
  const id = idParam(req);
  const rows = await db.select({
    id: reviews.id, rating: reviews.rating, comment: reviews.comment, reply: reviews.reply,
    createdAt: reviews.createdAt, repliedAt: reviews.repliedAt, author: users.fullName,
  }).from(reviews).innerJoin(users, eq(users.id, reviews.userId))
    .where(and(eq(reviews.storeId, id), eq(reviews.isPublished, true)))
    .orderBy(desc(reviews.createdAt)).limit(100);
  // mostrar só o primeiro nome do autor (privacidade)
  res.json({ reviews: rows.map((r) => ({ ...r, author: r.author.split(" ")[0] })) });
}));

catalogRouter.get("/popular-items", ah(async (_req, res) => {
  const rows = await db.select({
    id: menuItems.id, name: menuItems.name, price: menuItems.price, imageUrl: menuItems.imageUrl,
    storeId: stores.id, storeName: stores.name, dietaryTags: menuItems.dietaryTags,
  }).from(menuItems).innerJoin(stores, eq(stores.id, menuItems.storeId))
    .where(and(eq(menuItems.isPopular, true), eq(menuItems.isAvailable, true), eq(stores.isApproved, true)))
    .orderBy(desc(stores.ratingAvg)).limit(12);
  res.json({ items: rows });
}));
