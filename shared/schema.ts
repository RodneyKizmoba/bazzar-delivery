import {
  pgTable, serial, integer, text, timestamp, boolean, jsonb, real, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userTypeEnum = pgEnum("user_type", ["customer", "supplier", "driver", "admin"]);
export const storeTypeEnum = pgEnum("store_type", [
  "restaurant", "grocery", "pharmacy", "beauty", "flowers", "retail", "bakery",
]);

export const ORDER_STATUSES = [
  "scheduled", "pending", "accepted", "preparing", "ready", "picked_up", "delivered", "cancelled", "rejected",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "multicaixa_express", "unitel_money", "card", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DIETARY_TAGS = ["vegan", "vegetarian", "gluten_free", "halal", "lactose_free", "spicy"] as const;
export const ALLERGENS = ["gluten", "dairy", "eggs", "nuts", "peanuts", "seafood", "fish", "soy"] as const;
export const STORE_TYPES = ["restaurant", "bakery", "grocery", "pharmacy", "beauty", "flowers", "retail"] as const;
export const PAYOUT_METHODS = ["multicaixa_express", "unitel_money", "bank_transfer"] as const;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  userType: userTypeEnum("user_type").notNull().default("customer"),
  isApproved: boolean("is_approved").notNull().default(true), // drivers need admin approval
  isActive: boolean("is_active").notNull().default(true),
  referralCode: text("referral_code").notNull(),
  referredBy: integer("referred_by"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  preferredLanguage: text("preferred_language").default("pt"),
  dietaryPreferences: text("dietary_preferences").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
}, (t) => [
  uniqueIndex("users_username_idx").on(t.username),
  uniqueIndex("users_referral_idx").on(t.referralCode),
]);
export type User = typeof users.$inferSelect;

export const addresses = pgTable("addresses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(), // Casa, Trabalho...
  street: text("street").notNull(),
  zone: text("zone").notNull(), // bairro / zona (substitui o código postal em Angola)
  city: text("city").notNull().default("Luanda"),
  reference: text("reference"), // ponto de referência
  latitude: real("latitude"),
  longitude: real("longitude"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Address = typeof addresses.$inferSelect;

// ---------------------------------------------------------------------------
// Stores (restaurants, groceries, pharmacies, beauty, flowers, retail)
// ---------------------------------------------------------------------------
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").references(() => users.id),
  name: text("name").notNull(),
  storeType: storeTypeEnum("store_type").notNull().default("restaurant"),
  description: text("description"),
  cuisines: text("cuisines").array().notNull().default([]),
  isChain: boolean("is_chain").notNull().default(false),
  // Negócio caseiro (ex.: senhora que faz bolos em casa): sem loja física, pode exigir encomenda antecipada
  isHomeBusiness: boolean("is_home_business").notNull().default(false),
  minNoticeMin: integer("min_notice_min").notNull().default(0), // >0 = só por encomenda antecipada
  maxOrdersPerDay: integer("max_orders_per_day"), // limite de capacidade diária (null = sem limite)
  payoutMethod: text("payout_method"), // multicaixa_express | unitel_money | bank_transfer
  payoutReference: text("payout_reference"), // telefone Multicaixa Express/Unitel Money ou IBAN
  phone: text("phone").notNull(),
  street: text("street").notNull(),
  zone: text("zone").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  zonesServed: text("zones_served").array().notNull().default([]),
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  openingTime: text("opening_time").notNull().default("10:00"),
  closingTime: text("closing_time").notNull().default("22:00"),
  isOpen: boolean("is_open").notNull().default(true),
  isApproved: boolean("is_approved").notNull().default(false),
  deliveryFee: integer("delivery_fee").notNull().default(1000),
  minOrder: integer("min_order").notNull().default(0),
  prepTimeMin: integer("prep_time_min").notNull().default(20),
  deliveryTimeMin: integer("delivery_time_min").notNull().default(35), // estimativa total
  ratingAvg: real("rating_avg").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  businessNif: text("business_nif"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("stores_zone_idx").on(t.zone)]);
export type Store = typeof stores.$inferSelect;

export const menuSections = pgTable("menu_sections", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type MenuSection = typeof menuSections.$inferSelect;

export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  sectionId: integer("section_id").references(() => menuSections.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // em Kwanza
  imageUrl: text("image_url"),
  dietaryTags: text("dietary_tags").array().notNull().default([]),
  allergens: text("allergens").array().notNull().default([]),
  isAvailable: boolean("is_available").notNull().default(true),
  isPopular: boolean("is_popular").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MenuItem = typeof menuItems.$inferSelect;

// Personalização: grupos de opções (ex: "Molho", "Retirar ingredientes", "Tamanho")
export const optionGroups = pgTable("option_groups", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type OptionGroup = typeof optionGroups.$inferSelect;

export const options = pgTable("options", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => optionGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceDelta: integer("price_delta").notNull().default(0),
  isAvailable: boolean("is_available").notNull().default(true),
});
export type Option = typeof options.$inferSelect;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").notNull().references(() => users.id),
  storeId: integer("store_id").notNull().references(() => stores.id),
  driverId: integer("driver_id").references(() => users.id),
  groupOrderId: integer("group_order_id"),
  status: text("status").$type<OrderStatus>().notNull(),
  scheduledFor: timestamp("scheduled_for"),
  // morada copiada no momento da encomenda (histórico estável)
  deliveryAddress: jsonb("delivery_address").$type<{
    label: string; street: string; zone: string; city: string; reference?: string | null;
    latitude?: number | null; longitude?: number | null;
  }>().notNull(),
  notes: text("notes"),
  subtotal: integer("subtotal").notNull(),
  deliveryFee: integer("delivery_fee").notNull(),
  discount: integer("discount").notNull().default(0),
  pointsRedeemed: integer("points_redeemed").notNull().default(0),
  total: integer("total").notNull(),
  promoCode: text("promo_code"),
  paymentMethod: text("payment_method").$type<PaymentMethod>().notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending | paid | failed | refunded
  cancelReason: text("cancel_reason"),
  estimatedDeliveryAt: timestamp("estimated_delivery_at"),
  storeConfirmedAt: timestamp("store_confirmed_at"), // loja confirmou uma encomenda agendada
  driverLatitude: real("driver_latitude"),
  driverLongitude: real("driver_longitude"),
  driverLocationAt: timestamp("driver_location_at"),
  externalDispatchId: text("external_dispatch_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at"),
}, (t) => [
  uniqueIndex("orders_number_idx").on(t.orderNumber),
  index("orders_customer_idx").on(t.customerId),
  index("orders_store_idx").on(t.storeId),
  index("orders_status_idx").on(t.status),
]);
export type Order = typeof orders.$inferSelect;

export type SelectedOption = { groupId: number; groupName: string; optionId: number; name: string; priceDelta: number };

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id),
  name: text("name").notNull(),
  unitPrice: integer("unit_price").notNull(), // preço base + opções
  quantity: integer("quantity").notNull(),
  selectedOptions: jsonb("selected_options").$type<SelectedOption[]>().notNull().default([]),
  specialInstructions: text("special_instructions"),
  addedBy: text("added_by"), // nome do participante (encomenda em grupo)
});
export type OrderItem = typeof orderItems.$inferSelect;

export const orderEvents = pgTable("order_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note"),
  actorId: integer("actor_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type OrderEvent = typeof orderEvents.$inferSelect;

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id),
  subscriptionId: integer("subscription_id"),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  method: text("method").notNull(),
  provider: text("provider").notNull(), // cash | sandbox | <gateway>
  status: text("status").notNull().default("pending"),
  providerReference: text("provider_reference"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Payment = typeof payments.$inferSelect;

// ---------------------------------------------------------------------------
// Group orders (cesto partilhado por link)
// ---------------------------------------------------------------------------
export const groupOrders = pgTable("group_orders", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  hostId: integer("host_id").notNull().references(() => users.id),
  storeId: integer("store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("open"), // open | locked | ordered | cancelled
  orderId: integer("order_id"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("group_orders_token_idx").on(t.token)]);
export type GroupOrder = typeof groupOrders.$inferSelect;

export const groupParticipants = pgTable("group_participants", {
  id: serial("id").primaryKey(),
  groupOrderId: integer("group_order_id").notNull().references(() => groupOrders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  secret: text("secret").notNull(),
  userId: integer("user_id"),
  isHost: boolean("is_host").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type GroupParticipant = typeof groupParticipants.$inferSelect;

export const groupItems = pgTable("group_items", {
  id: serial("id").primaryKey(),
  groupOrderId: integer("group_order_id").notNull().references(() => groupOrders.id, { onDelete: "cascade" }),
  participantId: integer("participant_id").notNull().references(() => groupParticipants.id, { onDelete: "cascade" }),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id),
  quantity: integer("quantity").notNull(),
  optionIds: integer("option_ids").array().notNull().default([]),
  specialInstructions: text("special_instructions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type GroupItem = typeof groupItems.$inferSelect;

// ---------------------------------------------------------------------------
// PedeJá Plus (subscrição)
// ---------------------------------------------------------------------------
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  plan: text("plan").notNull().default("plus_monthly"),
  status: text("status").notNull(), // pending_payment | active | cancelled | expired
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  autoRenew: boolean("auto_renew").notNull().default(true),
  activatedBy: text("activated_by"), // payment | admin
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Subscription = typeof subscriptions.$inferSelect;

// ---------------------------------------------------------------------------
// Promoções, avaliações, favoritos, pontos
// ---------------------------------------------------------------------------
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  description: text("description"),
  discountType: text("discount_type").notNull(), // percent | fixed | free_delivery
  value: integer("value").notNull().default(0),
  minOrder: integer("min_order").notNull().default(0),
  maxDiscount: integer("max_discount"),
  storeId: integer("store_id"),
  plusOnly: boolean("plus_only").notNull().default(false),
  firstOrderOnly: boolean("first_order_only").notNull().default(false),
  maxUses: integer("max_uses"),
  maxUsesPerUser: integer("max_uses_per_user").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("promo_code_idx").on(t.code)]);
export type PromoCode = typeof promoCodes.$inferSelect;

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  storeId: integer("store_id").notNull().references(() => stores.id),
  userId: integer("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),
  driverRating: integer("driver_rating"),
  comment: text("comment"),
  reply: text("reply"),
  repliedAt: timestamp("replied_at"),
  isPublished: boolean("is_published").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("reviews_order_idx").on(t.orderId)]);
export type Review = typeof reviews.$inferSelect;

export const favorites = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("favorites_user_store_idx").on(t.userId, t.storeId)]);

export const pointsLedger = pgTable("points_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(), // order_earned | order_redeemed | referral_bonus | welcome_bonus | refund
  orderId: integer("order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Validation schemas (API input)
// ---------------------------------------------------------------------------
const usernameRe = /^[a-zA-Z0-9_.]+$/;

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(usernameRe, "Use apenas letras, números, _ e ."),
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres").max(128),
  fullName: z.string().trim().min(3).max(100),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("")),
  phone: z.string().trim().regex(/^\+?[0-9 ]{9,15}$/, "Número de telefone inválido"),
  userType: z.enum(["customer", "supplier", "driver"]).default("customer"),
  referralCode: z.string().trim().max(20).optional().nullable().or(z.literal("")),
  // fornecedor
  business: z.object({
    name: z.string().trim().min(2).max(100),
    storeType: z.enum(STORE_TYPES),
    phone: z.string().trim().min(9).max(20),
    street: z.string().trim().min(3).max(200),
    zone: z.string().trim().min(2).max(60),
    nif: z.string().trim().max(30).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
    isHomeBusiness: z.boolean().optional().default(false),
    minNoticeHours: z.number().int().min(0).max(168).optional().default(0),
  }).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(128),
});

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  street: z.string().trim().min(3).max(200),
  zone: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60).default("Luanda"),
  reference: z.string().trim().max(200).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const cartLineSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(50),
  optionIds: z.array(z.number().int().positive()).max(30).default([]),
  specialInstructions: z.string().trim().max(200).optional().nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const quoteSchema = z.object({
  storeId: z.number().int().positive(),
  items: z.array(cartLineSchema).min(1).max(100),
  promoCode: z.string().trim().max(30).optional().nullable(),
  usePoints: z.number().int().min(0).optional().default(0),
});

export const createOrderSchema = z.object({
  storeId: z.number().int().positive(),
  items: z.array(cartLineSchema).max(100).default([]),
  addressId: z.number().int().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(500).optional().nullable(),
  scheduledFor: z.string().datetime().optional().nullable(),
  promoCode: z.string().trim().max(30).optional().nullable(),
  usePoints: z.number().int().min(0).optional().default(0),
  groupToken: z.string().max(64).optional().nullable(),
});

export const modifyOrderSchema = z.object({
  items: z.array(cartLineSchema).min(1).max(100).optional(),
  addressId: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  scheduledFor: z.string().datetime().optional().nullable(),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  driverRating: z.number().int().min(1).max(5).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
});

export const storeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable(),
  cuisines: z.array(z.string().trim().min(1).max(40)).max(10),
  phone: z.string().trim().min(9).max(20),
  street: z.string().trim().min(3).max(200),
  zone: z.string().trim().min(2).max(60),
  zonesServed: z.array(z.string().trim().min(2).max(60)).max(50),
  logoUrl: z.string().url().max(500).nullable(),
  coverUrl: z.string().url().max(500).nullable(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
  isOpen: z.boolean(),
  deliveryFee: z.number().int().min(0).max(100000),
  minOrder: z.number().int().min(0).max(1000000),
  prepTimeMin: z.number().int().min(1).max(240),
  deliveryTimeMin: z.number().int().min(5).max(300),
  minNoticeMin: z.number().int().min(0).max(10080),
  maxOrdersPerDay: z.number().int().min(1).max(10000).nullable(),
  payoutMethod: z.enum(PAYOUT_METHODS).nullable(),
  payoutReference: z.string().trim().max(60).nullable(),
}).partial();

export const menuItemInputSchema = z.object({
  sectionId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  price: z.number().int().min(0).max(10000000),
  imageUrl: z.string().url().max(500).nullable().optional(),
  dietaryTags: z.array(z.enum(DIETARY_TAGS)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  isAvailable: z.boolean().default(true),
  isPopular: z.boolean().default(false),
  optionGroups: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    options: z.array(z.object({
      name: z.string().trim().min(1).max(60),
      priceDelta: z.number().int().min(-1000000).max(1000000).default(0),
      isAvailable: z.boolean().default(true),
    })).min(1).max(30),
  }).refine((g) => g.minSelect <= g.maxSelect, "O mínimo não pode ser maior que o máximo")
    .refine((g) => g.minSelect <= g.options.length, "O mínimo de escolhas é maior que o número de opções")).max(10).default([]),
});

export const promoInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
  description: z.string().trim().max(200).nullable().optional(),
  discountType: z.enum(["percent", "fixed", "free_delivery"]),
  value: z.number().int().min(0).max(10000000).default(0),
  minOrder: z.number().int().min(0).default(0),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  storeId: z.number().int().positive().nullable().optional(),
  plusOnly: z.boolean().default(false),
  firstOrderOnly: z.boolean().default(false),
  maxUses: z.number().int().positive().nullable().optional(),
  maxUsesPerUser: z.number().int().positive().default(1),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Publicidade (carrossel da página inicial)
// ---------------------------------------------------------------------------
export const BANNER_STICKERS = ["burger", "pizza", "cake", "none"] as const;

export const banners = pgTable("banners", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  imageUrl: text("image_url"), // foto de fundo (https)
  imageCredit: text("image_credit"), // crédito/licença exigido pela foto
  sticker: text("sticker").$type<(typeof BANNER_STICKERS)[number]>().notNull().default("none"),
  ctaLabel: text("cta_label"),
  linkUrl: text("link_url"), // caminho interno (/pesquisa?...) ou https
  bgColor: text("bg_color").notNull().default("#00CCBC"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Banner = typeof banners.$inferSelect;

export const bannerInputSchema = z.object({
  title: z.string().trim().min(2).max(60),
  subtitle: z.string().trim().max(120).nullable().optional(),
  imageUrl: z.string().trim().url().max(600).refine((u) => u.startsWith("https://"), "A imagem tem de ser https").nullable().optional(),
  imageCredit: z.string().trim().max(200).nullable().optional(),
  sticker: z.enum(BANNER_STICKERS).default("none"),
  ctaLabel: z.string().trim().max(30).nullable().optional(),
  linkUrl: z.string().trim().max(300).refine((u) => /^\/(?!\/)/.test(u) || u.startsWith("https://"), "Use um caminho interno (/...) ou um link https").nullable().optional(),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#00CCBC"),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
