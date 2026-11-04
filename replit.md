# PedeJá

Plataforma de entregas para Angola (estilo Talabat/Deliveroo): clientes, lojas (incluindo negócios caseiros), estafetas e administração.

## Correr no Replit
1. **Tools → Database → PostgreSQL**: cria a base de dados e o segredo `DATABASE_URL` automaticamente.
2. **Tools → Secrets**: adicionar `SESSION_SECRET` (texto aleatório longo).
3. Carregar em **Run**. Na primeira vez a app cria as tabelas e os dados de demonstração.

## Publicar (lançamento real)
Publish → **Reserved VM** (não Autoscale: a app tem um relógio interno que liberta as encomendas agendadas e precisa de estar sempre ligada).

Segredos de produção (Publish → Secrets):
| Segredo | Valor |
|---|---|
| `DATABASE_URL` | criado pelo Replit (Database) |
| `SESSION_SECRET` | texto aleatório com 40+ caracteres |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | a sua conta de administrador (palavra-passe com 12+ caracteres) |
| `SEED_LAUNCH` | `true` → cria o Mariato (com o menu completo, fechado até à inauguração) e os anúncios |
| `MARIATO_PASSWORD` | palavra-passe da gerência do Mariato (12+ caracteres); utilizador `mariato` |
| `PAYMENTS_MODE` | `disabled` (só numerário) até haver gateway real |
| `SEED_DEMO` | não definir (ou `false`) para não aparecerem lojas de teste |

Opcionais: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (SMS).

Domínio próprio: Tools → Domains → introduzir o domínio e copiar os registos **A** e **TXT** para o fornecedor do domínio (manter o TXT para sempre).

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
