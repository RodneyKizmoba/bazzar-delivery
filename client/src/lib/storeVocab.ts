import { useQuery } from "@tanstack/react-query";
import type { Tr } from "@/lib/i18n";

/**
 * Palavras do portal da loja conforme o tipo de negócio: um restaurante tem "Menu" e "cozinha";
 * uma farmácia tem "Produtos" e "lista de separação"; uma florista tem "Catálogo" e "Ramos, Arranjos".
 */
export interface StoreVocab {
  catalog: Tr; emptyIcon: string; emptyTitle: Tr; sectionExample: Tr; categories: Tr; categoriesExample: Tr;
  ticket: Tr; busyExample: Tr; integration: Tr;
}

const KITCHEN = { pt: "Imprimir talão da cozinha", en: "Print kitchen ticket", fr: "Imprimer le ticket cuisine" };
const PICKLIST = { pt: "Imprimir lista de separação", en: "Print picking list", fr: "Imprimer la liste de préparation" };
const PREP_SHEET = { pt: "Imprimir ficha de preparação", en: "Print preparation sheet", fr: "Imprimer la fiche de préparation" };
const CATALOG = { pt: "Catálogo", en: "Catalogue", fr: "Catalogue" };
const PRODUCTS = { pt: "Produtos", en: "Products", fr: "Produits" };
const MENU = { pt: "Menu", en: "Menu", fr: "Menu" };
const CATEGORIES = { pt: "Categorias (separe por vírgulas)", en: "Categories (comma separated)", fr: "Catégories (séparées par des virgules)" };
const TILL = { pt: "Integração com a caixa / POS", en: "Till / POS integration", fr: "Intégration caisse / POS" };

const VOCAB: Record<string, StoreVocab> = {
  restaurant: {
    catalog: MENU, emptyIcon: "🍽️", emptyTitle: { pt: "O seu menu está vazio", en: "Your menu is empty", fr: "Votre menu est vide" },
    sectionExample: { pt: "Ex.: Grelhados, Bebidas…", en: "E.g. Grills, Drinks…", fr: "Ex. : Grillades, Boissons…" },
    categories: { pt: "Cozinhas / categorias (separe por vírgulas)", en: "Cuisines / categories (comma separated)", fr: "Cuisines / catégories (séparées par des virgules)" },
    categoriesExample: { pt: "Ex.: Angolana, Grelhados", en: "E.g. Angolan, Grills", fr: "Ex. : Angolaise, Grillades" },
    ticket: KITCHEN, busyExample: { pt: "Ex.: produto esgotado, cozinha cheia…", en: "E.g. out of stock, kitchen full…", fr: "Ex. : rupture de stock, cuisine pleine…" },
    integration: { pt: "Integração com a cozinha / POS", en: "Kitchen / POS integration", fr: "Intégration cuisine / caisse" },
  },
  bakery: {
    catalog: MENU, emptyIcon: "🧁", emptyTitle: { pt: "O seu menu está vazio", en: "Your menu is empty", fr: "Votre menu est vide" },
    sectionExample: { pt: "Ex.: Bolos, Salgados, Bebidas…", en: "E.g. Cakes, Savouries, Drinks…", fr: "Ex. : Gâteaux, Salés, Boissons…" },
    categories: { pt: "Especialidades (separe por vírgulas)", en: "Specialities (comma separated)", fr: "Spécialités (séparées par des virgules)" },
    categoriesExample: { pt: "Ex.: Bolos de aniversário, Pastelaria", en: "E.g. Birthday cakes, Pastries", fr: "Ex. : Gâteaux d'anniversaire, Pâtisserie" },
    ticket: PREP_SHEET, busyExample: { pt: "Ex.: esgotado, forno cheio…", en: "E.g. sold out, oven full…", fr: "Ex. : épuisé, four plein…" }, integration: TILL,
  },
  grocery: {
    catalog: PRODUCTS, emptyIcon: "🛒", emptyTitle: { pt: "Ainda não tem produtos", en: "No products yet", fr: "Aucun produit" },
    sectionExample: { pt: "Ex.: Frescos, Bebidas, Limpeza…", en: "E.g. Fresh, Drinks, Cleaning…", fr: "Ex. : Frais, Boissons, Entretien…" },
    categories: CATEGORIES, categoriesExample: { pt: "Ex.: Mercearia, Frescos", en: "E.g. Groceries, Fresh", fr: "Ex. : Épicerie, Frais" },
    ticket: PICKLIST, busyExample: { pt: "Ex.: produto esgotado, loja cheia…", en: "E.g. out of stock, store busy…", fr: "Ex. : rupture de stock, magasin plein…" }, integration: TILL,
  },
  pharmacy: {
    catalog: PRODUCTS, emptyIcon: "💊", emptyTitle: { pt: "Ainda não tem produtos", en: "No products yet", fr: "Aucun produit" },
    sectionExample: { pt: "Ex.: Sem receita, Higiene, Bebé…", en: "E.g. Over the counter, Hygiene, Baby…", fr: "Ex. : Sans ordonnance, Hygiène, Bébé…" },
    categories: CATEGORIES, categoriesExample: { pt: "Ex.: Medicamentos, Higiene", en: "E.g. Medicines, Hygiene", fr: "Ex. : Médicaments, Hygiène" },
    ticket: PICKLIST, busyExample: { pt: "Ex.: produto esgotado, precisa de receita…", en: "E.g. out of stock, needs a prescription…", fr: "Ex. : rupture, ordonnance nécessaire…" }, integration: TILL,
  },
  flowers: {
    catalog: CATALOG, emptyIcon: "💐", emptyTitle: { pt: "O seu catálogo está vazio", en: "Your catalogue is empty", fr: "Votre catalogue est vide" },
    sectionExample: { pt: "Ex.: Ramos, Arranjos, Plantas…", en: "E.g. Bouquets, Arrangements, Plants…", fr: "Ex. : Bouquets, Compositions, Plantes…" },
    categories: { pt: "Estilos / categorias (separe por vírgulas)", en: "Styles / categories (comma separated)", fr: "Styles / catégories (séparés par des virgules)" },
    categoriesExample: { pt: "Ex.: Rosas, Casamentos", en: "E.g. Roses, Weddings", fr: "Ex. : Roses, Mariages" },
    ticket: PREP_SHEET, busyExample: { pt: "Ex.: flor esgotada, muitos pedidos…", en: "E.g. flower sold out, too many orders…", fr: "Ex. : fleur épuisée, trop de commandes…" }, integration: TILL,
  },
  beauty: {
    catalog: CATALOG, emptyIcon: "💄", emptyTitle: { pt: "O seu catálogo está vazio", en: "Your catalogue is empty", fr: "Votre catalogue est vide" },
    sectionExample: { pt: "Ex.: Cabelo, Pele, Maquilhagem…", en: "E.g. Hair, Skin, Make-up…", fr: "Ex. : Cheveux, Peau, Maquillage…" },
    categories: CATEGORIES, categoriesExample: { pt: "Ex.: Cosmética, Perfumes", en: "E.g. Cosmetics, Perfumes", fr: "Ex. : Cosmétiques, Parfums" },
    ticket: PICKLIST, busyExample: { pt: "Ex.: produto esgotado…", en: "E.g. out of stock…", fr: "Ex. : rupture de stock…" }, integration: TILL,
  },
  retail: {
    catalog: CATALOG, emptyIcon: "🛍️", emptyTitle: { pt: "O seu catálogo está vazio", en: "Your catalogue is empty", fr: "Votre catalogue est vide" },
    sectionExample: { pt: "Ex.: Novidades, Acessórios…", en: "E.g. New in, Accessories…", fr: "Ex. : Nouveautés, Accessoires…" },
    categories: CATEGORIES, categoriesExample: { pt: "Ex.: Presentes, Electrónica", en: "E.g. Gifts, Electronics", fr: "Ex. : Cadeaux, Électronique" },
    ticket: PICKLIST, busyExample: { pt: "Ex.: produto esgotado…", en: "E.g. out of stock…", fr: "Ex. : rupture de stock…" }, integration: TILL,
  },
};

export function vocabFor(storeType: string | null | undefined): StoreVocab {
  return VOCAB[storeType ?? ""] ?? VOCAB.restaurant;
}

/** Vocabulário da loja de quem está no portal (usa a mesma consulta que o resto do portal). */
export function useStoreVocab() {
  const { data } = useQuery<{ store: { storeType?: string } }>({ queryKey: ["/api/partner/store"] });
  return vocabFor(data?.store?.storeType);
}
