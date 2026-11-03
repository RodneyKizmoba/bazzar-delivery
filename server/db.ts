import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não está definido. Crie a base de dados PostgreSQL no Replit (separador Database).");
}

const needsSsl = /neon\.tech|sslmode=require/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const db = drizzle(pool, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;

/** Aplica as migrações da pasta /migrations (criadas com `npm run db:generate`). */
export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "migrations") });
}
