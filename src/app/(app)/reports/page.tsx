import { getAccounts, getCategories, getContext } from "@/lib/data";
import { activeCurrencies, computeCashflowPerCurrency } from "@/lib/multicurrency";
import { fmtMoney, fmtPct, monthStart, addMonths } from "@/lib/format";
import { Donut, DONUT_COLORS, TrendBars } from "@/components/charts";
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
  const tab =
    params.tab === "income"
      ? "income"
      : params.tab === "cashflow"
        ? "cashflow"
        : "spending";
  const rangeKey = RANGES[params.range ?? ""] ? params.range! : tab === "cashflow" ? "12m" : "3m";
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

  function kindFor(t: Transaction): string {
    if (t.hide_from_reports || t.is_transfer) return "skip";
    const k = t.category_id
      ? (kindOf.get(t.category_id) ?? (Number(t.amount) > 0 ? "income" : "expense"))
      : Number(t.amount) > 0
        ? "income"
        : "expense";
    return k === "transfer" ? "skip" : k;
  }

  function bucketBy(kind: "income" | "expense") {
    const buckets = new Map<string, { label: string; icon: string | null; value: number }>();
    for (const t of list) {
      if (kindFor(t) !== kind) continue;
      const v = Math.abs(Number(t.amount));
      const cat = t.category_id ? catById.get(t.category_id) : null;
      let key: string, label: string, icon: string | null;
      if (by === "merchant") {
        key = label = t.name;
        icon = null;
      } else if (by === "group") {
        key = label = cat?.group ?? "Other";
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
    return [...buckets.values()].sort((a, b) => b.value - a.value);
  }

  const header = (
    <PageHeader
      title="Reports"
      tabs={
        <div className="flex items-center gap-1">
          {(["cashflow", "spending", "income"] as const).map((t) => (
            <a
              key={t}
              href={`/reports?tab=${t}&range=${rangeKey}&by=${by}&ccy=${ccy}`}
              className={`rounded-lg px-2.5 py-1 text-[13.5px] font-medium ${tab === t ? "text-accent underline decoration-2 underline-offset-8" : "text-muted hover:text-ink"}`}
            >
              {t === "cashflow" ? "Cash Flow" : t === "spending" ? "Spending" : "Income"}
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
          {tab !== "cashflow" ? (
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
          ) : null}
        </>
      }
    />
  );

  // ------------------------------------------------------- Cash Flow tab
  if (tab === "cashflow") {
    const cf = computeCashflowPerCurrency(list, categories).get(ccy);
    const byMonth = new Map<string, Transaction[]>();
    for (const t of list) {
      const m = t.date.slice(0, 7);
      const arr = byMonth.get(m) ?? [];
      arr.push(t);
      byMonth.set(m, arr);
    }
    const months = Math.min(RANGES[rangeKey].months, 24);
    const trend: { label: string; income: number; expense: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const m = addMonths(monthStart(), -i).slice(0, 7);
      const mcf = computeCashflowPerCurrency(byMonth.get(m) ?? [], categories).get(ccy);
      trend.push({
        label: new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
        }),
        income: Math.round(mcf?.income ?? 0),
        expense: Math.round(mcf?.expense ?? 0),
      });
    }
    const incomeRows = bucketBy("income");
    const expenseRows = bucketBy("expense");
    const maxIncome = Math.max(1, ...incomeRows.map((r) => r.value));
    const maxExpense = Math.max(1, ...expenseRows.map((r) => r.value));

    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-6 pt-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="TOTAL INCOME" value={fmtMoney(cf?.income ?? 0, ccy, { decimals: false })} tone="pos" />
            <StatCard label="TOTAL SPENDING" value={fmtMoney(cf?.expense ?? 0, ccy, { decimals: false })} />
            <StatCard
              label="NET CASH FLOW"
              value={fmtMoney(cf?.savings ?? 0, ccy, { decimals: false })}
              tone={(cf?.savings ?? 0) >= 0 ? "pos" : "neg"}
            />
            <StatCard
              label="SAVINGS RATE"
              value={cf && cf.income > 0 ? fmtPct(cf.savingsRate * 100, 0) : "—"}
            />
          </div>
          <Card>
            <CardHeader title="Income vs expenses" sub={RANGES[rangeKey].label} />
            <div className="px-2 pb-2">
              <TrendBars data={trend} currency={ccy} height={230} />
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Income breakdown" />
              <div className="flex flex-col gap-1 px-5 pb-4">
                {incomeRows.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-muted">Nothing here.</p>
                ) : (
                  incomeRows.slice(0, 15).map((r, i) => (
                    <RankRow key={i} row={r} max={maxIncome} currency={ccy} color="bg-pos-soft" />
                  ))
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Expense breakdown" />
              <div className="flex flex-col gap-1 px-5 pb-4">
                {expenseRows.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-muted">Nothing here.</p>
                ) : (
                  expenseRows.slice(0, 15).map((r, i) => (
                    <RankRow key={i} row={r} max={maxExpense} currency={ccy} color="bg-neg-soft" />
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  // --------------------------------------------- Spending / Income tabs
  const rows = bucketBy(tab === "spending" ? "expense" : "income");
  const total = rows.reduce((s, r) => s + r.value, 0);
  const donutData = rows.slice(0, 8).map((r) => ({ name: r.label, value: Math.round(r.value) }));
  if (rows.length > 8) {
    donutData.push({
      name: "Other",
      value: Math.round(rows.slice(8).reduce((s, r) => s + r.value, 0)),
    });
  }

  return (
    <>
      {header}
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

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <Card className="px-5 py-4 text-center">
      <div
        className={`tnum text-[19px] font-semibold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-semibold tracking-wider text-muted">
        {label}
      </div>
    </Card>
  );
}

function RankRow({
  row,
  max,
  currency,
  color,
}: {
  row: { label: string; icon: string | null; value: number };
  max: number;
  currency: string;
  color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-md">
      <div
        className={`absolute inset-y-0 left-0 ${color}`}
        style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
      />
      <div className="relative flex items-center justify-between px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium" dir="auto">
          {row.icon ? <span>{row.icon}</span> : null}
          {row.label}
        </span>
        <span className="tnum text-[13px]">
          {fmtMoney(row.value, currency, { decimals: false })}
        </span>
      </div>
    </div>
  );
}
