# PedeAí Delivery

Plataforma de entregas para Angola (estilo Talabat/Deliveroo): clientes, lojas (incluindo negócios caseiros), estafetas e administração.

## Correr no Replit
1. **Tools → Database → PostgreSQL**: cria a base de dados e o segredo `DATABASE_URL` automaticamente.
2. **Tools → Secrets**: adicionar `SESSION_SECRET` (texto aleatório longo).
3. Carregar em **Run**. Na primeira vez a app cria as tabelas e os dados de demonstração.

## Publicar (Deploy)
Deployments → Autoscale. Segredos de produção:
- `DATABASE_URL`, `SESSION_SECRET` (obrigatórios)
- `SEED_DEMO=true` para carregar as lojas e contas de demonstração (retirar no lançamento real)
- `PAYMENTS_MODE=sandbox` para testar pagamentos online simulados; `disabled` = só numerário
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` (≥ 12 caracteres) para criar o administrador real
- Opcionais: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (SMS)

## Contas de demonstração (só com SEED_DEMO)
| Papel | Utilizador | Palavra-passe |
|---|---|---|
| Cliente | cliente | Cliente#2026 |
| Loja (Grelhados do Mussulo) | loja | Loja#2026demo |
| Loja (Mariato Restaurante Grill) | mariato | Loja#2026demo |
| Negócio caseiro (Bolos da Tia Rosa) | tiarosa | Loja#2026demo |
| Estafeta | estafeta | Estafeta#2026 |
| Admin | admin | Admin#2026demo |

## Estrutura
- `server/` — Express + PostgreSQL (Drizzle). `routes/` por área (auth, catalog, customer, group, partner, driver, admin), `lib/` regras (preços, estados da encomenda, pagamentos).
- `shared/schema.ts` — tabelas e validações.
- `client/` — React (PWA). Páginas em `client/src/pages/{customer,partner,driver,admin,info}`.
- `migrations/` — gerado com `npm run db:generate`; aplicado no arranque.
- `tests/` — `npx tsx tests/api.test.ts` (API) e `node tests/ui.test.mjs` (navegador).
- `docs/` — guia do frontend.
