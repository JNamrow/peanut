-- PEANUT v1 core schema
-- Multi-currency (USD/ILS native) household finance. Every data table is
-- space-scoped; RLS gates on space membership. Provider rows follow the
-- connector pattern: (connection_id, external_id) partial unique + upsert.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- spaces
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_currency text not null default 'ILS' check (primary_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','member')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- SECURITY DEFINER so policies can check membership without recursive RLS.
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

-- ---------------------------------------------------------- connections
-- One row per linked provider item (Plaid item, RiseUp login, or manual).
-- Secrets (access tokens / api keys) live in Vault under 'conn_<id>'.
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  provider text not null check (provider in ('plaid','riseup','manual')),
  label text,
  institution_name text,
  environment text,
  external_item_id text,
  status text not null default 'active' check (status in ('pending','active','error','disconnected')),
  error text,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_synced_at timestamptz
);
create unique index connections_provider_item
  on public.connections(provider, external_item_id)
  where external_item_id is not null;

-- -------------------------------------------------------------- accounts
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  source text not null default 'manual' check (source in ('plaid','riseup','manual')),
  external_id text,
  name text not null,
  official_name text,
  institution_name text,
  type text not null check (type in
    ('checking','savings','cash','credit','investment','pension',
     'loan','property','vehicle','other_asset','other_liability')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  mask text,
  current_balance numeric(16,2),
  available_balance numeric(16,2),
  is_liability boolean not null default false,
  include_in_net_worth boolean not null default true,
  hidden boolean not null default false,
  owner_user_id uuid references auth.users(id),
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz
);
create unique index accounts_conn_ext
  on public.accounts(connection_id, external_id)
  where connection_id is not null and external_id is not null;
create index accounts_space on public.accounts(space_id) where deleted_at is null;

-- Daily balance history → net-worth chart + pension performance.
create table public.account_balance_snapshots (
  account_id uuid not null references public.accounts(id) on delete cascade,
  as_of_date date not null,
  balance numeric(16,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source text not null default 'sync' check (source in ('sync','manual','interpolated')),
  primary key (account_id, as_of_date)
);

-- ------------------------------------------------------------ categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  "group" text not null,
  name text not null,
  icon text,
  kind text not null default 'expense' check (kind in ('income','expense','transfer')),
  exclude_from_budget boolean not null default false,
  display_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (space_id, name)
);

-- Provider category string → our category (RiseUp Hebrew names, Plaid PFC).
create table public.category_aliases (
  space_id uuid not null references public.spaces(id) on delete cascade,
  source text not null check (source in ('plaid','riseup')),
  source_name text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (space_id, source, source_name)
);

-- ------------------------------------------------------------- recurring
create table public.recurring_streams (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  merchant_name text not null,
  match_pattern text,
  account_id uuid references public.accounts(id) on delete set null,
  cadence text not null default 'monthly' check (cadence in
    ('weekly','biweekly','monthly','quarterly','semiyearly','yearly')),
  typical_amount numeric(16,2),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  next_expected_date date,
  kind text not null default 'expense' check (kind in ('expense','income')),
  status text not null default 'suggested' check (status in ('suggested','active','dismissed','ended')),
  created_at timestamptz not null default now()
);
create index recurring_space on public.recurring_streams(space_id);

-- ---------------------------------------------------------- transactions
-- Signed amounts in the account's native currency: negative = outflow.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  source text not null default 'manual' check (source in ('plaid','riseup','manual')),
  external_id text,
  date date not null,
  name text not null,
  original_name text,
  amount numeric(16,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category_id uuid references public.categories(id) on delete set null,
  categorized_by text not null default 'none' check (categorized_by in ('none','provider','rule','user')),
  notes text,
  tags text[] not null default '{}',
  pending boolean not null default false,
  is_transfer boolean not null default false,
  hide_from_reports boolean not null default false,
  recurring_stream_id uuid references public.recurring_streams(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index txns_conn_ext
  on public.transactions(connection_id, external_id)
  where connection_id is not null and external_id is not null;
create index txns_space_date on public.transactions(space_id, date desc);
create index txns_account_date on public.transactions(account_id, date desc);
create index txns_category on public.transactions(category_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- budget
-- Budget amounts are stored in the space's primary currency.
create table public.budgets (
  space_id uuid not null references public.spaces(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(16,2) not null default 0,
  rollover boolean not null default false,
  primary key (space_id, month, category_id)
);

-- -------------------------------------------------------------- fx rates
-- Global reference data (not tenant data): daily closes, base->quote.
create table public.fx_rates (
  rate_date date not null,
  base text not null check (base ~ '^[A-Z]{3}$'),
  quote text not null check (quote ~ '^[A-Z]{3}$'),
  rate numeric(16,6) not null,
  primary key (rate_date, base, quote)
);

-- -------------------------------------------------------------- holdings
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
  as_of timestamptz not null default now()
);
create unique index holdings_account_ext
  on public.holdings(account_id, external_id)
  where external_id is not null;

-- ------------------------------------------------------------------ RLS
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.connections enable row level security;
alter table public.accounts enable row level security;
alter table public.account_balance_snapshots enable row level security;
alter table public.categories enable row level security;
alter table public.category_aliases enable row level security;
alter table public.recurring_streams enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.fx_rates enable row level security;
alter table public.holdings enable row level security;

create policy spaces_select on public.spaces
  for select to authenticated using (public.is_space_member(id));
create policy spaces_update on public.spaces
  for update to authenticated using (public.is_space_member(id));

create policy members_select on public.space_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_space_member(space_id));

create policy connections_all on public.connections
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy accounts_all on public.accounts
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy snapshots_all on public.account_balance_snapshots
  for all to authenticated
  using (exists (select 1 from public.accounts a
                 where a.id = account_id and public.is_space_member(a.space_id)))
  with check (exists (select 1 from public.accounts a
                      where a.id = account_id and public.is_space_member(a.space_id)));

create policy categories_all on public.categories
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy category_aliases_all on public.category_aliases
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy recurring_all on public.recurring_streams
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy transactions_all on public.transactions
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create policy budgets_all on public.budgets
  for all to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

-- fx_rates is global reference data: read-only for signed-in users,
-- written only by service role (sync job). Intentionally not tenant-scoped.
create policy fx_select on public.fx_rates
  for select to authenticated using (true);

create policy holdings_all on public.holdings
  for all to authenticated
  using (exists (select 1 from public.accounts a
                 where a.id = account_id and public.is_space_member(a.space_id)))
  with check (exists (select 1 from public.accounts a
                      where a.id = account_id and public.is_space_member(a.space_id)));

-- ------------------------------------------------------------------ Vault
-- Service-role-only wrappers; user sessions can never touch secrets.
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

create or replace function public.peanut_vault_get_secret(p_name text)
returns text
language sql security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

revoke all on function public.peanut_vault_set_secret(text, text) from public, anon, authenticated;
revoke all on function public.peanut_vault_get_secret(text) from public, anon, authenticated;
grant execute on function public.peanut_vault_set_secret(text, text) to service_role;
grant execute on function public.peanut_vault_get_secret(text) to service_role;
