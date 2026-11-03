import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import { createServer } from "http";
import { config } from "./config";
import { pool, runMigrations } from "./db";
import { loadUser } from "./lib/auth";
import { errorHandler } from "./lib/http";
import { releaseScheduledOrders } from "./lib/orderFlow";
import { authRouter } from "./routes/auth";
import { catalogRouter } from "./routes/catalog";
import { customerRouter } from "./routes/customer";
import { groupRouter } from "./routes/group";
import { partnerRouter } from "./routes/partner";
import { driverRouter } from "./routes/driver";
import { adminRouter } from "./routes/admin";
import { webhookRouter } from "./routes/webhooks";
import { ensureAdmin, seedDemoData } from "./seed";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: config.isProd ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  } : false, // em desenvolvimento o Vite precisa de scripts inline
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: config.isProd ? 300 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados pedidos. Aguarde um momento.", code: "RATE_LIMITED" },
}));

app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// Proteção CSRF simples: pedidos que alteram dados têm de vir da própria aplicação (Origin igual ao Host)
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path.startsWith("/webhooks/")) return next();
  const origin = req.get("origin");
  if (!origin) return next(); // clientes não-browser (curl, testes)
  try {
    const o = new URL(origin);
    const host = req.get("x-forwarded-host") || req.get("host");
    if (o.host === host || config.appOrigins.includes(origin)) return next();
  } catch { /* inválido */ }
  res.status(403).json({ message: "Origem não permitida", code: "BAD_ORIGIN" });
});

const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, tableName: "sessions", createTableIfMissing: true }),
  secret: config.sessionSecret,
  name: "bazzar.sid",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: config.isProd && process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
  },
}));
app.use(loadUser);

// registo de pedidos à API (sem corpo de resposta, para não expor dados pessoais)
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const start = Date.now();
  res.on("finish", () => log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api", catalogRouter);
app.use("/api", customerRouter);
app.use("/api/groups", groupRouter);
app.use("/api/partner", partnerRouter);
app.use("/api/driver", driverRouter);
app.use("/api/admin", adminRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api", (_req, res) => res.status(404).json({ message: "Endpoint não encontrado", code: "NOT_FOUND" }));
app.use(errorHandler);

(async () => {
  await runMigrations();
  await ensureAdmin();
  if (process.env.SEED_DEMO === "true" || (!config.isProd && process.env.SEED_DEMO !== "false")) {
    await seedDemoData();
  }

  const server = createServer(app);
  if (config.isProd) serveStatic(app);
  else await setupVite(app, server);

  server.listen({ port: config.port, host: "0.0.0.0" }, () => {
    log(`BazzarDelivery a correr na porta ${config.port} (pagamentos: ${config.paymentsMode})`);
  });

  // libertar encomendas agendadas a cada minuto
  setInterval(() => { releaseScheduledOrders().catch((e) => console.error("[scheduler]", e)); }, 60_000);
})().catch((e) => {
  console.error("Falha ao arrancar:", e);
  process.exit(1);
});
