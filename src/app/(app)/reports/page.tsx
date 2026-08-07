import { getAccounts, getCategories, getContext } from "@/lib/data";
import { activeCurrencies } from "@/lib/multicurrency";
import { fmtMoney, monthStart, addMonths } from "@/lib/format";
import { Donut, DONUT_COLORS } from "@/components/charts";
import { Card, CardHeader, PageHeader, Segmented } from "@/components/ui";
import type { Transaction } from "@/lib/types";

const RANGES: Record<string, { label: string; months: number }> = {
  "1m": { label: "This month", months: 1 },
  "3m": { label: "3 months", months: 3 },
  "6m": { label: "6 months", months: 6 },
  "12m": { label: "12 months", months: 12 },
  all: { label: "All time", months: 120 },
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; by?: string; ccy?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "income" ? "income" : "spending";
  const rangeKey = RANGES[params.range ?? ""] ? params.range! : "3m";
  const by =
    params.by === "merchant" ? "merchant" : params.by === "group" ? "group" : "category";

  const { supabase, space } = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);
  const currencies = activeCurrencies(accounts);
  const ccy = currencies.includes(params.ccy ?? "")
    ? params.ccy!
    : (currencies[0] ?? "ILS");

  const since = addMonths(monthStart(), -(RANGES[rangeKey].months - 1));
  const { data: txns } = await supabase
    .from("transactions")
    .select("*")
    .eq("space_id", space.id)
    .eq("currency", ccy)
    .gte("date", since);

  const list = (txns ?? []) as Transaction[];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));

  const buckets = new Map<string, { label: string; icon: string | null; value: number }>();
  let income = 0;
  let expense = 0;
  for (const t of list) {
    if (t.hide_from_reports || t.is_transfer) continue;
    const kind = t.category_id
      ? (kindOf.get(t.category_id) ?? (Number(t.amount) > 0 ? "income" : "expense"))
      : Number(t.amount) > 0
        ? "income"
        : "expense";
    if (kind === "transfer") continue;
    if (kind === "income") income += Number(t.amount);
    else expense += -Number(t.amount);
    if (tab === "spending" && kind !== "expense") continue;
    if (tab === "income" && kind !== "income") continue;
    const v = Math.abs(Number(t.amount));
    const cat = t.category_id ? catById.get(t.category_id) : null;
    let key: string, label: string, icon: string | null;
    if (by === "merchant") {
      key = t.name;
      label = t.name;
      icon = null;
    } else if (by === "group") {
      key = cat?.group ?? "Other";
      label = cat?.group ?? "Other";
      icon = null;
    } else {
      key = cat?.id ?? "un";
      label = cat?.name ?? "Uncategorized";
      icon = cat?.icon ?? null;
    }
    const b = buckets.get(key) ?? { label, icon, value: 0 };
    b.value += v;
    buckets.set(key, b);
  }
  const rows = [...buckets.values()].sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const savings = income - expense;
  const donutData = rows.slice(0, 8).map((r) => ({ name: r.label, value: Math.round(r.value) }));
  if (rows.length > 8) {
    donutData.push({
      name: "Other",
      value: Math.round(rows.slice(8).reduce((s, r) => s + r.value, 0)),
    });
  }

  return (
    <>
      <PageHeader
        title="Reports"
        tabs={
          <div className="flex items-center gap-1">
            {(["spending", "income"] as const).map((t) => (
              <a
                key={t}
                href={`/reports?tab=${t}&range=${rangeKey}&by=${by}&ccy=${ccy}`}
                className={`rounded-lg px-2.5 py-1 text-[13.5px] font-medium ${tab === t ? "text-accent underline decoration-2 underline-offset-8" : "text-muted hover:text-ink"}`}
              >
                {t === "spending" ? "Spending" : "Income"}
              </a>
            ))}
          </div>
        }
        right={
          <>
            {currencies.length > 1 ? (
              <Segmented
                options={currencies.map((c) => ({
                  value: c,
                  label: c === "ILS" ? "₪ ILS" : c === "USD" ? "$ USD" : c,
                }))}
                value={ccy}
                hrefBase={`/reports?tab=${tab}&range=${rangeKey}&by=${by}`}
                param="ccy"
              />
            ) : null}
            <Segmented
              options={Object.entries(RANGES).map(([k, v]) => ({ value: k, label: v.label }))}
              value={rangeKey}
              hrefBase={`/reports?tab=${tab}&by=${by}&ccy=${ccy}`}
              param="range"
            />
            <Segmented
              options={[
                { value: "category", label: "Category" },
                { value: "group", label: "Group" },
                { value: "merchant", label: "Merchant" },
              ]}
              value={by}
              hrefBase={`/reports?tab=${tab}&range=${rangeKey}&ccy=${ccy}`}
              param="by"
            />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader
            title={tab === "spending" ? "Total spending" : "Total income"}
            sub={`${RANGES[rangeKey].label} · ${ccy}`}
          />
          <div className="relative px-4 pb-4">
            <Donut data={donutData} currency={ccy} height={230} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="tnum text-[19px] font-semibold">
                {fmtMoney(total, ccy, { decimals: false })}
              </span>
              <span className="text-[11px] text-muted">
                {tab === "spending" ? "spent" : "earned"}
              </span>
            </div>
          </div>
          <div className="border-t border-line px-5 py-3 text-[12.5px] text-muted">
            Savings this period:{" "}
            <span className={`tnum font-medium ${savings >= 0 ? "text-pos" : "text-neg"}`}>
              {fmtMoney(savings, ccy, { decimals: false })}
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Breakdown"
            sub={`${rows.length} ${by === "merchant" ? "merchants" : by === "group" ? "groups" : "categories"}`}
          />
          <div className="flex flex-col gap-0.5 px-5 pb-4">
            {rows.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">
                Nothing in this period.
              </p>
            ) : (
              rows.slice(0, 30).map((r, i) => (
                <div key={i} className="flex items-center gap-3 py-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: DONUT_COLORS[Math.min(i, 8) % DONUT_COLORS.length] }}
                  />
                  <span className="w-[45%] truncate text-[13px] font-medium" dir="auto">
                    {r.icon ? `${r.icon} ` : ""}
                    {r.label}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-active">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${total > 0 ? Math.max(1, (r.value / total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="tnum w-24 text-right text-[13px]">
                    {fmtMoney(r.value, ccy, { decimals: false })}
                  </span>
                  <span className="tnum w-10 text-right text-[12px] text-muted">
                    {total > 0 ? Math.round((r.value / total) * 100) : 0}%
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
