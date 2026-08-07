# Peanut 🥜

Household finance for two countries. Monarch-style app that holds dollars
and shekels side by side — every amount is stored in its own currency and
converted at the day's rate only for display.

## Stack

- Next.js 16 (App Router) + Tailwind v4
- Supabase (Postgres, Auth, Vault) — project `your-project-ref` (separate from fcfo-hub)
- Recharts

## Data sources

| Source | What | How |
|---|---|---|
| Plaid | US banks, cards, Robinhood (txns, balances, holdings) | `/transactions/sync` + `/investments/holdings/get`, access tokens in Supabase Vault |
| RiseUp | Israeli accounts: transactions with RiseUp's Hebrew categories | Official PAT API (`input.riseup.co.il/api/external`), token expires every 30 days — UI warns at day 25. No balances endpoint yet (balances stay manual until RiseUp ships it) |
| data.gov.il | Pension/hishtalmut track yields (Gemelnet/Pensianet) | "Anchor + drift": statement balance rolled forward by published monthly yield minus fee, plus deposit |
| frankfurter.dev | Daily USD/ILS (ECB) | `fx_rates` table, backfilled to 2019 |

## Conventions

- Transaction amounts are **signed, native currency**: negative = money out.
- Plaid's sign is flipped on ingest (their positive = outflow).
- RiseUp amounts are always positive: `isIncome` decides the sign.
- Transfers are a **category kind** (like Monarch) — anything `kind='transfer'` is excluded from cash flow, budget, and reports. No pair matching.
- Budgets are stored in the space's primary currency.
- Every provider row keys on `(connection_id, external_id)` with upserts — re-syncs are idempotent.
- Secrets (Plaid access tokens, RiseUp PATs) live in Supabase Vault via `peanut_vault_*` RPCs (service-role only).

## Run

```bash
pnpm install
cp .env.example .env.local   # fill in
pnpm dev
```

Seed (once per fresh database): `node scripts/seed.mjs` — creates users, the
shared space, Monarch-style categories (+ Israeli ones), Plaid category
aliases, and FX history.

## Sync

- Manual: Settings → Sync, or automatically after connecting.
- Scheduled: Vercel Cron hits `GET /api/cron/daily` at 03:00 UTC with
  `Authorization: Bearer $CRON_SECRET` (fx → riseup → plaid → pensions → snapshots).
