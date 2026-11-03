import type { StoreSeed, OptGroup } from "./seed";

/**
 * Mariato Restaurante Grill — parceiro-âncora (grupo Two Palm Trees).
 * Menu copiado da folha "Mariato Menu" (a mesma que alimenta mariatogrill.com) a 3 Nov 2026.
 * Ficam de fora as bebidas alcoólicas (a entrega de álcool exige verificação de idade — fase posterior).
 * Preços em intervalo na folha (ex.: acompanhamentos 1 200 – 1 800 Kz) usam o valor mais baixo + opções.
 * Abre a 19 de Dezembro de 2026; os horários abaixo são provisórios até a gerência os confirmar.
 */
const PONTO: OptGroup = { name: "Ponto da carne", min: 1, max: 1, options: [["Mal passado", 0], ["Ao ponto", 0], ["Bem passado", 0]] };
const PICANTE: OptGroup = { name: "Picante (gindungo)", min: 1, max: 1, options: [["Sem picante", 0], ["Médio", 0], ["Muito picante", 0]] };
const ACOMP: OptGroup = {
  name: "Acompanhamento extra", min: 0, max: 2,
  options: [["Funge de bombó", 1200], ["Arroz branco", 1200], ["Feijão de óleo de palma", 1200], ["Banana-pão frita", 1200], ["Batata frita da casa", 1200]],
};

export const MARIATO: StoreSeed = {
  name: "Mariato Restaurante Grill", storeType: "restaurant", cuisines: ["Grelhados", "Angolana", "Portuguesa"],
  zone: "Camama", street: "Bairro do Camama 2, final do viaduto (lado direito), Kilamba", lat: -8.977855, lng: 13.251019,
  zonesServed: ["Camama", "Kilamba", "Talatona", "Benfica", "Patriota", "Morro Bento"],
  deliveryFee: 1000, time: 40, owner: "mariato", open: "11:00", close: "23:00", phone: "+244927671480",
  description: "Boa carne, bom carvão e tempo para a grelha fazer o seu trabalho. Grelhados, cozinha angolana e portuguesa. Uma empresa Two Palm Trees.",
  menu: {
    "Menu executivo": [
      { name: "Menu Executivo", price: 8500, description: "Almoço de terça a sexta: prato do dia angolano ou grelhado + água, sumo ou refrigerante + café." },
    ],
    "Petiscos e sopas": [
      { name: "Jinguba torrada", price: 1500, description: "Amendoim torrado.", dietary: ["vegan", "vegetarian", "gluten_free"], allergens: ["peanuts"] },
      { name: "Chips de mandioca ou batata-doce", price: 1800, description: "Com molho de gindungo.", dietary: ["vegan", "vegetarian", "gluten_free", "spicy"], groups: [
        { name: "Escolha", min: 1, max: 1, options: [["Mandioca", 0], ["Batata-doce", 0]] },
      ] },
      { name: "Pastel de massa tenra / salgado", price: 1000, description: "Por unidade.", allergens: ["gluten", "eggs"] },
      { name: "Asinhas de frango grelhadas", price: 3500, description: "Asas de frango na grelha." },
      { name: "Pica-pau do lombo", price: 4000, description: "Lombo em pedaços com molho de alho e vinho." },
      { name: "Choco frito", price: 6500, description: "Choco frito estaladiço.", allergens: ["seafood", "gluten"] },
      { name: "Camarão ao alho", price: 7000, description: "Camarão salteado com alho.", allergens: ["seafood"] },
      { name: "Gambas ao alho", price: 14500, description: "Gambas salteadas com alho.", allergens: ["seafood"] },
      { name: "Sopa do dia", price: 1800, description: "Sopa do dia." },
      { name: "Caldo de peixe", price: 3500, description: "Caldo de peixe.", allergens: ["fish"] },
    ],
    "Cozinha angolana": [
      { name: "Guisado de beringela com funge", price: 10500, description: "Guisado de beringela com funge (vegetariano).", dietary: ["vegetarian", "gluten_free"] },
      { name: "Kizaca com peixe seco e funge", price: 11500, description: "Folhas de mandioca com peixe seco e funge.", allergens: ["fish"], dietary: ["gluten_free"] },
      { name: "Feijão de óleo de palma com peixe frito", price: 12000, description: "Feijão de óleo de palma com peixe frito.", allergens: ["fish"] },
      { name: "Muamba de galinha com funge", price: 12500, description: "Muamba de galinha com funge.", popular: true, dietary: ["gluten_free"], groups: [PICANTE] },
      { name: "Cabidela de galinha com funge", price: 12500, description: "Cabidela de galinha com funge.", dietary: ["gluten_free"] },
      { name: "Funge com carne seca", price: 12500, description: "Funge com carne seca.", dietary: ["gluten_free"] },
      { name: "Calulu de peixe seco e fresco com funge", price: 13000, description: "Calulu de peixe seco e fresco com funge.", allergens: ["fish"], dietary: ["gluten_free"] },
      { name: "Mufete", price: 13500, description: "Peixe na brasa, feijão de óleo de palma, banana, batata-doce e mandioca.", allergens: ["fish"], popular: true },
      { name: "Caldeirada de cabrito com funge", price: 13500, description: "Caldeirada de cabrito com funge.", dietary: ["gluten_free"] },
    ],
    "Da grelha": [
      { name: "Picanha no Espeto", price: 24000, description: "Picanha assada inteira no espeto, com chimichurri.", popular: true, groups: [PONTO, ACOMP] },
      { name: "Picanha na Brasa", price: 12500, description: "Picanha na brasa com feijão preto e banana.", popular: true, groups: [PONTO, ACOMP] },
      { name: "T-Bone", price: 16500, description: "T-bone de corte alto com pimentos e cogumelos grelhados.", popular: true, groups: [PONTO, ACOMP] },
      { name: "Frango à Mariato", price: 7000, description: "Frango grelhado com gindungo e limão.", popular: true, dietary: ["spicy", "gluten_free"], groups: [PICANTE, ACOMP] },
      { name: "Entrecosto de porco na brasa", price: 8000, description: "Entrecosto de porco na brasa.", groups: [ACOMP] },
      { name: "Bife da vazia", price: 9000, description: "Bife da vazia grelhado.", groups: [PONTO, ACOMP] },
      { name: "Lombinho de novilho", price: 13000, description: "Lombinho de novilho grelhado.", groups: [PONTO, ACOMP] },
      { name: "Espetada Mista (2 pessoas)", price: 32000, description: "Vaca, frango, linguiça e pimentos no espeto. Para duas pessoas.", groups: [ACOMP] },
    ],
    "Do mar": [
      { name: "Peixe do dia na brasa", price: 10500, description: "Peixe do dia na brasa.", allergens: ["fish"], groups: [
        { name: "Peixe", min: 1, max: 1, options: [["Corvina", 0], ["Garoupa", 0], ["Cacusso", 0]] }, ACOMP,
      ] },
      { name: "Cacusso Grelhado", price: 13500, description: "Cacusso inteiro grelhado no carvão, com funge e jindungo.", allergens: ["fish"], dietary: ["gluten_free"] },
      { name: "Garoupa na Brasa", price: 19000, description: "Filete de garoupa grelhado em manteiga de limão com salsa fresca.", allergens: ["fish", "dairy"], popular: true, groups: [ACOMP] },
      { name: "Camarão Tigre", price: 26000, description: "Camarão tigre aberto com alho, ervas e lima.", allergens: ["seafood"], popular: true, groups: [ACOMP] },
    ],
    "Para partilhar": [
      { name: "Tábua mista de carnes (2 pessoas)", price: 26000, description: "Tábua de carnes grelhadas para duas pessoas." },
      { name: "Grelhada do mar (2 pessoas)", price: 28000, description: "Peixe, gambas, choco e lulas para duas pessoas.", allergens: ["fish", "seafood"] },
      { name: "Tábua Mariato terra e mar (4 pessoas)", price: 62000, description: "Carnes e marisco para quatro pessoas.", allergens: ["seafood"] },
    ],
    "Pratos verdes": [
      { name: "Salada de Abacate", price: 7500, description: "Alface romana, abacate maduro, romã e pinhões torrados com limão.", dietary: ["vegan", "vegetarian", "gluten_free"], allergens: ["nuts"], popular: true },
      { name: "Legumes na Brasa", price: 6500, description: "Espargos, pimentos, cogumelos, curgete e cebola roxa, tudo da grelha.", dietary: ["vegan", "vegetarian", "gluten_free"], popular: true },
    ],
    "Clássicos": [
      { name: "Bifana no pão", price: 3500, description: "Bifana no pão.", allergens: ["gluten"] },
      { name: "Prego no pão", price: 5500, description: "Prego no pão.", allergens: ["gluten"] },
      { name: "Hambúrguer Mariato", price: 6500, description: "Hambúrguer da casa.", allergens: ["gluten", "dairy", "eggs"], groups: [PONTO] },
      { name: "Prego no prato", price: 7000, description: "Prego no prato.", groups: [PONTO] },
      { name: "Prego de picanha", price: 7500, description: "Prego de picanha.", allergens: ["gluten"] },
      { name: "Bitoque", price: 8500, description: "Bife com ovo, batata frita e arroz.", allergens: ["eggs"], groups: [PONTO] },
      { name: "Bacalhau à Brás", price: 12500, description: "Bacalhau desfiado com ovo e batata palha.", allergens: ["fish", "eggs"] },
    ],
    "Cozinha portuguesa": [
      { name: "Bacalhau com natas", price: 13500, description: "Bacalhau com natas.", allergens: ["fish", "dairy", "gluten"] },
      { name: "Polvo à lagareiro", price: 18500, description: "Polvo assado com azeite e batata a murro.", allergens: ["seafood"], dietary: ["gluten_free"] },
      { name: "Arroz de marisco (2 pessoas)", price: 32000, description: "Arroz de marisco para duas pessoas.", allergens: ["seafood", "fish"] },
    ],
    "Cozinha do mundo": [
      { name: "Cachupa rica", price: 12500, description: "Cachupa rica (Cabo Verde)." },
      { name: "Esparguete à bolonhesa", price: 8500, description: "Esparguete à bolonhesa.", allergens: ["gluten"] },
      { name: "Esparguete à carbonara", price: 9000, description: "Esparguete à carbonara.", allergens: ["gluten", "eggs", "dairy"] },
      { name: "Lasanha de carne", price: 9500, description: "Lasanha de carne.", allergens: ["gluten", "dairy"] },
      { name: "Penne com camarão", price: 12000, description: "Penne com camarão.", allergens: ["gluten", "seafood"] },
    ],
    "Menu infantil": [
      { name: "Menu infantil", price: 4500, description: "Prato pequeno + sumo + gelado.", groups: [
        { name: "Prato", min: 1, max: 1, options: [["Frango", 0], ["Peixe", 0], ["Hambúrguer", 0]] },
      ] },
    ],
    "Acompanhamentos": [
      { name: "Funge de bombó", price: 1200, description: "Funge de mandioca clássico.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Arroz branco", price: 1200, description: "Arroz branco soltinho.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Feijão de óleo de palma", price: 1200, description: "Feijão cozinhado lentamente em óleo de palma.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Banana-pão frita", price: 1200, description: "Banana-pão frita.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Batata frita da casa", price: 1200, description: "Batata frita cortada à mão.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Farofa", price: 1200, description: "Farinha de mandioca torrada." },
    ],
    "Sobremesas e gelados": [
      { name: "Mousse", price: 1500, description: "Mousse de maracujá ou de chocolate.", allergens: ["eggs", "dairy"], dietary: ["vegetarian"], groups: [
        { name: "Sabor", min: 1, max: 1, options: [["Maracujá", 0], ["Chocolate", 0]] },
      ] },
      { name: "Pudim caseiro ou fruta tropical", price: 2000, description: "Pudim caseiro ou fruta tropical.", groups: [
        { name: "Escolha", min: 1, max: 1, options: [["Pudim caseiro", 0], ["Fruta tropical", 0]] },
      ] },
      { name: "Doce de jinguba", price: 2500, description: "Doce de jinguba.", allergens: ["peanuts"], dietary: ["vegetarian"] },
      { name: "Bolo de mandioca com gelado", price: 3000, description: "Bolo de mandioca com gelado.", allergens: ["dairy", "eggs"], dietary: ["vegetarian"] },
      { name: "Gelado artesanal", price: 1800, description: "Gelado artesanal.", allergens: ["dairy"], dietary: ["vegetarian"], groups: [
        { name: "Bolas", min: 1, max: 1, options: [["2 bolas", 0], ["3 bolas", 800]] },
      ] },
    ],
    "Bebidas": [
      { name: "Água mineral", price: 800, description: "Com ou sem gás.", dietary: ["vegan", "vegetarian", "gluten_free"], groups: [
        { name: "Tamanho", min: 1, max: 1, options: [["0,5 L", 0], ["1,5 L", 700]] },
        { name: "Tipo", min: 1, max: 1, options: [["Sem gás", 0], ["Com gás", 0]] },
      ] },
      { name: "Refrigerante", price: 1200, description: "Refrigerantes.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Sumo natural", price: 2500, description: "Sumo natural da fruta.", dietary: ["vegan", "vegetarian", "gluten_free"], groups: [
        { name: "Fruta", min: 1, max: 1, options: [["Múcua", 0], ["Tamarindo", 0], ["Gajaja", 0], ["Ananás", 0]] },
      ] },
      { name: "Sumo de maracujá", price: 3000, description: "Sumo natural de maracujá.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Cocktail sem álcool", price: 3500, description: "Cocktail sem álcool.", dietary: ["vegetarian"] },
    ],
    "Cafetaria": [
      { name: "Café expresso", price: 1000, description: "Café expresso.", dietary: ["vegan", "vegetarian", "gluten_free"] },
      { name: "Galão ou cappuccino", price: 1800, description: "Galão ou cappuccino.", allergens: ["dairy"], dietary: ["vegetarian"], groups: [
        { name: "Escolha", min: 1, max: 1, options: [["Galão", 0], ["Cappuccino", 0]] },
      ] },
    ],
  },
};
