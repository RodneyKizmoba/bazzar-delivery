import pg from "pg";
import { photoForMenuItem, photoForStore } from "../server/seedPhotos";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to fill missing demo photos.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const { rows: storeRows } = await client.query<{
    id: number;
    name: string;
    logo_url: string | null;
    cover_url: string | null;
  }>("SELECT id, name, logo_url, cover_url FROM stores ORDER BY id");
  let storesUpdated = 0;
  for (const store of storeRows) {
    if (store.logo_url && store.cover_url) continue;
    await client.query(
      `UPDATE stores
       SET logo_url = COALESCE(logo_url, $1),
           cover_url = COALESCE(cover_url, $2)
       WHERE id = $3`,
      [photoForStore(store.name), photoForStore(store.name), store.id],
    );
    storesUpdated++;
  }

  const { rows: itemRows } = await client.query<{
    id: number;
    name: string;
    store_name: string;
  }>(
    `SELECT mi.id, mi.name, s.name AS store_name
     FROM menu_items mi
     JOIN stores s ON s.id = mi.store_id
     WHERE mi.image_url IS NULL
     ORDER BY s.id, mi.id`,
  );
  for (const item of itemRows) {
    await client.query(
      "UPDATE menu_items SET image_url = $1 WHERE id = $2 AND image_url IS NULL",
      [photoForMenuItem(item.name, item.store_name), item.id],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Demo photos filled: ${storesUpdated} store records, ${itemRows.length} menu items. Existing custom images were preserved.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
