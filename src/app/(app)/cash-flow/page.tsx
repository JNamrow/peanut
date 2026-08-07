import { getCategories, getContext } from "@/lib/data";
import { computeCashflow } from "@/lib/cashflow";
import { addMonths, fmtMoney, fmtPct, monthLabel, monthStart } from "@/lib/format";
import { TrendBars } from "@/components/charts";
import { Card, CardHeader, PageHeader, Segmented } from "@/components/ui";
import type { Transaction } from "@/lib/types";

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const { supabase, space, rates, displayCurrency } = await getContext();
  const categories = await getCategories();

  const month = params.month ?? monthStart().slice(0, 7);
  const since = addMonths(monthStart(), -11);

  const { data: txns } = await supabase
    .from("transactions")
    .select("*")
    .eq("space_id", space.id)
    .gte("date", since);

  const byMonth = new Map<string, Transaction[]>();
  for (const t of (txns ?? []) as Transaction[]) {
    const m = t.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(t);
    byMonth.set(m, arr);
  }

  const trend: { label: string; income: number; expense: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(monthStart(), -i).slice(0, 7);
    const cf = computeCashflow(byMonth.get(m) ?? [], categories, rates, displayCurrency);
    trend.push({
      label: new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
      }),
      income: Math.round(cf.income),
      expense: Math.round(cf.expense),
    });
  }

  const cf = computeCashflow(byMonth.get(month) ?? [], categories, rates, displayCurrency);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = addMonths(monthStart(), -i).slice(0, 7);
    monthOptions.push({ value: m, label: monthLabel(m) });
  }

  function rankRows(map: Map<string, number>) {
    return [...map.entries()]
      .map(([id, v]) => ({
        cat: id === "uncategorized" ? null : (catById.get(id) ?? null),
        value: v,
      }))
      .sort((a, b) => b.value - a.value);
  }
  const incomeRows = rankRows(cf.incomeByCategory);
  const expenseRows = rankRows(cf.expenseByCategory);
  const maxIncome = Math.max(1, ...incomeRows.map((r) => r.value));
  const maxExpense = Math.max(1, ...expenseRows.map((r) => r.value));

  return (
    <>
      <PageHeader title="Cash Flow" />
      <div className="flex flex-col gap-4 px-6 pt-2">
        <Card>
          <CardHeader title="Income vs expenses" sub="last 12 months" />
          <div className="px-2 pb-2">
            <TrendBars data={trend} currency={displayCurrency} height={220} />
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{monthLabel(month)}</h2>
          <Segmented
            options={monthOptions.slice(0, 6).map((o) => ({
              value: o.value,
              label: o.label.split(" ")[0],
            }))}
            value={month}
            hrefBase="/cash-flow"
            param="month"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="INCOME" value={fmtMoney(cf.income, displayCurrency, { decimals: false })} tone="pos" />
          <Stat label="EXPENSES" value={fmtMoney(cf.expense, displayCurrency, { decimals: false })} />
          <Stat
            label="TOTAL SAVINGS"
            value={fmtMoney(cf.savings, displayCurrency, { decimals: false })}
            tone={cf.savings >= 0 ? "pos" : "neg"}
          />
          <Stat
            label="SAVINGS RATE"
            value={cf.income > 0 ? fmtPct(cf.savingsRate * 100, 0) : "—"}
          />
        </div>

        <Card>
          <CardHeader title="Income" />
          <div className="flex flex-col gap-1 px-5 pb-4">
            {incomeRows.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted">
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
                  share={cf.income > 0 ? r.value / cf.income : 0}
                  currency={displayCurrency}
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
              <p className="py-4 text-center text-[13px] text-muted">
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
                  share={cf.expense > 0 ? r.value / cf.expense : 0}
                  currency={displayCurrency}
                  color="bg-neg-soft"
                />
              ))
            )}
          </div>
        </Card>
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
        className={`tnum text-[20px] font-semibold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}
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
