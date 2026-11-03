import type { ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Mail, MessageCircle, Phone } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useT, type Tr } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/info/NotFound";
import type { Meta } from "@/pages/customer/Home";

const SUPPORT_EMAIL = "suporte@bazzardelivery.ao";
// Contactos provisórios — substituir pelos números reais antes do lançamento.
const SUPPORT_PHONE = "+244 900 000 000";
const SUPPORT_WHATSAPP = "244900000000";

const PAGES: Record<string, Tr> = {
  sobre: { pt: "Sobre nós", en: "About us", fr: "À propos" },
  termos: { pt: "Termos e Condições", en: "Terms and Conditions", fr: "Conditions générales" },
  privacidade: { pt: "Política de Privacidade", en: "Privacy Policy", fr: "Politique de confidentialité" },
  suporte: { pt: "Ajuda e suporte", en: "Help & support", fr: "Aide et support" },
};

type Block = { h: Tr; p: Tr[] };

function Prose({ blocks }: { blocks: Block[] }) {
  const t = useT();
  return (
    <div className="space-y-6">
      {blocks.map((b, i) => (
        <section key={i}>
          <h2 className="mb-1.5 text-base font-bold text-neutral-900">{t(b.h)}</h2>
          <div className="space-y-2 text-sm leading-relaxed text-neutral-700">
            {b.p.map((p, j) => <p key={j}>{t(p)}</p>)}
          </div>
        </section>
      ))}
    </div>
  );
}

function DraftNote() {
  const t = useT();
  return (
    <div role="note" className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {t({ pt: "Rascunho — rever com um advogado antes do lançamento.", en: "Draft — review with a lawyer before launch.", fr: "Brouillon — à faire relire par un avocat avant le lancement." })}
    </div>
  );
}

function Updated() {
  const t = useT();
  return <p className="mb-4 text-xs text-neutral-500">{t({ pt: "Última actualização: Novembro de 2026", en: "Last updated: November 2026", fr: "Dernière mise à jour : novembre 2026" })}</p>;
}

// ---------------------------------------------------------------------------

function About() {
  const t = useT();
  const blocks: Block[] = [
    {
      h: { pt: "Quem somos", en: "Who we are", fr: "Qui sommes-nous" },
      p: [{
        pt: "A BazzarDelivery é uma plataforma de entregas feita em Luanda, para Luanda. Ligamos clientes a restaurantes, supermercados, farmácias e outras lojas locais, e a estafetas que entregam à porta — de Talatona ao Cazenga, do Kilamba à Ilha.",
        en: "BazzarDelivery is a delivery platform made in Luanda, for Luanda. We connect customers with restaurants, supermarkets, pharmacies and other local shops, and with riders who deliver to your door — from Talatona to Cazenga, from Kilamba to the Ilha.",
        fr: "BazzarDelivery est une plateforme de livraison créée à Luanda, pour Luanda. Nous relions les clients aux restaurants, supermarchés, pharmacies et autres commerces locaux, ainsi qu'aux livreurs qui livrent à domicile — de Talatona à Cazenga, de Kilamba à l'Ilha.",
      }],
    },
    {
      h: { pt: "O que oferecemos", en: "What we offer", fr: "Ce que nous proposons" },
      p: [
        { pt: "Encomendas imediatas ou agendadas, acompanhamento em tempo real, encomendas em grupo, pagamento em numerário, Multicaixa Express, Unitel Money e outros métodos locais.", en: "On-demand or scheduled orders, real-time tracking, group orders, and payment by cash, Multicaixa Express, Unitel Money and other local methods.", fr: "Commandes immédiates ou programmées, suivi en temps réel, commandes groupées et paiement en espèces, Multicaixa Express, Unitel Money et autres moyens locaux." },
        { pt: "Com o Bazzar Plus tem entregas grátis em encomendas elegíveis, e cada encomenda acumula pontos que pode trocar por descontos.", en: "With Bazzar Plus you get free delivery on eligible orders, and every order earns points you can redeem for discounts.", fr: "Avec Bazzar Plus, la livraison est gratuite sur les commandes éligibles, et chaque commande rapporte des points échangeables contre des réductions." },
      ],
    },
    {
      h: { pt: "Para lojas e estafetas", en: "For stores and riders", fr: "Pour les commerces et livreurs" },
      p: [{ pt: "Tem um negócio ou quer fazer entregas? Crie uma conta de loja ou de estafeta — a nossa equipa verifica os dados e activa a conta.", en: "Run a business or want to deliver? Create a store or rider account — our team reviews your details and activates the account.", fr: "Vous avez un commerce ou souhaitez livrer ? Créez un compte magasin ou livreur — notre équipe vérifie vos informations et active le compte." }],
    },
  ];
  return (
    <>
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary to-orange-500 p-5 text-white">
        <p className="text-3xl" aria-hidden>🛵</p>
        <p className="mt-2 text-xl font-extrabold">BazzarDelivery</p>
        <p className="text-sm text-white/90">{t({ pt: "Tudo o que precisa, entregue em Luanda.", en: "Everything you need, delivered in Luanda.", fr: "Tout ce qu'il vous faut, livré à Luanda." })}</p>
      </div>
      <Prose blocks={blocks} />
      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/registar"><Button>{t({ pt: "Criar conta", en: "Sign up", fr: "Créer un compte" })}</Button></Link>
        <Link href="/info/suporte"><Button variant="outline">{t({ pt: "Contactar-nos", en: "Contact us", fr: "Nous contacter" })}</Button></Link>
      </div>
    </>
  );
}

function Terms() {
  const meta = useQuery<Meta>({ queryKey: ["/api/meta"], staleTime: 5 * 60_000 });
  const kzPerPoint = meta.data?.points.kzPerPointEarned ?? 100;
  const pointValue = meta.data?.points.pointValueKz;
  const maxPct = meta.data?.points.maxDiscountPct;
  const pv = pointValue != null ? kz(pointValue) : null;

  const blocks: Block[] = [
    {
      h: { pt: "1. Âmbito", en: "1. Scope", fr: "1. Objet" },
      p: [{ pt: "A BazzarDelivery é um mercado online que liga clientes a lojas parceiras e estafetas independentes em Luanda, Angola. Os produtos são vendidos pelas lojas; a BazzarDelivery facilita a encomenda, o pagamento e a entrega. Ao usar a plataforma aceita estes termos.", en: "BazzarDelivery is an online marketplace connecting customers with partner stores and independent riders in Luanda, Angola. Products are sold by the stores; BazzarDelivery facilitates ordering, payment and delivery. By using the platform you accept these terms.", fr: "BazzarDelivery est une place de marché en ligne reliant les clients aux commerces partenaires et à des livreurs indépendants à Luanda, Angola. Les produits sont vendus par les commerces ; BazzarDelivery facilite la commande, le paiement et la livraison. En utilisant la plateforme, vous acceptez ces conditions." }],
    },
    {
      h: { pt: "2. Contas", en: "2. Accounts", fr: "2. Comptes" },
      p: [{ pt: "Deve ter pelo menos 18 anos (ou autorização de um responsável legal) e fornecer dados verdadeiros. É responsável pela confidencialidade da sua palavra-passe e por toda a actividade na sua conta. Contas de loja e de estafeta estão sujeitas a verificação e aprovação. Podemos suspender contas em caso de fraude, abuso ou violação destes termos.", en: "You must be at least 18 (or have a legal guardian's consent) and provide accurate information. You are responsible for keeping your password confidential and for all activity on your account. Store and rider accounts are subject to verification and approval. We may suspend accounts for fraud, abuse or breach of these terms.", fr: "Vous devez avoir au moins 18 ans (ou l'accord d'un représentant légal) et fournir des informations exactes. Vous êtes responsable de la confidentialité de votre mot de passe et de toute activité sur votre compte. Les comptes magasin et livreur sont soumis à vérification et approbation. Nous pouvons suspendre un compte en cas de fraude, d'abus ou de violation des présentes conditions." }],
    },
    {
      h: { pt: "3. Encomendas e preços", en: "3. Orders and prices", fr: "3. Commandes et prix" },
      p: [
        { pt: "Os preços são definidos pelas lojas e apresentados em Kwanzas (Kz), com IVA incluído quando aplicável. O total final — produtos, taxa de entrega, descontos e pontos — é mostrado antes de confirmar. A encomenda fica concluída quando a loja a aceita; a loja pode recusá-la (por exemplo, por falta de stock), caso em que não é cobrado.", en: "Prices are set by stores and shown in Kwanzas (Kz), including VAT where applicable. The final total — items, delivery fee, discounts and points — is shown before you confirm. An order is binding once the store accepts it; the store may reject it (e.g. out of stock), in which case you are not charged.", fr: "Les prix sont fixés par les commerces et affichés en kwanzas (Kz), TVA incluse le cas échéant. Le total final — articles, frais de livraison, réductions et points — est affiché avant confirmation. La commande est ferme dès son acceptation par le commerce ; celui-ci peut la refuser (ex. rupture de stock), auquel cas vous n'êtes pas débité." },
        { pt: "Os tempos de entrega são estimativas e podem variar com o trânsito, o tempo ou o volume de encomendas.", en: "Delivery times are estimates and may vary with traffic, weather or order volume.", fr: "Les délais de livraison sont indicatifs et peuvent varier selon la circulation, la météo ou le volume de commandes." },
      ],
    },
    {
      h: { pt: "4. Cancelamentos e alterações", en: "4. Cancellations and changes", fr: "4. Annulations et modifications" },
      p: [{ pt: "Pode cancelar gratuitamente até a loja começar a preparar a encomenda. Depois disso, o cancelamento pode não ser possível ou o valor pode não ser reembolsado. Encomendas agendadas podem ser alteradas ou canceladas até a loja as aceitar. Se a loja ou a BazzarDelivery cancelarem, é reembolsado na totalidade pelo método de pagamento original (ou em saldo, se preferir).", en: "You may cancel free of charge until the store starts preparing your order. After that, cancellation may not be possible or the amount may not be refunded. Scheduled orders may be changed or cancelled until the store accepts them. If the store or BazzarDelivery cancels, you are refunded in full to the original payment method (or as credit, if you prefer).", fr: "Vous pouvez annuler gratuitement tant que le commerce n'a pas commencé la préparation. Ensuite, l'annulation peut être impossible ou non remboursée. Les commandes programmées peuvent être modifiées ou annulées jusqu'à leur acceptation par le commerce. Si le commerce ou BazzarDelivery annule, vous êtes intégralement remboursé sur le moyen de paiement initial (ou en crédit, si vous le souhaitez)." }],
    },
    {
      h: { pt: "5. Pagamentos", en: "5. Payments", fr: "5. Paiements" },
      p: [{ pt: "Aceitamos numerário na entrega, Multicaixa Express, Unitel Money, cartão e transferência bancária, consoante a disponibilidade. Pagamentos electrónicos são processados por parceiros licenciados; não guardamos dados completos de cartão. Em pagamento em numerário, tenha o valor pronto — o estafeta pode não ter troco para notas grandes.", en: "We accept cash on delivery, Multicaixa Express, Unitel Money, card and bank transfer, depending on availability. Electronic payments are processed by licensed partners; we do not store full card details. For cash payments, please have the amount ready — riders may not have change for large notes.", fr: "Nous acceptons les espèces à la livraison, Multicaixa Express, Unitel Money, la carte et le virement, selon disponibilité. Les paiements électroniques sont traités par des partenaires agréés ; nous ne conservons pas les données complètes de carte. Pour un paiement en espèces, préparez le montant — le livreur peut ne pas avoir de monnaie pour les grosses coupures." }],
    },
    {
      h: { pt: "6. Bazzar Plus", en: "6. Bazzar Plus", fr: "6. Bazzar Plus" },
      p: [{ pt: "O Bazzar Plus é uma subscrição mensal com renovação automática ao preço indicado no momento da adesão. Pode cancelar a qualquer momento no seu perfil; após o cancelamento mantém as vantagens até ao fim do período já pago e não há novas cobranças. Não há reembolsos parciais de períodos iniciados. As vantagens (por exemplo, entrega grátis acima de um valor mínimo) podem mudar com aviso prévio.", en: "Bazzar Plus is a monthly subscription that renews automatically at the price shown when you join. You can cancel anytime in your profile; after cancelling you keep the benefits until the end of the period already paid and are not charged again. There are no partial refunds for periods already started. Benefits (e.g. free delivery above a minimum order) may change with prior notice.", fr: "Bazzar Plus est un abonnement mensuel à renouvellement automatique au prix indiqué lors de l'adhésion. Vous pouvez résilier à tout moment depuis votre profil ; après résiliation, vous conservez les avantages jusqu'à la fin de la période payée et aucun nouveau prélèvement n'est effectué. Aucun remboursement partiel d'une période entamée. Les avantages (ex. livraison gratuite au-delà d'un minimum) peuvent évoluer avec préavis." }],
    },
    {
      h: { pt: "7. Pontos de fidelidade", en: "7. Loyalty points", fr: "7. Points de fidélité" },
      p: [
        {
          pt: `Ganha 1 ponto por cada ${kz(kzPerPoint)} gastos em encomendas entregues (excluindo taxas de entrega e descontos).${pv ? ` Cada ponto vale ${pv} em descontos` : " Os pontos podem ser usados como desconto"}${maxPct != null ? `, até ${maxPct}% do valor da encomenda` : ""}. Os pontos não têm valor monetário, não são transmissíveis e podem ser anulados em caso de cancelamento, reembolso ou fraude.`,
          en: `You earn 1 point for every ${kz(kzPerPoint)} spent on delivered orders (excluding delivery fees and discounts).${pv ? ` Each point is worth ${pv} in discounts` : " Points can be redeemed as a discount"}${maxPct != null ? `, up to ${maxPct}% of the order value` : ""}. Points have no cash value, are non-transferable and may be reversed for cancellations, refunds or fraud.`,
          fr: `Vous gagnez 1 point pour chaque ${kz(kzPerPoint)} dépensés sur les commandes livrées (hors frais de livraison et réductions).${pv ? ` Chaque point vaut ${pv} de réduction` : " Les points sont utilisables comme réduction"}${maxPct != null ? `, jusqu'à ${maxPct} % du montant de la commande` : ""}. Les points n'ont aucune valeur monétaire, ne sont pas cessibles et peuvent être annulés en cas d'annulation, de remboursement ou de fraude.`,
        },
      ],
    },
    {
      h: { pt: "8. Avaliações", en: "8. Reviews", fr: "8. Avis" },
      p: [{ pt: "Só pode avaliar encomendas que recebeu. As avaliações devem ser honestas e respeitosas. Podemos moderar ou remover conteúdo ofensivo, discriminatório, falso, com dados pessoais ou publicidade. As lojas podem responder publicamente.", en: "You can only review orders you received. Reviews must be honest and respectful. We may moderate or remove content that is offensive, discriminatory, false, contains personal data or advertising. Stores may reply publicly.", fr: "Vous ne pouvez évaluer que les commandes reçues. Les avis doivent être honnêtes et respectueux. Nous pouvons modérer ou supprimer les contenus offensants, discriminatoires, mensongers, contenant des données personnelles ou de la publicité. Les commerces peuvent répondre publiquement." }],
    },
    {
      h: { pt: "9. Responsabilidade", en: "9. Liability", fr: "9. Responsabilité" },
      p: [{ pt: "As lojas são responsáveis pela qualidade, segurança, informação de alergénios e conformidade dos produtos. A BazzarDelivery responde pelos serviços que presta directamente e, na medida permitida por lei, não é responsável por danos indirectos ou por falhas causadas por terceiros ou por motivos de força maior. Nada nestes termos limita os direitos que a lei angolana de defesa do consumidor lhe garante. Se houver um problema com a encomenda (itens em falta, danificados ou errados), contacte o suporte em até 24 horas.", en: "Stores are responsible for the quality, safety, allergen information and compliance of their products. BazzarDelivery is liable for the services it provides directly and, to the extent permitted by law, is not liable for indirect damages or failures caused by third parties or force majeure. Nothing in these terms limits your rights under Angolan consumer protection law. If there is a problem with your order (missing, damaged or wrong items), contact support within 24 hours.", fr: "Les commerces sont responsables de la qualité, de la sécurité, des informations sur les allergènes et de la conformité de leurs produits. BazzarDelivery répond des services qu'elle fournit directement et, dans la mesure permise par la loi, n'est pas responsable des dommages indirects ni des défaillances de tiers ou cas de force majeure. Rien dans ces conditions ne limite vos droits au titre du droit angolais de la consommation. En cas de problème (articles manquants, endommagés ou erronés), contactez le support sous 24 heures." }],
    },
    {
      h: { pt: "10. Alterações e lei aplicável", en: "10. Changes and governing law", fr: "10. Modifications et droit applicable" },
      p: [{ pt: "Podemos actualizar estes termos; avisaremos de alterações relevantes na app. Aplica-se a lei da República de Angola, sendo competentes os tribunais de Luanda.", en: "We may update these terms; we will notify you of material changes in the app. These terms are governed by the law of the Republic of Angola, and the courts of Luanda have jurisdiction.", fr: "Nous pouvons mettre à jour ces conditions ; les changements importants seront signalés dans l'app. Le droit de la République d'Angola s'applique et les tribunaux de Luanda sont compétents." }],
    },
  ];
  return <><DraftNote /><Updated /><Prose blocks={blocks} /></>;
}

function Privacy() {
  const blocks: Block[] = [
    {
      h: { pt: "1. Responsável pelo tratamento", en: "1. Data controller", fr: "1. Responsable du traitement" },
      p: [{ pt: `A BazzarDelivery é responsável pelos dados pessoais tratados na plataforma, nos termos da Lei n.º 22/11 de Protecção de Dados Pessoais de Angola. Contacto: ${SUPPORT_EMAIL}.`, en: `BazzarDelivery is the controller of personal data processed on the platform, under Angola's Personal Data Protection Law (Law 22/11). Contact: ${SUPPORT_EMAIL}.`, fr: `BazzarDelivery est responsable des données personnelles traitées sur la plateforme, conformément à la loi angolaise n° 22/11 sur la protection des données. Contact : ${SUPPORT_EMAIL}.` }],
    },
    {
      h: { pt: "2. Dados que recolhemos", en: "2. Data we collect", fr: "2. Données collectées" },
      p: [
        { pt: "Conta: nome, nome de utilizador, telemóvel, email (opcional), palavra-passe (guardada cifrada), idioma e preferências alimentares.", en: "Account: name, username, phone, email (optional), password (stored hashed), language and dietary preferences.", fr: "Compte : nom, identifiant, téléphone, email (facultatif), mot de passe (stocké chiffré), langue et préférences alimentaires." },
        { pt: "Encomendas: moradas de entrega e pontos de referência, produtos, pagamentos (sem dados completos de cartão), avaliações e contactos com o suporte.", en: "Orders: delivery addresses and landmarks, items, payments (no full card details), reviews and support contacts.", fr: "Commandes : adresses de livraison et repères, articles, paiements (sans données complètes de carte), avis et échanges avec le support." },
        { pt: "Lojas e estafetas: dados do negócio (NIF, morada) ou de identificação necessários à aprovação.", en: "Stores and riders: business details (tax ID, address) or identification needed for approval.", fr: "Commerces et livreurs : informations de l'entreprise (NIF, adresse) ou d'identification nécessaires à l'approbation." },
        { pt: "Localização: a localização dos estafetas é recolhida apenas durante uma entrega activa, para mostrar o percurso ao cliente. Não seguimos a localização dos clientes; usamos a morada que indicar.", en: "Location: riders' location is collected only during an active delivery, to show progress to the customer. We do not track customers' location; we use the address you provide.", fr: "Localisation : la position des livreurs n'est collectée que pendant une livraison en cours, pour afficher le trajet au client. Nous ne suivons pas la position des clients ; nous utilisons l'adresse indiquée." },
      ],
    },
    {
      h: { pt: "3. Para que usamos", en: "3. How we use it", fr: "3. Finalités" },
      p: [{ pt: "Para processar e entregar encomendas, cobrar pagamentos, gerir a subscrição Plus e os pontos, prestar apoio, prevenir fraude e cumprir obrigações legais e fiscais. Partilhamos apenas o necessário: a loja vê o seu nome e a encomenda; o estafeta vê o seu primeiro nome, telemóvel e morada de entrega. Não vendemos os seus dados. Comunicações de marketing só com o seu consentimento.", en: "To process and deliver orders, take payments, manage Plus and points, provide support, prevent fraud and meet legal and tax obligations. We share only what is needed: the store sees your name and order; the rider sees your first name, phone and delivery address. We do not sell your data. Marketing messages only with your consent.", fr: "Pour traiter et livrer les commandes, encaisser les paiements, gérer Plus et les points, assurer le support, prévenir la fraude et respecter nos obligations légales et fiscales. Nous ne partageons que le nécessaire : le commerce voit votre nom et votre commande ; le livreur voit votre prénom, téléphone et adresse. Nous ne vendons pas vos données. Communications marketing uniquement avec votre consentement." }],
    },
    {
      h: { pt: "4. Conservação", en: "4. Retention", fr: "4. Conservation" },
      p: [{ pt: "Mantemos os dados da conta enquanto esta estiver activa. Registos de encomendas e faturação são guardados pelo prazo exigido pela lei fiscal angolana. Dados de localização dos estafetas são apagados ou anonimizados após um curto período a seguir à entrega. Quando apaga a conta, removemos ou anonimizamos os dados que não tenhamos obrigação legal de manter.", en: "We keep account data while the account is active. Order and billing records are kept for the period required by Angolan tax law. Rider location data is deleted or anonymised shortly after delivery. When you delete your account, we remove or anonymise data we are not legally required to keep.", fr: "Les données du compte sont conservées tant qu'il est actif. Les historiques de commandes et de facturation sont conservés pendant la durée exigée par la loi fiscale angolaise. Les données de localisation des livreurs sont supprimées ou anonymisées peu après la livraison. À la suppression du compte, nous supprimons ou anonymisons les données que nous ne sommes pas tenus de conserver." }],
    },
    {
      h: { pt: "5. Os seus direitos", en: "5. Your rights", fr: "5. Vos droits" },
      p: [{ pt: `Pode pedir acesso, rectificação, eliminação ou oposição ao tratamento dos seus dados, e retirar consentimentos a qualquer momento, através de ${SUPPORT_EMAIL}. Pode também apresentar reclamação à Agência de Protecção de Dados (APD).`, en: `You can request access, correction, deletion or object to the processing of your data, and withdraw consent at any time, via ${SUPPORT_EMAIL}. You may also complain to Angola's Data Protection Agency (APD).`, fr: `Vous pouvez demander l'accès, la rectification, la suppression ou vous opposer au traitement de vos données, et retirer votre consentement à tout moment, via ${SUPPORT_EMAIL}. Vous pouvez aussi saisir l'Agence angolaise de protection des données (APD).` }],
    },
    {
      h: { pt: "6. Segurança e cookies", en: "6. Security and cookies", fr: "6. Sécurité et cookies" },
      p: [{ pt: "Usamos ligações cifradas (HTTPS), palavras-passe cifradas e acesso restrito aos dados. Usamos apenas um cookie de sessão essencial para manter a sessão iniciada e guardamos no dispositivo preferências como o idioma e o carrinho.", en: "We use encrypted connections (HTTPS), hashed passwords and restricted data access. We use only an essential session cookie to keep you logged in, and store preferences such as language and cart on your device.", fr: "Nous utilisons des connexions chiffrées (HTTPS), des mots de passe hachés et un accès restreint aux données. Nous n'utilisons qu'un cookie de session essentiel et enregistrons sur votre appareil des préférences comme la langue et le panier." }],
    },
  ];
  return <><DraftNote /><Updated /><Prose blocks={blocks} /></>;
}

const FAQ: { q: Tr; a: Tr }[] = [
  {
    q: { pt: "Como acompanho a minha encomenda?", en: "How do I track my order?", fr: "Comment suivre ma commande ?" },
    a: { pt: "Abra «Encomendas» e toque na encomenda. Vê o estado em tempo real e, quando o estafeta sair, a posição dele no mapa.", en: "Open “Orders” and tap your order. You'll see live status and, once the rider leaves, their position on the map.", fr: "Ouvrez « Commandes » et touchez votre commande. Vous verrez le statut en temps réel et, dès le départ du livreur, sa position sur la carte." },
  },
  {
    q: { pt: "Posso cancelar uma encomenda?", en: "Can I cancel an order?", fr: "Puis-je annuler une commande ?" },
    a: { pt: "Sim, gratuitamente, até a loja começar a preparar. Na página da encomenda toque em «Cancelar». Depois disso, contacte o suporte.", en: "Yes, free of charge until the store starts preparing. On the order page tap “Cancel”. After that, contact support.", fr: "Oui, gratuitement, tant que le commerce n'a pas commencé la préparation. Sur la page de la commande, touchez « Annuler ». Ensuite, contactez le support." },
  },
  {
    q: { pt: "Falta um produto ou veio errado. O que faço?", en: "An item is missing or wrong. What do I do?", fr: "Un article manque ou est erroné. Que faire ?" },
    a: { pt: "Contacte-nos em até 24 horas com o número da encomenda (e uma fotografia, se possível). Analisamos com a loja e reembolsamos o valor quando se justifique.", en: "Contact us within 24 hours with your order number (and a photo if possible). We'll check with the store and refund where appropriate.", fr: "Contactez-nous sous 24 heures avec le numéro de commande (et une photo si possible). Nous vérifions avec le commerce et remboursons si nécessaire." },
  },
  {
    q: { pt: "Que métodos de pagamento aceitam?", en: "Which payment methods do you accept?", fr: "Quels moyens de paiement acceptez-vous ?" },
    a: { pt: "Numerário na entrega, Multicaixa Express, Unitel Money, cartão e transferência bancária. Os métodos disponíveis aparecem no checkout.", en: "Cash on delivery, Multicaixa Express, Unitel Money, card and bank transfer. Available methods are shown at checkout.", fr: "Espèces à la livraison, Multicaixa Express, Unitel Money, carte et virement. Les moyens disponibles s'affichent au paiement." },
  },
  {
    q: { pt: "Posso agendar uma entrega?", en: "Can I schedule a delivery?", fr: "Puis-je programmer une livraison ?" },
    a: { pt: "Sim. No checkout escolha «Agendar» e a hora pretendida — também funciona com lojas que estão fechadas agora.", en: "Yes. At checkout choose “Schedule” and a time — it also works for stores that are closed right now.", fr: "Oui. Au paiement, choisissez « Programmer » et l'heure — cela fonctionne aussi pour les commerces actuellement fermés." },
  },
  {
    q: { pt: "Como funciona a encomenda em grupo?", en: "How do group orders work?", fr: "Comment fonctionnent les commandes groupées ?" },
    a: { pt: "Na página da loja toque em «Encomenda em grupo» e partilhe o link. Cada pessoa adiciona os seus produtos e o anfitrião finaliza e paga.", en: "On the store page tap “Group order” and share the link. Everyone adds their items and the host checks out and pays.", fr: "Sur la page du commerce, touchez « Commande groupée » et partagez le lien. Chacun ajoute ses articles et l'hôte valide et paie." },
  },
  {
    q: { pt: "O que é o Bazzar Plus?", en: "What is Bazzar Plus?", fr: "Qu'est-ce que Bazzar Plus ?" },
    a: { pt: "Uma subscrição mensal com entregas grátis em encomendas acima de um valor mínimo. Pode cancelar quando quiser e mantém as vantagens até ao fim do mês pago.", en: "A monthly subscription with free delivery on orders above a minimum. Cancel anytime and keep benefits until the end of the paid month.", fr: "Un abonnement mensuel avec livraison gratuite au-delà d'un montant minimum. Résiliable à tout moment, avantages conservés jusqu'à la fin du mois payé." },
  },
  {
    q: { pt: "Como ganho e uso pontos?", en: "How do I earn and use points?", fr: "Comment gagner et utiliser des points ?" },
    a: { pt: "Ganha pontos em cada encomenda entregue e ao convidar amigos com o seu código. No checkout pode usar os pontos como desconto.", en: "You earn points on every delivered order and by inviting friends with your code. At checkout you can use points as a discount.", fr: "Vous gagnez des points à chaque commande livrée et en parrainant des amis avec votre code. Au paiement, utilisez-les comme réduction." },
  },
  {
    q: { pt: "Quero vender ou entregar com a BazzarDelivery.", en: "I want to sell or deliver with BazzarDelivery.", fr: "Je veux vendre ou livrer avec BazzarDelivery." },
    a: { pt: "Crie uma conta do tipo «Loja/Restaurante» ou «Estafeta». A nossa equipa verifica os dados e activa a conta, normalmente em 1–3 dias úteis.", en: "Create a “Store/Restaurant” or “Rider” account. Our team reviews your details and activates the account, usually within 1–3 working days.", fr: "Créez un compte « Magasin/Restaurant » ou « Livreur ». Notre équipe vérifie vos informations et active le compte, généralement sous 1 à 3 jours ouvrés." },
  },
];

function Support() {
  const t = useT();
  const contacts: { href: string; icon: typeof Phone; label: string; value: string; cls: string }[] = [
    { href: `https://wa.me/${SUPPORT_WHATSAPP}`, icon: MessageCircle, label: "WhatsApp", value: SUPPORT_PHONE, cls: "bg-green-50 text-green-800" },
    { href: `tel:${SUPPORT_PHONE.replace(/\s/g, "")}`, icon: Phone, label: t({ pt: "Telefone", en: "Phone", fr: "Téléphone" }), value: SUPPORT_PHONE, cls: "bg-orange-50 text-orange-800" },
    { href: `mailto:${SUPPORT_EMAIL}`, icon: Mail, label: "Email", value: SUPPORT_EMAIL, cls: "bg-sky-50 text-sky-800" },
  ];
  return (
    <>
      <h2 className="text-lg font-bold">{t({ pt: "Fale connosco", en: "Talk to us", fr: "Contactez-nous" })}</h2>
      <p className="mb-3 text-sm text-neutral-500">{t({ pt: "Todos os dias, das 8h às 23h (hora de Luanda).", en: "Every day, 8am to 11pm (Luanda time).", fr: "Tous les jours, de 8 h à 23 h (heure de Luanda)." })}</p>
      <div className="space-y-2">
        {contacts.map(({ href, icon: Icon, label, value, cls }) => (
          <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
            className="flex items-center gap-3 rounded-2xl border p-3 hover:bg-neutral-50">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-full", cls)}><Icon className="h-5 w-5" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block truncate text-sm text-neutral-600">{value}</span>
            </span>
          </a>
        ))}
      </div>

      <h2 className="mb-1 mt-8 text-lg font-bold">{t({ pt: "Perguntas frequentes", en: "Frequently asked questions", fr: "Questions fréquentes" })}</h2>
      <Accordion type="single" collapsible className="w-full">
        {FAQ.map((f, i) => (
          <AccordionItem key={i} value={`q${i}`}>
            <AccordionTrigger className="text-left text-sm font-semibold">{t(f.q)}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-neutral-700">{t(f.a)}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
}

const CONTENT: Record<string, () => ReactNode> = { sobre: About, termos: Terms, privacidade: Privacy, suporte: Support };

export default function Info() {
  const { page } = useParams<{ page: string }>();
  const t = useT();
  const Content = CONTENT[page];
  if (!Content) return <NotFound />;

  return (
    <CustomerShell hideHeader>
      <TopBar title={t(PAGES[page])} back />
      <article className="px-4 py-5">
        <Content />
        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 text-sm" aria-label={t({ pt: "Mais informação", en: "More info", fr: "Plus d'infos" })}>
          {Object.entries(PAGES).filter(([k]) => k !== page).map(([k, v]) => (
            <Link key={k} href={`/info/${k}`} className="text-primary hover:underline">{t(v)}</Link>
          ))}
        </nav>
      </article>
    </CustomerShell>
  );
}
