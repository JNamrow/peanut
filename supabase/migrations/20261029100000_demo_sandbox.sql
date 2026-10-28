-- Public demo sandbox: a household flagged as demo, rebuilt from fictional data
-- every two hours by the server. Only the server (service role) may change the
-- flags, so a demo visitor cannot switch them off through the API.

alter table public.spaces add column if not exists is_demo boolean not null default false;
alter table public.spaces add column if not exists demo_reset_at timestamptz;

create or replace function public.protect_demo_flags()
returns trigger
language plpgsql
as $$
begin
  if (new.is_demo is distinct from old.is_demo
      or new.demo_reset_at is distinct from old.demo_reset_at)
     and coalesce(auth.role(), 'postgres') not in ('service_role', 'postgres') then
    raise exception 'demo flags can only be changed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists spaces_protect_demo_flags on public.spaces;
create trigger spaces_protect_demo_flags before update on public.spaces
  for each row execute function public.protect_demo_flags();
