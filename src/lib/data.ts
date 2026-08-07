import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { RateTable } from "./currency";
import type { Account, Category, Space, SpaceMember } from "./types";

export interface AppContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  userEmail: string;
  space: Space;
  members: SpaceMember[];
  displayCurrency: string;
  rates: RateTable;
}

/** One shared context per request: session, space, fx rates, display currency. */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error } = await supabase
    .from("space_members")
    .select("space_id, role, display_name, spaces(id, name, primary_currency)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (error || !membership?.spaces) {
    throw new Error(`No space for user: ${error?.message ?? "missing membership"}`);
  }
  const space = membership.spaces as unknown as Space;

  const [{ data: members }, { data: fx }] = await Promise.all([
    supabase.from("space_members").select("*").eq("space_id", space.id),
    supabase.from("fx_rates").select("*").order("rate_date"),
  ]);

  const cookieStore = await cookies();
  const cookieCcy = cookieStore.get("display_ccy")?.value;
  const displayCurrency =
    cookieCcy === "USD" || cookieCcy === "ILS"
      ? cookieCcy
      : space.primary_currency;

  return {
    supabase,
    userId: user.id,
    userEmail: user.email ?? "",
    space,
    members: (members ?? []) as SpaceMember[],
    displayCurrency,
    rates: new RateTable(fx ?? []),
  };
});

export const getAccounts = cache(async (): Promise<Account[]> => {
  const { supabase, space } = await getContext();
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("space_id", space.id)
    .is("deleted_at", null)
    .order("display_order")
    .order("created_at");
  return (data ?? []) as Account[];
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const { supabase, space } = await getContext();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("space_id", space.id)
    .order("display_order");
  return (data ?? []) as Category[];
});

/** Net-worth style total of current account balances in display currency. */
export function sumBalances(
  accounts: Account[],
  rates: RateTable,
  displayCurrency: string,
): { assets: number; liabilities: number; net: number } {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (!a.include_in_net_worth || a.hidden || a.current_balance == null) continue;
    const v = rates.convert(Number(a.current_balance), a.currency, displayCurrency);
    if (a.is_liability) liabilities += Math.abs(v);
    else assets += v;
  }
  return { assets, liabilities, net: assets - liabilities };
}
