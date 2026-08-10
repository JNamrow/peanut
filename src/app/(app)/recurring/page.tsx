import { getAccounts, getCategories, getContext } from "@/lib/data";
import { addMonths, monthStart } from "@/lib/format";
import { buildRecurringMonth, type Cadence } from "@/lib/recurring";
import type { RecurringStream, Transaction } from "@/lib/types";
import { RecurringUI, type CardCycle, type StreamLite } from "./recurring-ui";

type StreamRow = RecurringStream & {
  start_date?: string | null;
  typical_amount: number | null;
};

function toLite(s: StreamRow): StreamLite {
  return {
    id: s.id,
    merchantName: s.merchant_name,
    cadence: s.cadence as Cadence,
    typicalAmount: Number(s.typical_amount ?? 0),
    currency: s.currency,
    nextExpectedDate: s.next_expected_date,
    kind: s.kind,
    status: s.status as StreamLite["status"],
    accountId: s.account_id,
    startDate: s.start_date ?? null,
    categoryId: s.category_id ?? null,
    logoDomain: s.logo_domain ?? null,
    logoUrl: s.logo_url ?? null,
  };
}

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : monthStart().slice(0, 7);
  const tab = params.tab === "all" ? ("all" as const) : ("monthly" as const);

  const { supabase, space } = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);

  const first = `${month}-01`;
  const next = addMonths(first, 1);
  const [{ data: streamRows }, { data: txnRows }] = await Promise.all([
    supabase
      .from("recurring_streams")
      .select("*")
      .eq("space_id", space.id)
      .order("merchant_name"),
    supabase
      .from("transactions")
      .select("*")
      .eq("space_id", space.id)
      .gte("date", first)
      .lt("date", next),
  ]);

  const all = (streamRows ?? []) as StreamRow[];
  const suggestions = all.filter((s) => s.status === "suggested");
  const streams = all.filter((s) => s.status === "active" || s.status === "ended");

  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const data = buildRecurringMonth(
    streams,
    (txnRows ?? []) as Transaction[],
    month,
    todayYmd,
  );

  const cards: CardCycle[] = accounts
    .filter((a) => a.type === "credit" && !a.hidden && a.current_balance != null)
    .map((a) => ({
      id: a.id,
      name: a.name,
      cycle: Math.abs(Math.min(Number(a.current_balance), 0)),
      currency: a.currency,
    }));

  return (
    <RecurringUI
      month={month}
      tab={tab}
      data={data}
      streams={streams.map(toLite)}
      suggestions={suggestions.map(toLite)}
      cards={cards}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      categories={categories}
    />
  );
}
