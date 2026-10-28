-- Financy (Open Finance AI) as a third data provider: Israeli open-banking
-- accounts and transactions read through Financy's API with the user's own
-- API credentials. Widens the provider/source check constraints; no new tables.
do $$
declare r record;
begin
  -- Drop the old inline checks, whatever they were named.
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in (
        'public.connections'::regclass,
        'public.accounts'::regclass,
        'public.transactions'::regclass,
        'public.category_aliases'::regclass
      )
      and pg_get_constraintdef(c.oid) ilike '%riseup%'
      and pg_get_constraintdef(c.oid) not ilike '%financy%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'connections_provider_check') then
    alter table public.connections add constraint connections_provider_check
      check (provider in ('plaid','riseup','financy','manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_source_check') then
    alter table public.accounts add constraint accounts_source_check
      check (source in ('plaid','riseup','financy','manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_source_check') then
    alter table public.transactions add constraint transactions_source_check
      check (source in ('plaid','riseup','financy','manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'category_aliases_source_check') then
    alter table public.category_aliases add constraint category_aliases_source_check
      check (source in ('plaid','riseup','financy'));
  end if;
end $$;
