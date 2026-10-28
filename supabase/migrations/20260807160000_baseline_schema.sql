-- Peanut: full schema baseline.
--
-- Regenerated from the live database on 2026-10-29. It replaces the original
-- 2026-08-07 core schema and includes everything added since: goals,
-- forecasting, pension tracking, merchant rules, transaction events, balance
-- anchors and Financy as a provider. Apply it once on a fresh Supabase project
-- (SQL editor or `supabase db push`); the later migration files are safe to run
-- after it (they only add what is missing).

create extension if not exists pgcrypto with schema extensions;
do $$ begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'Vault is already set up or cannot be created here: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- helpers

create or replace function public.is_space_member(p_space uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Provider tokens live in Supabase Vault. Only the server (service role) may
-- read or write them.
create or replace function public.peanut_vault_get_secret(p_name text)
returns text
language sql security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

create or replace function public.peanut_vault_set_secret(p_name text, p_secret text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

revoke all on function public.peanut_vault_get_secret(text) from public, anon, authenticated;
revoke all on function public.peanut_vault_set_secret(text, text) from public, anon, authenticated;
grant execute on function public.peanut_vault_get_secret(text) to service_role;
grant execute on function public.peanut_vault_set_secret(text, text) to service_role;

-- ---------------------------------------------------------------- tables

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_currency text not null default 'ILS' check (primary_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  display_name text,
  created_at timestamptz not null default now(),
  birthday date,
  retirement_year integer,
  life_expectancy integer not null default 90,
  primary key (space_id, user_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  provider text not null check (provider in ('plaid', 'riseup', 'financy', 'manual')),
  label text,
  institution_name text,
  environment text,
  external_item_id text,
  status text not null default 'active' check (status in ('pending', 'active', 'error', 'disconnected')),
  error text,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  constraint connections_provider_item_unique unique (provider, external_item_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  source text not null default 'manual' check (source in ('plaid', 'riseup', 'financy', 'manual')),
  external_id text,
  name text not null,
  official_name text,
  institution_name text,
  type text not null check (type in ('checking', 'savings', 'cash', 'credit', 'investment', 'pension', 'loan', 'property', 'vehicle', 'other_asset', 'other_liability')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  mask text,
  current_balance numeric(16,2),
  available_balance numeric(16,2),
  is_liability boolean not null default false,
  include_in_net_worth boolean not null default true,
  hidden boolean not null default false,
  owner_user_id uuid references auth.users(id),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz,
  subtype text,
  linked_account_id uuid references public.accounts(id) on delete set null,
  balance_anchor numeric(16,2),
  balance_anchor_date date,
  forecast_include boolean not null default true,
  forecast_growth_pct numeric,
  forecast_contribution numeric not null default 0,
  forecast_growth_mode text check (forecast_growth_mode in ('fixed', 'none', 'variable')),
  forecast_growth_points jsonb,
  constraint accounts_conn_ext_unique unique (connection_id, external_id)
);
create index accounts_space on public.accounts (space_id) where deleted_at is null;

create table public.account_balance_snapshots (
  account_id uuid not null references public.accounts(id) on delete cascade,
  as_of_date date not null,
  balance numeric(16,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source text not null default 'sync' check (source in ('sync', 'manual', 'interpolated')),
  primary key (account_id, as_of_date)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  "group" text not null,
  name text not null,
  icon text,
  kind text not null default 'expense' check (kind in ('income', 'expense', 'transfer')),
  exclude_from_budget boolean not null default false,
  display_order integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  budget_bucket text check (budget_bucket in ('fixed', 'flexible', 'non_monthly')),
  name_he text,
  color text,
  constraint categories_space_id_name_key unique (space_id, name)
);

create table public.category_aliases (
  space_id uuid not null references public.spaces(id) on delete cascade,
  source text not null check (source in ('plaid', 'riseup', 'financy')),
  source_name text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (space_id, source, source_name)
);

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  match_type text not null default 'merchant' check (match_type = 'merchant'),
  match_value text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  match_amount numeric,
  constraint category_rules_match_key unique nulls not distinct (space_id, match_type, match_value, match_amount)
);

create table public.recurring_streams (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  merchant_name text not null,
  match_pattern text,
  account_id uuid references public.accounts(id) on delete set null,
  cadence text not null default 'monthly' check (cadence in ('weekly', 'biweekly', 'every_4_weeks', 'twice_monthly_1_15', 'twice_monthly_15_eom', 'monthly', 'every_2_months', 'quarterly', 'semiyearly', 'yearly')),
  typical_amount numeric(16,2),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  next_expected_date date,
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  status text not null default 'suggested' check (status in ('suggested', 'active', 'dismissed', 'ended')),
  created_at timestamptz not null default now(),
  start_date date,
  category_id uuid references public.categories(id) on delete set null,
  logo_domain text,
  logo_url text
);
create index recurring_space on public.recurring_streams (space_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  source text not null default 'manual' check (source in ('plaid', 'riseup', 'financy', 'manual')),
  external_id text,
  date date not null,
  name text not null,
  original_name text,
  amount numeric(16,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category_id uuid references public.categories(id) on delete set null,
  categorized_by text not null default 'none' check (categorized_by in ('none', 'provider', 'rule', 'user')),
  notes text,
  tags text[] not null default '{}',
  pending boolean not null default false,
  is_transfer boolean not null default false,
  hide_from_reports boolean not null default false,
  recurring_stream_id uuid references public.recurring_streams(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attachments text[] not null default '{}',
  payment_method text,
  reviewed boolean not null default false,
  transfer_pair_id uuid,
  split_parent_id uuid references public.transactions(id) on delete cascade,
  constraint transactions_conn_ext_unique unique (connection_id, external_id)
);
create index txns_space_date on public.transactions (space_id, date desc);
create index txns_account_date on public.transactions (account_id, date desc);
create index txns_category on public.transactions (category_id);
create index transactions_transfer_pair_idx on public.transactions (transfer_pair_id) where transfer_pair_id is not null;
create index transactions_split_parent_idx on public.transactions (split_parent_id) where split_parent_id is not null;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  kind text not null,
  summary text not null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index transaction_events_txn_idx on public.transaction_events (transaction_id, created_at);

create table public.budgets (
  space_id uuid not null references public.spaces(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(16,2) not null default 0,
  rollover boolean not null default false,
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  primary key (space_id, month, category_id, currency)
);

create table public.fx_rates (
  rate_date date not null,
  base text not null check (base ~ '^[A-Z]{3}$'),
  quote text not null check (quote ~ '^[A-Z]{3}$'),
  rate numeric(16,6) not null,
  primary key (rate_date, base, quote)
);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  external_id text,
  symbol text,
  name text,
  quantity numeric(20,8),
  price numeric(16,4),
  value numeric(16,2),
  cost_basis numeric(16,2),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  as_of timestamptz not null default now(),
  constraint holdings_account_ext_unique unique (account_id, external_id)
);

create table public.pension_configs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  provider text,
  dataset text not null default 'gemelnet' check (dataset in ('gemelnet', 'pensianet')),
  fund_id integer not null,
  annual_fee_pct numeric(6,4) not null default 0,
  deposit_fee_pct numeric(6,4) not null default 0,
  monthly_contribution numeric(16,2) not null default 0,
  anchor_date date,
  anchor_balance numeric(16,2),
  last_applied_period text,
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  icon text,
  kind text not null default 'save_up' check (kind in ('save_up', 'pay_down')),
  target_amount numeric(16,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_date date,
  starting_amount numeric(16,2) not null default 0,
  planned_monthly numeric(16,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.goal_accounts (
  goal_id uuid not null references public.goals(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  primary key (goal_id, account_id)
);

create table public.forecast_settings (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  inflation_pct numeric(5,2) not null default 3,
  return_pct numeric(5,2) not null default 7,
  use_actual_expenses boolean not null default true,
  expenses_override jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  future_values text not null default 'today' check (future_values in ('today', 'nominal')),
  split_enabled boolean not null default false,
  withdrawal_order uuid[]
);

create table public.forecast_incomes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  member_user_id uuid,
  name text not null,
  icon text,
  yearly_amount numeric(14,2) not null,
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  stops_at_retirement boolean not null default true,
  created_at timestamptz not null default now(),
  excluded boolean not null default false
);

create table public.forecast_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  icon text,
  kind text not null default 'one_time' check (kind in ('one_time', 'yearly')),
  affects text not null default 'expense' check (affects in ('expense', 'income')),
  year integer not null,
  end_year integer,
  amount numeric(14,2) not null,
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.forecast_splits (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  mode text not null default 'amount' check (mode in ('percent', 'amount')),
  value numeric not null default 0,
  position integer not null default 0
);

-- ---------------------------------------------------------------- row level security
-- Everything is scoped to the household ("space") a user belongs to.

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.connections enable row level security;
alter table public.accounts enable row level security;
alter table public.account_balance_snapshots enable row level security;
alter table public.categories enable row level security;
alter table public.category_aliases enable row level security;
alter table public.category_rules enable row level security;
alter table public.recurring_streams enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_events enable row level security;
alter table public.budgets enable row level security;
alter table public.fx_rates enable row level security;
alter table public.holdings enable row level security;
alter table public.pension_configs enable row level security;
alter table public.goals enable row level security;
alter table public.goal_accounts enable row level security;
alter table public.forecast_settings enable row level security;
alter table public.forecast_incomes enable row level security;
alter table public.forecast_events enable row level security;
alter table public.forecast_splits enable row level security;

create policy spaces_select on public.spaces
  for select to authenticated using (public.is_space_member(id));
create policy spaces_update on public.spaces
  for update to authenticated using (public.is_space_member(id));
create policy members_select on public.space_members
  for select to authenticated using (user_id = auth.uid() or public.is_space_member(space_id));
create policy connections_all on public.connections
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy accounts_all on public.accounts
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy snapshots_all on public.account_balance_snapshots
  for all to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_balance_snapshots.account_id and public.is_space_member(a.space_id)))
  with check (exists (select 1 from public.accounts a where a.id = account_balance_snapshots.account_id and public.is_space_member(a.space_id)));
create policy categories_all on public.categories
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy category_aliases_all on public.category_aliases
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy category_rules_all on public.category_rules
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy recurring_all on public.recurring_streams
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy transactions_all on public.transactions
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy transaction_events_member on public.transaction_events
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy budgets_all on public.budgets
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy fx_select on public.fx_rates
  for select to authenticated using (true);
create policy holdings_all on public.holdings
  for all to authenticated
  using (exists (select 1 from public.accounts a where a.id = holdings.account_id and public.is_space_member(a.space_id)))
  with check (exists (select 1 from public.accounts a where a.id = holdings.account_id and public.is_space_member(a.space_id)));
create policy pension_configs_all on public.pension_configs
  for all to authenticated
  using (exists (select 1 from public.accounts a where a.id = pension_configs.account_id and public.is_space_member(a.space_id)))
  with check (exists (select 1 from public.accounts a where a.id = pension_configs.account_id and public.is_space_member(a.space_id)));
create policy goals_all on public.goals
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy goal_accounts_all on public.goal_accounts
  for all to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_accounts.goal_id and public.is_space_member(g.space_id)))
  with check (exists (select 1 from public.goals g where g.id = goal_accounts.goal_id and public.is_space_member(g.space_id)));
create policy forecast_settings_all on public.forecast_settings
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy forecast_incomes_all on public.forecast_incomes
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy forecast_events_all on public.forecast_events
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
create policy forecast_splits_member on public.forecast_splits
  for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));

-- ---------------------------------------------------------------- storage
-- Receipts are private; the app serves them through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
