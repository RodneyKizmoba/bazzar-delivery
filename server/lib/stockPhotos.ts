import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { menuItems, stores } from "@shared/schema";
import { REPLACED_PHOTOS } from "../seedPhotos";

/**
 * Fotografias reais e gratuitas do Unsplash (licença Unsplash: uso comercial livre, sem atribuição obrigatória;
 * https://unsplash.com/license). Usadas só nas lojas de demonstração e no Mariato, até as lojas carregarem as suas.
 * Só se aplica uma foto quando o prato corresponde mesmo: os outros ficam sem foto (melhor do que uma foto enganadora).
 */
const u = (id: string, w: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

/** [padrão no nome do prato, id da foto] — o primeiro que corresponder ganha. */
const ITEM_RULES: [RegExp, string][] = [
  // hambúrgueres e acompanhamentos
  [/veggie burger/i, "photo-1550547660-d9450f859349"],
  [/hamb[uú]rguer de frango/i, "photo-1586190848861-99aa4a171e90"],
  [/hamb[uú]rguer mariato/i, "photo-1572802419224-296b0aeee0d9"],
  [/hamb[uú]rguer/i, "photo-1568901346375-23c9450c58cd"],
  [/batata frita|chips de mandioca/i, "photo-1630384060421-cb20d0e0649d"],
  // pizza e massas
  [/pizza margherita/i, "photo-1574071318508-1cdbab80d002"],
  [/pizza piri/i, "photo-1565299624946-b28f40a0ae38"],
  [/pizza/i, "photo-1593560708920-61dd98c46a4e"],
  [/carbonara/i, "photo-1551892374-ecf8754cf8b0"],
  [/penne/i, "photo-1600803907087-f56d462fd26b"],
  [/esparguete|bolonhesa/i, "photo-1622973536968-3ead9e780960"],
  // sushi
  [/combinado vegetariano/i, "photo-1617196034796-73dfa7b1fd56"],
  [/combinado|sushi/i, "photo-1553621042-f6e147245754"],
  // frango, carnes e espetadas
  [/asinhas/i, "photo-1727280376746-b89107a5b0df"],
  [/frango à mariato/i, "photo-1598515214211-89d3c73ae83b"],
  [/frango grelhado/i, "photo-1643886027883-1a23fe41ee2a"],
  [/espetada|espeto/i, "photo-1626323109252-0adb3b46692b"],
  [/t-bone/i, "photo-1546964124-0cce460f38ef"],
  [/picanha na brasa|entrecosto/i, "photo-1508615263227-c5d58c1e5821"],
  [/tábua|tabua/i, "photo-1555939594-58d7cb561ad1"],
  [/bife|lombinho|bitoque|prego no prato|prego de picanha/i, "photo-1588168333986-5078d3ae3976"],
  // peixe e marisco
  [/riss[oó]is/i, "photo-1483695028939-5bb13f8648b0"], // salgados fritos, não camarão inteiro
  [/grelhada do mar/i, "photo-1768322264423-4b0adf0cf31b"],
  [/camar[aã]o|gambas/i, "photo-1758972572427-fc3d4193bbd2"],
  [/cacusso/i, "photo-1556814901-18c866c057da"],
  [/garoupa/i, "photo-1600699899970-b1c9fadd8f9e"],
  [/mufete/i, "photo-1665401015549-712c0dc5ef85"],
  [/peixe (grelhado|do dia)/i, "photo-1519708227418-c8fd9a32b7a2"],
  // pratos angolanos de panela
  [/kizaca|guisado de beringela/i, "photo-1604329760661-e71dc83f8f26"],
  [/calulu/i, "photo-1773209927898-a0a7e0a13125"],
  [/caldeirada/i, "photo-1730112696140-19e61bb43d36"],
  [/cabidela/i, "photo-1708782344071-35ed44b849a9"],
  [/muamba/i, "photo-1608500218861-01091cdc501e"],
  [/menu executivo/i, "photo-1665332195309-9d75071138f0"],
  [/sopa/i, "photo-1608500218882-986df81d55fc"],
  // saladas
  [/salada tropical/i, "photo-1600335895229-6e75511892c8"],
  [/salada/i, "photo-1512621776951-a57141f2eefd"],
  // bebidas
  [/sumo de m[uú]cua/i, "photo-1600271886742-f049cd451bba"],
  [/sumo/i, "photo-1546173159-315724a31696"],
  [/refrigerante/i, "photo-1533007716222-4b465613a984"],
  [/galão|cappuccino/i, "photo-1485808191679-5f86510681a2"],
  [/café/i, "photo-1572286258217-40142c1c6a70"],
  // sobremesas e pastelaria
  [/bolo de mandioca com gelado/i, "photo-1560008581-09826d1de69e"],
  [/gelado/i, "photo-1497034825429-c343d7c6a68f"],
  [/bolo de anivers/i, "photo-1606983340126-99ab4feaa64a"],
  [/bolo de ginguba|bolo de jinguba/i, "photo-1588195538326-c5b1e9f80a1b"],
  [/past[eé]is de carne|pastel de massa/i, "photo-1483695028939-5bb13f8648b0"],
  // lojas que não são restaurantes
  [/cesto de frutas/i, "photo-1619566636858-adf3ef46400b"],
  [/ramo de .*rosas/i, "photo-1589095181425-c038b3871b6a"],
];

/** Capa de cada loja de demonstração. */
const STORE_COVERS: Record<string, string> = {
  "Grelhados do Mussulo": "photo-1599487488170-d11ec9c172f0",
  "Burger Station": "photo-1610440042657-612c34d95e9f",
  "Pizzaria Ilha": "photo-1571997478779-2adcbbe9ab2f",
  "Sushi Baía": "photo-1611143669185-af224c5e3252",
  "Mercado Fresco Talatona": "photo-1542838132-92c53300491e",
  "Farmácia Saúde+": "photo-1611072965169-e1534f6f300c",
  "Flores de Luanda": "photo-1457089328109-e5d9bd499191",
  "Casa & Oficina": "photo-1598305762558-328f599df683",
  "Beleza Natural": "photo-1522335789203-aabd1fc54bc9",
  "Bolos da Tia Rosa": "photo-1558301211-0d8c8ddee6ec",
  "Kitanda da Avó (pendente)": "photo-1773209928058-cfd3314acc7c",
  "Mariato Restaurante Grill": "photo-1555939594-58d7cb561ad1",
};

export function stockItemPhoto(name: string): string | null {
  const hit = ITEM_RULES.find(([re]) => re.test(name));
  return hit ? u(hit[1], 600) : null;
}

export function stockCover(storeName: string): string | null {
  const id = STORE_COVERS[storeName];
  return id ? u(id, 1000) : null;
}

/**
 * Preenche capas e fotos em falta nas lojas de demonstração/Mariato (também em bases de dados já criadas).
 * Nunca substitui uma foto que a loja tenha carregado.
 */
export async function applyStockPhotos() {
  // fotos locais retiradas por não mostrarem o produto: trocar pelos substitutos (também em bases de dados já criadas)
  for (const [key, url] of Object.entries(REPLACED_PHOTOS)) {
    const old = `/photos/catalog/${key}.jpg`;
    await db.update(stores).set({ coverUrl: url }).where(eq(stores.coverUrl, old));
    await db.update(stores).set({ logoUrl: url }).where(eq(stores.logoUrl, old));
    await db.update(menuItems).set({ imageUrl: url }).where(eq(menuItems.imageUrl, old));
  }
  const rows = await db.select({ id: stores.id, name: stores.name, coverUrl: stores.coverUrl }).from(stores)
    .where(inArray(stores.name, Object.keys(STORE_COVERS)));
  let covers = 0;
  let photos = 0;
  for (const s of rows) {
    if (!s.coverUrl) {
      await db.update(stores).set({ coverUrl: stockCover(s.name) }).where(eq(stores.id, s.id));
      covers++;
    }
    const items = await db.select({ id: menuItems.id, name: menuItems.name }).from(menuItems)
      .where(and(eq(menuItems.storeId, s.id), isNull(menuItems.imageUrl)));
    for (const it of items) {
      const url = stockItemPhoto(it.name);
      if (url) {
        await db.update(menuItems).set({ imageUrl: url }).where(eq(menuItems.id, it.id));
        photos++;
      }
    }
  }
  if (covers || photos) console.log(`[fotos] ${covers} capas e ${photos} fotos de pratos adicionadas (Unsplash).`);
}
