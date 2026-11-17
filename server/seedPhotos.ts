type PhotoKey =
  | "banana" | "beans" | "beefStew" | "bitoque" | "bread" | "bulb" | "burger"
  | "cachupa" | "cake" | "calulu" | "cappuccino" | "carbonara" | "cassavaCake"
  | "chicken" | "cleaning" | "cocktail" | "coffee" | "coconut" | "edamame" | "eggs"
  | "extension" | "firstaid" | "fish" | "fishSoup" | "fries" | "fruit" | "gift"
  | "grocery" | "gyoza" | "icecream" | "juice" | "lasagna" | "milk" | "milkshake"
  | "mousse" | "muamba" | "mufete" | "octopus" | "oil" | "onionRings" | "orchid"
  | "passionJuice" | "pasta" | "pastries" | "peanutCake" | "peanutSweet" | "pizza"
  | "pizzaSeafood" | "plantain" | "prawns" | "pudding" | "ribs" | "roses" | "salad"
  | "sandwich" | "sanitizer" | "shea" | "skewers" | "soup" | "steak" | "sushi"
  | "thermometer" | "tomato" | "vegetables" | "veggieBurger" | "veggieSushi" | "wings";

const STORE_PHOTOS: Record<string, PhotoKey> = {
  "grelhados do mussulo": "chicken",
  "burger station": "burger",
  "pizzaria ilha": "pizza",
  "sushi baía": "sushi",
  "mercado fresco talatona": "grocery",
  "farmácia saúde+": "firstaid",
  "flores de luanda": "roses",
  "casa & oficina": "extension",
  "beleza natural": "shea",
  "bolos da tia rosa": "cake",
  "kitanda da avó (pendente)": "muamba",
  "mariato restaurante grill": "mufete",
};

const ITEM_PHOTOS: Array<[RegExp, PhotoKey]> = [
  [/\bmuamba\b|moambe/, "muamba"],
  [/\bmufete\b/, "mufete"],
  [/\bcalulu\b|\bkizaca\b|folhas de mandioca/, "calulu"],
  [/bacalhau.*natas/, "fish"],
  [/bacalhau.*br[aá]s|bacalhau dourado/, "bitoque"],
  [/arroz.*marisco|marisco.*arroz/, "pizzaSeafood"],
  [/cachupa/, "cachupa"],
  [/bolo de ginguba/, "peanutCake"],
  [/bolo de mandioca/, "cassavaCake"],
  [/polvo|choco|lulas|calamari/, "octopus"],
  [/camar[aã]o|gambas|shrimp/, "prawns"],
  [/peixe|garoupa|cacusso|fish/, "fish"],
  [/picanha|bife|vazia|lombo|bovina|carne grelh|steak/, "steak"],
  [/espetada|espeto|skewer/, "skewers"],
  [/frango|galinha|chicken/, "chicken"],
  [/costela|entrecosto|ribs/, "ribs"],
  [/hamb[uú]rguer|burger/, "burger"],
  [/pizza/, "pizza"],
  [/sushi|combinado.*pe[cç]as/, "sushi"],
  [/gyoza/, "gyoza"],
  [/edamame/, "edamame"],
  [/salada|abacate|avocado/, "salad"],
  [/legumes|beringela|vegetable/, "vegetables"],
  [/feij[aã]o|beans/, "beans"],
  [/banana/, "plantain"],
  [/batata frita|french fries/, "fries"],
  [/past[eé]is|empanada|pastel de|salgado|riss[oó]is/, "pastries"],
  [/sopa|caldo/, "soup"],
  [/guisado|estufado|stew/, "beefStew"],
  [/ginguba|jinguba|amendoim|peanut/, "peanutSweet"],
  [/bolo|cake/, "cake"],
  [/mousse/, "mousse"],
  [/pudim|pudding/, "pudding"],
  [/gelado|sorvete|ice cream/, "icecream"],
  [/sumo de maracuj[aá]|passion fruit/, "passionJuice"],
  [/agua|[aá]gua|refrigerante|soda|bebida|mineral/, "juice"],
  [/sumo|juice|anan[aá]s/, "juice"],
  [/cocktail|coquetel|mocktail/, "cocktail"],
  [/cappuccino|gal[aã]o/, "cappuccino"],
  [/caf[eé]|espresso/, "coffee"],
  [/milkshake/, "milkshake"],
  [/fritas|chips|mandioca|funge|fufu/, "mufete"],
  [/arroz|rice/, "cachupa"],
  [/banana|fruta|fruits/, "fruit"],
  [/tomate|tomato/, "tomato"],
  [/ovos|ovo|egg/, "eggs"],
  [/p[aã]o|bread/, "bread"],
  [/leite|milk/, "milk"],
  [/[oó]leo|oil/, "oil"],
  [/detergente|limpeza|clean/, "cleaning"],
  [/higien|sanit|[aá]lcool gel/, "sanitizer"],
  [/solar|protetor|sunscreen/, "shea"],
  [/primeiros socorros|kit de primeiros|first aid/, "firstaid"],
  [/term[oô]metro|thermometer/, "thermometer"],
  [/rosa|bouquet|ramo/, "roses"],
  [/orqu[ií]dea|orchid/, "orchid"],
  [/cesto de frutas|fruit basket/, "fruit"],
  [/l[aâ]mpada|bulb/, "bulb"],
  [/extens[aã]o el[eé]ctrica|power strip/, "extension"],
  [/chaves|ferramentas|tool kit/, "extension"],
  [/caixa de oferta|presente|gift box/, "gift"],
  [/karit[eé]|shea butter/, "shea"],
  [/coco|coconut/, "coconut"],
  [/pasta|esparguete|carbonara/, "pasta"],
  [/lasanha|lasagna/, "lasagna"],
  [/vegetarian.*sushi/, "veggieSushi"],
  [/veg(gie|an)|vegetar/, "veggieBurger"],
  [/bitoque|prego|bifana|sandwich/, "sandwich"],
];

function photoUrl(key: PhotoKey): string {
  return `/photos/catalog/${key}.jpg`;
}

/** Free, credited catalogue imagery for demo-store photography. */
export function photoForStore(name: string): string {
  return photoUrl(STORE_PHOTOS[name.toLocaleLowerCase("pt") as keyof typeof STORE_PHOTOS] ?? "grocery");
}

/** A relevant illustrative catalogue image; missing matches use the store cover. */
export function photoForMenuItem(itemName: string, storeName: string): string {
  const normalized = itemName
    .toLocaleLowerCase("pt")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const match = ITEM_PHOTOS.find(([pattern]) => pattern.test(normalized));
  return photoUrl(match?.[1] ?? STORE_PHOTOS[storeName.toLocaleLowerCase("pt") as keyof typeof STORE_PHOTOS] ?? "grocery");
}
