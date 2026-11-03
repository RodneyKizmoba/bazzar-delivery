import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  addresses, menuItems, menuSections, optionGroups, options, promoCodes, stores, users,
} from "@shared/schema";

function code() { return randomBytes(4).toString("hex").toUpperCase().slice(0, 7); }

/** Cria a conta de administrador a partir de ADMIN_USERNAME / ADMIN_PASSWORD (se ainda não existir nenhum admin). */
export async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const [anyAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.userType, "admin")).limit(1);
  if (anyAdmin) return;
  if (password.length < 12) {
    console.warn("[admin] ADMIN_PASSWORD tem de ter pelo menos 12 caracteres; admin não criado.");
    return;
  }
  await db.insert(users).values({
    username, passwordHash: await bcrypt.hash(password, 12), fullName: "Administrador", phone: "+244900000000",
    userType: "admin", referralCode: code(),
  });
  console.log(`[admin] conta de administrador "${username}" criada.`);
}

type OptGroup = { name: string; min: number; max: number; options: [string, number][] };
type Item = {
  name: string; price: number; description?: string; dietary?: string[]; allergens?: string[];
  popular?: boolean; groups?: OptGroup[];
};
type StoreSeed = {
  name: string; storeType: any; cuisines: string[]; zone: string; street: string; lat: number; lng: number;
  zonesServed: string[]; deliveryFee: number; minOrder?: number; time: number; isChain?: boolean;
  home?: boolean; noticeMin?: number; maxPerDay?: number;
  open?: string; close?: string; description: string; owner?: string; approved?: boolean;
  menu: Record<string, Item[]>;
};

const REMOVE: OptGroup = { name: "Retirar ingredientes", min: 0, max: 3, options: [["Sem cebola", 0], ["Sem tomate", 0], ["Sem picante", 0]] };

const STORES: StoreSeed[] = [
  {
    name: "Grelhados do Mussulo", storeType: "restaurant", cuisines: ["Angolana", "Grelhados"], zone: "Talatona",
    street: "Rua do Talatona, Condomínio Jardim", lat: -8.9172, lng: 13.1846, zonesServed: ["Talatona", "Morro Bento", "Camama", "Benfica", "Patriota"],
    deliveryFee: 1000, time: 35, owner: "loja", description: "Grelhados na brasa e pratos tradicionais angolanos.",
    menu: {
      "Grelhados": [
        { name: "Frango grelhado", price: 4500, description: "Meio frango na brasa.", allergens: [], popular: true, groups: [
          { name: "Molho", min: 1, max: 1, options: [["Piri-piri", 0], ["Alho e limão", 0], ["Sem molho", 0]] },
          { name: "Acompanhamento", min: 1, max: 2, options: [["Batata frita", 0], ["Arroz", 0], ["Funje", 300], ["Salada", 0]] },
          REMOVE,
        ] },
        { name: "Espetada de carne", price: 5200, description: "Vaca e chouriço com pimentos.", groups: [
          { name: "Ponto da carne", min: 1, max: 1, options: [["Mal passada", 0], ["Média", 0], ["Bem passada", 0]] },
          { name: "Extras", min: 0, max: 3, options: [["Ovo estrelado", 300], ["Banana pão frita", 500], ["Queijo", 400]] },
        ] },
        { name: "Peixe grelhado do dia", price: 6500, description: "Com banana pão e feijão de óleo de palma.", allergens: ["fish"] },
      ],
      "Pratos tradicionais": [
        { name: "Muamba de galinha", price: 5000, description: "Com funje e quiabos.", popular: true, dietary: ["gluten_free"], groups: [
          { name: "Picante", min: 1, max: 1, options: [["Sem picante", 0], ["Médio", 0], ["Muito picante", 0]] },
        ] },
        { name: "Calulu de peixe", price: 5500, description: "Peixe seco e fresco com legumes.", allergens: ["fish"], dietary: ["gluten_free"] },
        { name: "Mufete", price: 7000, description: "Cacusso grelhado, feijão de óleo de palma, mandioca e batata doce.", allergens: ["fish"] },
      ],
      "Vegetariano": [
        { name: "Salada tropical", price: 3200, description: "Abacate, manga, tomate e rúcula.", dietary: ["vegan", "vegetarian", "gluten_free"] },
        { name: "Feijão de óleo de palma com banana", price: 3000, dietary: ["vegan", "vegetarian", "gluten_free"] },
      ],
      "Bebidas": [
        { name: "Sumo de múcua", price: 1200, dietary: ["vegan", "vegetarian", "gluten_free"] },
        { name: "Água 1,5L", price: 500, dietary: ["vegan", "vegetarian", "gluten_free"] },
        { name: "Refrigerante lata", price: 700, dietary: ["vegan", "vegetarian", "gluten_free"] },
      ],
    },
  },
  {
    name: "Burger Station", storeType: "restaurant", cuisines: ["Hambúrgueres", "Fast food"], zone: "Kilamba", isChain: true,
    street: "Centralidade do Kilamba, Bloco Q", lat: -8.9937, lng: 13.2711, zonesServed: ["Kilamba", "Camama", "Talatona", "Zango", "Viana"],
    deliveryFee: 800, time: 30, description: "Rede de hambúrgueres com 5 lojas em Luanda.",
    menu: {
      "Hambúrgueres": [
        { name: "Hambúrguer clássico", price: 3500, description: "Carne 150g, queijo, alface e tomate.", allergens: ["gluten", "dairy", "eggs"], popular: true, groups: [
          { name: "Tamanho", min: 1, max: 1, options: [["Simples", 0], ["Duplo", 1500]] },
          { name: "Extras", min: 0, max: 4, options: [["Queijo extra", 500], ["Bacon", 700], ["Ovo", 300], ["Pão sem glúten", 800]] },
          REMOVE,
        ] },
        { name: "Hambúrguer de frango picante", price: 3300, allergens: ["gluten", "eggs"], dietary: ["spicy"] },
        { name: "Veggie burger", price: 3400, description: "Hambúrguer de grão e legumes.", allergens: ["gluten", "soy"], dietary: ["vegetarian", "vegan"] },
      ],
      "Acompanhamentos": [
        { name: "Batata frita", price: 1200, dietary: ["vegan", "vegetarian"], groups: [
          { name: "Tamanho", min: 1, max: 1, options: [["Normal", 0], ["Grande", 500]] },
        ] },
        { name: "Anéis de cebola", price: 1400, allergens: ["gluten"], dietary: ["vegetarian"] },
      ],
      "Bebidas e sobremesas": [
        { name: "Milkshake de baunilha", price: 1800, allergens: ["dairy"], dietary: ["vegetarian"] },
        { name: "Refrigerante 50cl", price: 800, dietary: ["vegan", "vegetarian", "gluten_free"] },
      ],
    },
  },
  {
    name: "Pizzaria Ilha", storeType: "restaurant", cuisines: ["Italiana", "Pizza"], zone: "Maianga",
    street: "Rua Rainha Ginga, 45", lat: -8.8214, lng: 13.2349, zonesServed: ["Maianga", "Ingombota", "Alvalade", "Maculusso", "Miramar", "Ilha de Luanda"],
    deliveryFee: 1200, time: 40, minOrder: 3000, open: "11:00", close: "23:30", description: "Pizzas em forno a lenha.",
    menu: {
      "Pizzas": [
        { name: "Pizza Margherita", price: 4800, allergens: ["gluten", "dairy"], dietary: ["vegetarian"], popular: true, groups: [
          { name: "Tamanho", min: 1, max: 1, options: [["Média", 0], ["Familiar", 2500]] },
          { name: "Massa", min: 1, max: 1, options: [["Tradicional", 0], ["Fina", 0], ["Sem glúten", 1000]] },
        ] },
        { name: "Pizza Piri-piri", price: 5600, description: "Chouriço, piri-piri e cebola roxa.", allergens: ["gluten", "dairy"], dietary: ["spicy"] },
        { name: "Pizza Marisco", price: 7500, allergens: ["gluten", "dairy", "seafood"] },
      ],
      "Massas": [
        { name: "Esparguete à bolonhesa", price: 4200, allergens: ["gluten"] },
        { name: "Lasanha vegetariana", price: 4500, allergens: ["gluten", "dairy"], dietary: ["vegetarian"] },
      ],
    },
  },
  {
    name: "Sushi Baía", storeType: "restaurant", cuisines: ["Japonesa", "Sushi"], zone: "Ilha de Luanda",
    street: "Av. Murtala Mohammed, Ilha", lat: -8.7965, lng: 13.2246, zonesServed: ["Ilha de Luanda", "Ingombota", "Maianga", "Miramar"],
    deliveryFee: 1500, time: 45, minOrder: 5000, description: "Sushi fresco com peixe da costa angolana.",
    menu: {
      "Combinados": [
        { name: "Combinado 20 peças", price: 9500, allergens: ["fish", "soy", "seafood"], popular: true },
        { name: "Combinado vegetariano 16 peças", price: 7000, allergens: ["soy"], dietary: ["vegetarian", "vegan"] },
      ],
      "Entradas": [
        { name: "Gyoza de frango (6)", price: 3000, allergens: ["gluten", "soy"] },
        { name: "Edamame", price: 2000, dietary: ["vegan", "vegetarian", "gluten_free"], allergens: ["soy"] },
      ],
    },
  },
  {
    name: "Mercado Fresco Talatona", storeType: "grocery", cuisines: ["Supermercado"], zone: "Talatona", isChain: true,
    street: "Via S8, Talatona", lat: -8.9105, lng: 13.1950, zonesServed: ["Talatona", "Morro Bento", "Benfica", "Camama", "Kilamba"],
    deliveryFee: 1500, time: 50, minOrder: 5000, open: "08:00", close: "21:00", description: "Mercearia, frescos e essenciais do dia-a-dia.",
    menu: {
      "Frescos": [
        { name: "Banana (1 kg)", price: 900, dietary: ["vegan", "gluten_free"] },
        { name: "Tomate (1 kg)", price: 1100, dietary: ["vegan", "gluten_free"] },
        { name: "Ovos (dúzia)", price: 2200, allergens: ["eggs"], dietary: ["vegetarian", "gluten_free"] },
        { name: "Pão de forma", price: 1300, allergens: ["gluten"], dietary: ["vegetarian"] },
      ],
      "Mercearia": [
        { name: "Arroz agulha (5 kg)", price: 6500, dietary: ["vegan", "gluten_free"], popular: true },
        { name: "Óleo de girassol (1 L)", price: 2400, dietary: ["vegan", "gluten_free"] },
        { name: "Fuba de bombó (2 kg)", price: 2000, dietary: ["vegan", "gluten_free"] },
        { name: "Leite UHT (1 L)", price: 1100, allergens: ["dairy"], dietary: ["vegetarian", "gluten_free"] },
      ],
      "Casa": [
        { name: "Detergente da loiça", price: 1500 },
        { name: "Papel higiénico (12 rolos)", price: 3800 },
      ],
    },
  },
  {
    name: "Farmácia Saúde+", storeType: "pharmacy", cuisines: ["Parafarmácia"], zone: "Alvalade",
    street: "Rua Comandante Che Guevara, 120", lat: -8.8360, lng: 13.2400, zonesServed: ["Alvalade", "Maianga", "Maculusso", "Ingombota", "Miramar", "Talatona"],
    deliveryFee: 1000, time: 40, description: "Parafarmácia e cuidados pessoais. Medicamentos sujeitos a receita só na loja.",
    menu: {
      "Cuidados": [
        { name: "Álcool gel 500 ml", price: 1800 },
        { name: "Protector solar FPS 50", price: 6500 },
        { name: "Kit de primeiros socorros", price: 7800, popular: true },
        { name: "Termómetro digital", price: 4500 },
      ],
    },
  },
  {
    name: "Flores de Luanda", storeType: "flowers", cuisines: ["Flores", "Presentes"], zone: "Miramar",
    street: "Rua do Miramar, 12", lat: -8.8090, lng: 13.2210, zonesServed: [],
    deliveryFee: 2000, time: 60, open: "08:00", close: "19:00", description: "Ramos, arranjos e cestos de oferta para toda a Luanda.",
    menu: {
      "Ramos": [
        { name: "Ramo de 12 rosas", price: 18000, popular: true, groups: [
          { name: "Cor", min: 1, max: 1, options: [["Vermelhas", 0], ["Brancas", 0], ["Mistas", 1000]] },
          { name: "Extras", min: 0, max: 2, options: [["Cartão com mensagem", 500], ["Caixa de chocolates", 4500]] },
        ] },
        { name: "Orquídea em vaso", price: 15000 },
      ],
      "Oferta": [
        { name: "Cesto de frutas tropicais", price: 12000, dietary: ["vegan", "gluten_free"] },
      ],
    },
  },
  {
    name: "Casa & Oficina", storeType: "retail", cuisines: ["Bricolage", "Presentes"], zone: "Viana",
    street: "Estrada de Catete, km 12", lat: -8.9050, lng: 13.3730, zonesServed: ["Viana", "Zango", "Kilamba", "Camama", "Cazenga"],
    deliveryFee: 1800, time: 60, open: "08:00", close: "18:00", description: "Ferramentas, electricidade, utilidades e presentes.",
    menu: {
      "Bricolage": [
        { name: "Lâmpada LED 12W", price: 1500 },
        { name: "Extensão eléctrica 5 tomadas", price: 4200 },
        { name: "Kit de chaves (24 peças)", price: 9800, popular: true },
      ],
      "Presentes": [
        { name: "Caixa de oferta decorada", price: 2500 },
      ],
    },
  },
  {
    name: "Beleza Natural", storeType: "beauty", cuisines: ["Beleza", "Cosmética"], zone: "Talatona",
    street: "Belas Shopping, loja 54", lat: -8.9205, lng: 13.1820, zonesServed: ["Talatona", "Morro Bento", "Benfica"],
    deliveryFee: 1000, time: 45, open: "09:00", close: "21:00", description: "Cosmética natural feita em Angola.",
    menu: {
      "Cuidado do corpo": [
        { name: "Manteiga de karité 200g", price: 4800, popular: true },
        { name: "Óleo de coco puro 250 ml", price: 3600 },
      ],
    },
  },
  {
    name: "Bolos da Tia Rosa", storeType: "bakery", cuisines: ["Bolos", "Pastelaria caseira"], zone: "Kilamba",
    street: "Centralidade do Kilamba, Bloco R (entregas)", lat: -8.9905, lng: 13.2650, zonesServed: ["Kilamba", "Camama", "Talatona", "Viana", "Zango"],
    deliveryFee: 1500, time: 40, owner: "tiarosa", home: true, noticeMin: 24 * 60, maxPerDay: 5, open: "08:00", close: "19:00",
    description: "Bolos de aniversário, bolo de ginguba e salgados feitos em casa. Encomende com 24h de antecedência.",
    menu: {
      "Bolos": [
        { name: "Bolo de aniversário (1 kg)", price: 12000, allergens: ["gluten", "eggs", "dairy"], dietary: ["vegetarian"], popular: true, groups: [
          { name: "Sabor", min: 1, max: 1, options: [["Chocolate", 0], ["Baunilha e morango", 0], ["Ginguba", 500]] },
          { name: "Tamanho", min: 1, max: 1, options: [["1 kg", 0], ["2 kg", 10000]] },
          { name: "Extras", min: 0, max: 2, options: [["Mensagem escrita no bolo", 0], ["Velas", 300]] },
        ] },
        { name: "Bolo de ginguba", price: 6000, allergens: ["gluten", "eggs", "peanuts"], dietary: ["vegetarian"] },
      ],
      "Salgados": [
        { name: "Pastéis de carne (20 un.)", price: 7000, allergens: ["gluten", "eggs"] },
        { name: "Rissóis de camarão (20 un.)", price: 8000, allergens: ["gluten", "seafood"] },
      ],
    },
  },
  {
    name: "Kitanda da Avó (pendente)", storeType: "restaurant", cuisines: ["Angolana"], zone: "Cazenga",
    street: "Rua 11, Cazenga", lat: -8.8250, lng: 13.2900, zonesServed: ["Cazenga", "Rangel"], deliveryFee: 800, time: 40,
    description: "Comida caseira. (Loja de demonstração à espera de aprovação do admin)", owner: "loja2", approved: false,
    menu: { "Pratos": [{ name: "Funje com peixe", price: 3500, allergens: ["fish"] }] },
  },
];

const DEMO_USERS = [
  { username: "admin", password: "Admin#2026demo", fullName: "Admin Demo", phone: "+244923000001", userType: "admin" as const },
  { username: "cliente", password: "Cliente#2026", fullName: "Maria Cliente", phone: "+244923000002", userType: "customer" as const },
  { username: "cliente2", password: "Cliente#2026", fullName: "João Amigo", phone: "+244923000003", userType: "customer" as const },
  { username: "loja", password: "Loja#2026demo", fullName: "Paulo Grelhados", phone: "+244923000004", userType: "supplier" as const },
  { username: "loja2", password: "Loja#2026demo", fullName: "Ana Kitanda", phone: "+244923000005", userType: "supplier" as const },
  { username: "tiarosa", password: "Loja#2026demo", fullName: "Rosa Bolos", phone: "+244923000008", userType: "supplier" as const },
  { username: "estafeta", password: "Estafeta#2026", fullName: "Carlos Estafeta", phone: "+244923000006", userType: "driver" as const },
  { username: "estafeta2", password: "Estafeta#2026", fullName: "Rui Novo", phone: "+244923000007", userType: "driver" as const, pending: true },
];

/** Dados de demonstração (só se a base de dados ainda não tiver lojas). */
export async function seedDemoData() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(stores);
  if (n > 0) return;
  console.log("[seed] a criar dados de demonstração…");

  await db.transaction(async (tx) => {
    const ids: Record<string, number> = {};
    for (const u of DEMO_USERS) {
      const [row] = await tx.insert(users).values({
        username: u.username, passwordHash: await bcrypt.hash(u.password, 10), fullName: u.fullName, phone: u.phone,
        userType: u.userType, isApproved: !("pending" in u && u.pending), referralCode: code(),
      }).returning();
      ids[u.username] = row.id;
    }

    await tx.insert(addresses).values([
      { userId: ids.cliente, label: "Casa", street: "Rua 5, Condomínio Belas Business Park, casa 12", zone: "Talatona", reference: "Perto do Belas Shopping", latitude: -8.9220, longitude: 13.1870, isDefault: true },
      { userId: ids.cliente, label: "Trabalho", street: "Av. 4 de Fevereiro, 82", zone: "Ingombota", latitude: -8.8130, longitude: 13.2330, isDefault: false },
      { userId: ids.cliente2, label: "Casa", street: "Centralidade do Kilamba, Bloco T, 3ºB", zone: "Kilamba", latitude: -8.9950, longitude: 13.2690, isDefault: true },
    ]);

    for (const s of STORES) {
      const [store] = await tx.insert(stores).values({
        ownerId: s.owner ? ids[s.owner] : null, name: s.name, storeType: s.storeType, description: s.description,
        cuisines: s.cuisines, isChain: !!s.isChain, phone: "+244923100100", street: s.street, zone: s.zone,
        latitude: s.lat, longitude: s.lng, zonesServed: s.zonesServed, openingTime: s.open ?? "00:00", closingTime: s.close ?? "00:00",
        isOpen: true, isApproved: s.approved ?? true, isHomeBusiness: !!s.home, minNoticeMin: s.noticeMin ?? 0, maxOrdersPerDay: s.maxPerDay ?? null, deliveryFee: s.deliveryFee, minOrder: s.minOrder ?? 0,
        deliveryTimeMin: s.time, prepTimeMin: Math.round(s.time / 2),
        // sem avaliações inventadas: a média nasce das avaliações reais dos clientes
      }).returning();
      let order = 0;
      for (const [sectionName, items] of Object.entries(s.menu)) {
        const [section] = await tx.insert(menuSections).values({ storeId: store.id, name: sectionName, sortOrder: order++ }).returning();
        for (const it of items) {
          const [mi] = await tx.insert(menuItems).values({
            storeId: store.id, sectionId: section.id, name: it.name, description: it.description ?? null, price: it.price,
            dietaryTags: it.dietary ?? [], allergens: it.allergens ?? [], isPopular: !!it.popular,
          }).returning();
          for (const [gi, g] of (it.groups ?? []).entries()) {
            const [grp] = await tx.insert(optionGroups).values({ menuItemId: mi.id, name: g.name, minSelect: g.min, maxSelect: g.max, sortOrder: gi }).returning();
            await tx.insert(options).values(g.options.map(([name, priceDelta]) => ({ groupId: grp.id, name, priceDelta })));
          }
        }
      }
    }

    await tx.insert(promoCodes).values([
      { code: "BEMVINDO", description: "20% na primeira encomenda (máx. 2.000 Kz)", discountType: "percent", value: 20, maxDiscount: 2000, firstOrderOnly: true },
      { code: "ENTREGAGRATIS", description: "Entrega grátis em encomendas a partir de 5.000 Kz", discountType: "free_delivery", value: 0, minOrder: 5000, maxUsesPerUser: 3 },
      { code: "PLUS10", description: "10% exclusivo PedeAí Plus", discountType: "percent", value: 10, maxDiscount: 3000, plusOnly: true, maxUsesPerUser: 5 },
    ]);
  });
  console.log("[seed] pronto. Contas de teste em replit.md");
}
