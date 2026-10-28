import { getCategories, getContext } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { computeCashflowPerCurrency, currencyOrder } from "@/lib/multicurrency";
import { addMonths, fmtMoney, fmtPct, monthLabel, monthStart } from "@/lib/format";
import { TrendBars } from "@/components/charts";
import { Card, CardHeader, PageHeader, Segmented } from "@/components/ui";
import type { Transaction } from "@/lib/types";

const CCY_SYMBOL: Record<string, string> = { ILS: "₪", USD: "$" };

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const { supabase, space } = await getContext();
  const categories = await getCategories();

  const month = params.month ?? monthStart().slice(0, 7);
  const since = addMonths(monthStart(), -11);

  const { data: txns } = await fetchAll((from, to) =>
    supabase
      .from("transactions")
      .select("*")
      .eq("space_id", space.id)
      .gte("date", since)
      .order("date")
      .order("id")
      .range(from, to),
  );

  const byMonth = new Map<string, Transaction[]>();
  const seen = new Set<string>();
  for (const t of (txns ?? []) as Transaction[]) {
    const m = t.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(t);
    byMonth.set(m, arr);
    seen.add(t.currency);
  }
  const currencies = currencyOrder(seen);

  // 12-month trend per currency
  const trendByCcy = new Map<string, { label: string; income: number; expense: number }[]>();
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(monthStart(), -i).slice(0, 7);
    const label = new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
    const cf = computeCashflowPerCurrency(byMonth.get(m) ?? [], categories);
    for (const ccy of currencies) {
      const arr = trendByCcy.get(ccy) ?? [];
      const c = cf.get(ccy);
      arr.push({
        label,
        income: Math.round(c?.income ?? 0),
        expense: Math.round(c?.expense ?? 0),
      });
      trendByCcy.set(ccy, arr);
    }
  }

  const monthCf = computeCashflowPerCurrency(byMonth.get(month) ?? [], categories);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const m = addMonths(monthStart(), -i).slice(0, 7);
    monthOptions.push({
      value: m,
      label: monthLabel(m).split(" ")[0],
    });
  }

  function rankRows(map: Map<string, number>) {
    return [...map.entries()]
      .map(([id, v]) => ({
        cat: id === "uncategorized" ? null : (catById.get(id) ?? null),
        value: v,
      }))
      .sort((a, b) => b.value - a.value);
  }

  return (
    <>
      <PageHeader
        title="Cash Flow"
        right={
          <Segmented
            options={monthOptions}
            value={month}
            hrefBase="/cash-flow"
            param="month"
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-2">
        {currencies.length === 0 ? (
          <Card>
            <p className="px-5 py-10 text-center text-[13px] text-muted">
              No transactions yet. Connect an account first.
            </p>
          </Card>
        ) : null}

        {currencies.map((ccy) => {
          const cf = monthCf.get(ccy);
          const trend = trendByCcy.get(ccy) ?? [];
          const hasAny = trend.some((t) => t.income > 0 || t.expense > 0);
          if (!hasAny) return null;
          const incomeRows = cf ? rankRows(cf.incomeByCategory) : [];
          const expenseRows = cf ? rankRows(cf.expenseByCategory) : [];
          const maxIncome = Math.max(1, ...incomeRows.map((r) => r.value));
          const maxExpense = Math.max(1, ...expenseRows.map((r) => r.value));
          return (
            <section key={ccy} className="flex flex-col gap-3">
              <h2 className="mt-2 text-[16px] font-semibold">
                {CCY_SYMBOL[ccy] ?? ""} {ccy} · {monthLabel(month)}
              </h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="INCOME" value={fmtMoney(cf?.income ?? 0, ccy, { decimals: false })} tone="pos" />
                <Stat label="EXPENSES" value={fmtMoney(cf?.expense ?? 0, ccy, { decimals: false })} />
                <Stat
                  label="TOTAL SAVINGS"
                  value={fmtMoney(cf?.savings ?? 0, ccy, { decimals: false })}
                  tone={(cf?.savings ?? 0) >= 0 ? "pos" : "neg"}
                />
                <Stat
                  label="SAVINGS RATE"
                  value={cf && cf.income > 0 ? fmtPct(cf.savingsRate * 100, 0) : "—"}
                />
              </div>

              <Card>
                <CardHeader title={`Income vs expenses`} sub="last 12 months" />
                <div className="px-2 pb-2">
                  <TrendBars data={trend} currency={ccy} height={190} />
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Income" />
                  <div className="flex flex-col gap-1 px-5 pb-4">
                    {incomeRows.length === 0 ? (
                      <p className="py-3 text-center text-[13px] text-muted">
                        No income this month.
                      </p>
                    ) : (
                      incomeRows.map((r, i) => (
                        <BarRow
                          key={i}
                          icon={r.cat?.icon}
                          name={r.cat?.name ?? "Uncategorized"}
                          value={r.value}
                          max={maxIncome}
                          share={cf && cf.income > 0 ? r.value / cf.income : 0}
                          currency={ccy}
                          color="bg-pos-soft"
                        />
                      ))
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Expenses" />
                  <div className="flex flex-col gap-1 px-5 pb-4">
                    {expenseRows.length === 0 ? (
                      <p className="py-3 text-center text-[13px] text-muted">
                        No expenses this month.
                      </p>
                    ) : (
                      expenseRows.map((r, i) => (
                        <BarRow
                          key={i}
                          icon={r.cat?.icon}
                          name={r.cat?.name ?? "Uncategorized"}
                          value={r.value}
                          max={maxExpense}
                          share={cf && cf.expense > 0 ? r.value / cf.expense : 0}
                          currency={ccy}
                          color="bg-neg-soft"
                        />
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Stat({
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

function BarRow({
  icon,
  name,
  value,
  max,
  share,
  currency,
  color,
}: {
  icon?: string | null;
  name: string;
  value: number;
  max: number;
  share: number;
  currency: string;
  color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-md">
      <div
        className={`absolute inset-y-0 left-0 ${color}`}
        style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
      />
      <div className="relative flex items-center justify-between px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium" dir="auto">
          {icon ? <span>{icon}</span> : null}
          {name}
        </span>
        <span className="tnum text-[13px]">
          {fmtMoney(value, currency, { decimals: false })}{" "}
          <span className="text-muted">({Math.round(share * 100)}%)</span>
        </span>
      </div>
    </div>
  );
}
