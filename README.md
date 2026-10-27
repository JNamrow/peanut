# Peanut 🥜

Household finance for people whose money lives in two countries.

Peanut is a Monarch-style personal finance app that holds dollars and shekels
side by side. Every amount is stored in its own currency and converted at the
day's rate only for display, so a US paycheck and an Israeli grocery run sit in
the same budget without either one being "the foreign one".

It is a personal project its author uses every day. It is free and open source
(MIT) and built to be self-hosted on a free Supabase project plus Vercel.

## What it does

- Accounts, transactions, categories and budgets in the Monarch mould, with
  Israel-specific categories (Arnona, Va'ad Bayit, Tzedakah) added
- US banks, cards and brokerage accounts via Plaid; Israeli accounts via
  RiseUp's official API or Financy's open-banking API, whichever you have
- Israeli pension and hishtalmut tracks rolled forward from the published
  monthly yields on data.gov.il
- Daily USD/ILS rates from the ECB, backfilled to 2019
- Transfers are a category kind, so moving money between your own accounts
  never counts as spending
- Nightly sync on Vercel Cron: FX → RiseUp → Plaid → pensions → balance snapshots

## Stack

- Next.js 16 (App Router) + Tailwind v4
- Supabase (Postgres, Auth, Vault)
- Recharts

## Data sources

| Source | What | How |
|---|---|---|
| Plaid | US banks, cards, brokerage (txns, balances, holdings) | `/transactions/sync` + `/investments/holdings/get`, access tokens in Supabase Vault |
| RiseUp | Israeli accounts: transactions with RiseUp's Hebrew categories | Official PAT API (`input.riseup.co.il/api/external`), token expires every 30 days — UI warns at day 25. No balances endpoint yet (balances stay manual until RiseUp ships it) |
| data.gov.il | Pension/hishtalmut track yields (Gemelnet/Pensianet) | "Anchor + drift": statement balance rolled forward by published monthly yield minus fee, plus deposits |
| Financy (open-finance.ai) | Israeli banks, cards, loans and savings: accounts, balances and transactions with Financy's categories | Official REST API (`api.open-finance.ai`) with your own client id / secret / user id, stored in Supabase Vault. Banks are linked inside the Financy app; the API needs a paid Financy plan |
| frankfurter.dev | Daily USD/ILS (ECB) | `fx_rates` table, backfilled to 2019 |

RiseUp and Financy both cover Israeli accounts, so use either or both. RiseUp
needs a personal token renewed every 30 days and has no balances; Financy
needs a paid plan and returns balances and a year of daily history straight
from the bank. Peanut keeps only the API credentials; the bank consent lives
with the provider.

## Self-host

1. Create a Supabase project and apply the schema in `supabase/migrations`
   (`supabase link` then `supabase db push`, or paste the SQL into the SQL editor).
2. Copy `.env.example` to `.env.local` and fill it in. Plaid needs a client id
   and secret for the environment you pick; `CRON_SECRET` is any long random string.
3. `pnpm install` then `pnpm dev`.
4. Seed once per fresh database: set `SEED_USERS` (and optionally
   `SEED_SPACE_NAME`, `SEED_PRIMARY_CURRENCY`) in `.env.local`, then run
   `node scripts/seed.mjs`. It creates the users, the shared space, Monarch-style
   categories plus the Israeli ones, Plaid category aliases and FX history, and
   prints a first password for each new user.
5. Deploy to Vercel with the same env vars. `vercel.json` schedules the daily
   sync at 03:00 UTC; Vercel calls it with `Authorization: Bearer $CRON_SECRET`.

## Conventions

- Transaction amounts are **signed, native currency**: negative = money out.
- Plaid's sign is flipped on ingest (their positive = outflow).
- RiseUp amounts are always positive: `isIncome` decides the sign.
- Transfers are a **category kind** (like Monarch) — anything `kind='transfer'` is excluded from cash flow, budget, and reports. No pair matching.
- Budgets are stored in the space's primary currency.
- Every provider row keys on `(connection_id, external_id)` with upserts — re-syncs are idempotent.
- Secrets (Plaid access tokens, RiseUp PATs) live in Supabase Vault via `peanut_vault_*` RPCs (service-role only).

## Sync

- Manual: Settings → Sync, or automatically after connecting.
- Scheduled: Vercel Cron hits `GET /api/cron/daily` at 03:00 UTC with
  `Authorization: Bearer $CRON_SECRET` (fx → every bank connection: RiseUp,
  Plaid, Financy → pensions → snapshots).

## Status

Peanut is built for one household at a time: one Supabase project per
household, every listed user an owner. It has not been reviewed for hosting
strangers' data on a shared instance, and there is no hosted version.

## License

MIT. See `LICENSE`.
