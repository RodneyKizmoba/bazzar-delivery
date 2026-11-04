# Guia do frontend (para quem constrói páginas)

Projecto: `/home/claude/bazzar`. React 18 + TypeScript + Tailwind + shadcn/ui (em `client/src/components/ui`), router **wouter**, dados com **@tanstack/react-query v5**. Backend Express já pronto — a fonte de verdade da API são os ficheiros `server/routes/*.ts` e `shared/schema.ts`. Leia-os antes de escrever cada página.

## Regras
- Escreva SÓ os ficheiros de página que lhe foram atribuídos. NÃO altere ficheiros partilhados (`client/src/lib/*`, `client/src/components/*` fora de páginas, `client/src/App.tsx`, `server/*`, `shared/*`). Se precisar de algo novo partilhado, crie um componente local dentro do seu ficheiro de página, ou reporte no fim.
- Cada página faz `export default function NomeDaPagina()`.
- Todo o texto visível em 3 idiomas com `const t = useT();` e `t({ pt: "…", en: "…", fr: "…" })`. Português de Angola/Portugal (ex.: "telemóvel", "morada", "palavra-passe", "encomenda").
- Preços SEMPRE com `kz(n)` de `@/lib/format`. Datas com `dateTime(d, lang)` / `time(d, lang)` (`const { lang } = useLang()`).
- Mobile first. Páginas de cliente usam `<CustomerShell>`; páginas de parceiro/estafeta/admin usam `<PanelShell title tabs>` (ver `components/AppShell.tsx`).
- Páginas protegidas: envolva o conteúdo em `<Guard roles={["customer"]}>…</Guard>` (de `components/common.tsx`). Guard redirecciona para `/entrar?next=…`.
- Estados: use `Loading`, `ErrorState`, `EmptyState`, `StatusBadge`, `DietaryBadges`, `StoreImage`, `PageTitle` de `@/components/common`.
- Erros de mutações: mostre `toast({ variant: "destructive", title: …, description: err.message })` (`useToast` de `@/hooks/use-toast`). As mensagens da API já vêm em português.
- Acessibilidade: botões com texto ou `aria-label`, inputs com `<Label htmlFor>`, contraste suficiente, alvos de toque ≥ 40px.
- Não use imagens externas. Sem imagem → `StoreImage` (iniciais coloridas) ou emoji.
- Não use `localStorage` directamente excepto onde indicado (grupo).

## Utilitários disponíveis
- `@/lib/api`: `get, post, put, patch, del, api, ApiError, queryClient`. Queries: `useQuery({ queryKey: ["/api/orders"] })` (a chave é o URL, o fetch é automático). Depois de mutações: `queryClient.invalidateQueries({ queryKey: ["/api/orders"] })`.
- `@/lib/i18n`: `useT`, `useLang`, `T` (textos comuns: T.back, T.save, T.cancel, T.total, T.subtotal, T.deliveryFee, T.discount, T.free…).
- `@/lib/format`: `kz, dateTime, time, ORDER_STATUS, STATUS_COLOR, STORE_TYPE (com .icon), DIETARY (com .icon), ALLERGEN, PAYMENT, initials, colorFor`.
- `@/hooks/useAuth`: `useAuth()` → `{ user, isLoading, login, logout, setUser, refresh }`, `homeFor(user)`.
- `@/context/CartContext`: `useCart()` → `{ storeId, storeName, lines, itemCount, estimatedSubtotal, canAddFrom, add, setQuantity, remove, clear, replaceLines }`, `toApiItems(lines)`.
- `@/components/ItemDialog`: `ItemDialog` (personalização de produto) + tipos `MenuItemFull`, `ItemSelection`.
- `@/components/OrderMap`: `OrderMap({ store, destination, driver, labels })` com `{latitude, longitude}`.
- `@/components/AppShell`: `CustomerShell`, `PanelShell`, `TopBar`, `LanguageSwitch`.

## Rotas (já registadas em App.tsx)
Cliente: `/`, `/pesquisa`, `/loja/:id`, `/carrinho`, `/checkout`, `/encomendas`, `/encomendas/:id`, `/grupo/:token`, `/plus`, `/perfil`, `/perfil/moradas`, `/perfil/pontos`, `/favoritos`, `/entrar`, `/registar`, `/info/:page` (sobre|termos|privacidade|suporte).
Parceiro: `/parceiro` (encomendas), `/parceiro/menu`, `/parceiro/loja`, `/parceiro/avaliacoes`, `/parceiro/estatisticas`.
Estafeta: `/estafeta`, `/estafeta/historico`.
Admin: `/admin`, `/admin/encomendas`, `/admin/lojas`, `/admin/utilizadores`, `/admin/promocoes`.

## Resumo da API (detalhes nos ficheiros de rotas)
- Auth: `POST /api/auth/register` `{username,password(min 8),fullName,email?,phone,userType:"customer"|"supplier"|"driver",referralCode?, business?:{name,storeType,phone,street,zone,nif?,description?}}` → `{user}`; `POST /api/auth/login`; `POST /api/auth/logout`; `GET /api/auth/me` (401 se sem sessão); `PATCH /api/auth/me` `{fullName?,email?,phone?,preferredLanguage?,dietaryPreferences?}`; `POST /api/auth/password`; `GET /api/auth/points` → `{balance, pointValueKz, kzPerPointEarned, referralCode, referralBonusPoints, welcomeBonusPoints, friendsReferred, history[]}`.
- Catálogo: `GET /api/meta` → `{storeTypes, dietaryTags, allergens, zones, cuisines, paymentMethods:[{id,available,sandbox,reason?}], paymentsMode, plus:{monthlyPrice, freeDeliveryMinOrder}, schedule:{minLeadMin,maxAheadHours}, points:{pointValueKz,kzPerPointEarned,maxDiscountPct}}`; `GET /api/stores?q=&type=&cuisine=&dietary=vegan,gluten_free&zone=&minRating=&maxDeliveryTime=&freeDelivery=1&openNow=1&chain=chain|independent&sort=recommended|rating|delivery_time|delivery_fee|name` → `{stores:[StoreCard & {matchingItems}]}`; `GET /api/stores/:id` → `{store, isFavorite, sections, items: MenuItemFull[]}`; `GET /api/stores/:id/reviews`; `GET /api/popular-items`.
- Cliente: `GET/POST /api/addresses`, `PUT/DELETE /api/addresses/:id` (`{label, street, zone, city, reference?, latitude?, longitude?, isDefault?}`); `GET /api/favorites`; `PUT/DELETE /api/favorites/:storeId`; `POST /api/cart/quote` `{storeId, items:[{menuItemId,quantity,optionIds,specialInstructions?}], promoCode?, usePoints?}` → `{quote}`; `POST /api/orders` `{storeId, items, addressId, paymentMethod, notes?, scheduledFor?(ISO), promoCode?, usePoints?}` → `{order}`; `GET /api/orders`; `GET /api/orders/:id` → `{order(+canCancel,canModify,canReview), items, events, review, driver, customer, store}`; `GET /api/orders/:id/tracking` (polling); `POST /api/orders/:id/cancel {reason?}`; `PATCH /api/orders/:id {items?, addressId?, notes?, scheduledFor?}`; `POST /api/orders/:id/review {rating, driverRating?, comment?}`; `GET /api/plus`; `POST /api/plus/subscribe {paymentMethod}`; `POST /api/plus/cancel`.
- Grupo: `POST /api/groups {storeId}` (sessão) → `{token, participantId, secret}`; `GET /api/groups/:token`; `POST /api/groups/:token/join {name}` → `{participantId, secret}`; `POST /api/groups/:token/items` (headers `X-Group-Participant`, `X-Group-Secret`) body = linha do carrinho; `DELETE /api/groups/:token/items/:itemId` (mesmos headers); `POST /api/groups/:token/lock {locked}` (anfitrião); `POST /api/groups/:token/cancel`; `POST /api/groups/:token/checkout {addressId, paymentMethod, notes?, scheduledFor?, promoCode?, usePoints?}` → `{order}`. Guardar `{participantId, secret}` em `localStorage` com a chave `pedeja.group.<token>`.
- Parceiro (`/api/partner/*`, conta supplier): `GET/PATCH store`, `GET orders?scope=active|history`, `POST orders/:id/status {status: accepted|rejected|preparing|ready, note?}`, `GET menu`, `POST/PUT/DELETE sections`, `POST items`, `PUT items/:id`, `PATCH items/:id/availability {isAvailable}`, `DELETE items/:id`, `GET reviews`, `POST reviews/:id/reply {reply}`, `GET stats`.
- Estafeta (`/api/driver/*`): `GET available`, `GET current`, `POST orders/:id/claim`, `POST orders/:id/status {status: picked_up|delivered}`, `POST location {latitude, longitude}`, `GET history`.
- Admin (`/api/admin/*`): `GET stats`, `GET orders?status=&unassigned=1`, `POST orders/:id/status`, `POST orders/:id/assign-driver {driverId|null}`, `GET stores?pending=1`, `PATCH stores/:id`, `GET users?q=&type=&pending=1`, `PATCH users/:id {isApproved?, isActive?}`, `GET drivers`, `POST users/:id/plus {months}`, `GET/POST promos`, `PATCH promos/:id {isActive}`.

## Estados da encomenda
`scheduled → pending → accepted → preparing → ready → picked_up → delivered`; finais `cancelled`, `rejected`. Cliente pode cancelar em scheduled/pending/accepted; alterar em scheduled/pending.

## Verificação
Antes de terminar: `cd /home/claude/bazzar && npx tsc --noEmit 2>&1 | grep <seus ficheiros>` deve estar vazio. Não corra servidores nem builds.
