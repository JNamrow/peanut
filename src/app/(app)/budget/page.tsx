import Link from "next/link";
import { getCategories, getContext } from "@/lib/data";
import { computeCashflow } from "@/lib/cashflow";
import { addMonths, fmtMoney, monthLabel, monthStart } from "@/lib/format";
import { Card, PageHeader, buttonCls } from "@/components/ui";
import { BudgetInput } from "./budget-input";
import type { Budget, Category, Transaction } from "@/lib/types";
import { ChevronLeft, ChevronRight } from "lucide-react";

const BUCKETS: { key: string; label: string }[] = [
  { key: "fixed", label: "Fixed" },
  { key: "flexible", label: "Flexible" },
  { key: "non_monthly", label: "Non-Monthly" },
];

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? `${params.month}-01`
    : monthStart();
  const monthKey = month.slice(0, 7);

  const { supabase, space, rates, displayCurrency } = await getContext();
  const categories = await getCategories();

  const nextMonth = addMonths(month, 1);
  const [{ data: budgets }, { data: txns }] = await Promise.all([
    supabase
      .from("budgets")
      .select("*")
      .eq("space_id", space.id)
      .eq("month", month),
    supabase
      .from("transactions")
      .select("*")
      .eq("space_id", space.id)
      .gte("date", month)
      .lt("date", nextMonth),
  ]);

  const budgetByCat = new Map(
    ((budgets ?? []) as Budget[]).map((b) => [b.category_id, Number(b.amount)]),
  );
  const cf = computeCashflow(
    (txns ?? []) as Transaction[],
    categories,
    rates,
    displayCurrency,
  );

  const incomeCats = categories.filter((c) => c.kind === "income");
  const expenseCats = categories.filter(
    (c) => c.kind === "expense" && !c.exclude_from_budget,
  );

  function actualFor(c: Category): number {
    return c.kind === "income"
      ? (cf.incomeByCategory.get(c.id) ?? 0)
      : (cf.expenseByCategory.get(c.id) ?? 0);
  }

  const plannedIncome = incomeCats.reduce((s, c) => s + (budgetByCat.get(c.id) ?? 0), 0);
  const plannedExpenses = expenseCats.reduce((s, c) => s + (budgetByCat.get(c.id) ?? 0), 0);
  const leftToBudget = plannedIncome - plannedExpenses;

  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1).slice(0, 7);

  return (
    <>
      <PageHeader
        title={monthLabel(month)}
        right={
          <div className="flex items-center gap-1.5">
            <Link href={`/budget?month=${prev}`} className={buttonCls("secondary", "sm")}>
              <ChevronLeft size={14} />
            </Link>
            <Link href="/budget" className={buttonCls("secondary", "sm")}>
              Today
            </Link>
            <Link href={`/budget?month=${next}`} className={buttonCls("secondary", "sm")}>
              <ChevronRight size={14} />
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 xl:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeader label="Income" />
            {incomeCats.map((c) => (
              <BudgetRow
                key={c.id}
                category={c}
                month={month}
                planned={budgetByCat.get(c.id) ?? 0}
                actual={actualFor(c)}
                currency={displayCurrency}
                isIncome
              />
            ))}
            <TotalRow
              label="Total income"
              planned={plannedIncome}
              actual={cf.income}
              currency={displayCurrency}
            />
          </Card>

          {BUCKETS.map((bucket) => {
            const cats = expenseCats.filter(
              (c) => (c.budget_bucket ?? "flexible") === bucket.key,
            );
            if (cats.length === 0) return null;
            const withData = cats.filter(
              (c) => (budgetByCat.get(c.id) ?? 0) > 0 || actualFor(c) > 0,
            );
            const zero = cats.filter((c) => !withData.includes(c));
            const planned = cats.reduce((s, c) => s + (budgetByCat.get(c.id) ?? 0), 0);
            const actual = cats.reduce((s, c) => s + actualFor(c), 0);
            return (
              <Card key={bucket.key}>
                <SectionHeader label={bucket.label} />
                {withData.map((c) => (
                  <BudgetRow
                    key={c.id}
                    category={c}
                    month={month}
                    planned={budgetByCat.get(c.id) ?? 0}
                    actual={actualFor(c)}
                    currency={displayCurrency}
                  />
                ))}
                {zero.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer px-5 py-2 text-[12.5px] text-muted hover:text-ink">
                      Show {zero.length} unbudgeted
                    </summary>
                    {zero.map((c) => (
                      <BudgetRow
                        key={c.id}
                        category={c}
                        month={month}
                        planned={0}
                        actual={0}
                        currency={displayCurrency}
                      />
                    ))}
                  </details>
                ) : null}
                <TotalRow
                  label={`Total ${bucket.label.toLowerCase()}`}
                  planned={planned}
                  actual={actual}
                  currency={displayCurrency}
                />
              </Card>
            );
          })}

          <Card>
            <TotalRow
              label="Total expenses"
              planned={plannedExpenses}
              actual={cf.expense}
              currency={displayCurrency}
              big
            />
          </Card>
        </div>

        <div>
          <Card className="bg-pos-soft/60">
            <div className="px-5 py-5 text-center">
              <div className="tnum text-[24px] font-semibold text-pos">
                {fmtMoney(leftToBudget, displayCurrency, { decimals: false })}
              </div>
              <div className="text-[12.5px] font-medium text-pos">Left to budget</div>
            </div>
          </Card>
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-faint">
            Budgets are in {displayCurrency}. Spending in the other currency
            converts at the day&apos;s rate. Set a planned amount by clicking
            a number in the Planned column.
          </p>
        </div>
      </div>
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_110px] gap-2 rounded-t-card bg-bg/60 px-5 py-2">
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      <span className="text-right text-[12px] font-medium text-muted">Planned</span>
      <span className="text-right text-[12px] font-medium text-muted">Actual</span>
      <span className="text-right text-[12px] font-medium text-muted">Remaining</span>
    </div>
  );
}

function BudgetRow({
  category,
  month,
  planned,
  actual,
  currency,
  isIncome = false,
}: {
  category: Category;
  month: string;
  planned: number;
  actual: number;
  currency: string;
  isIncome?: boolean;
}) {
  const remaining = planned - actual;
  const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
  return (
    <div className="group border-t border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_110px] items-center gap-2 px-5 py-2">
        <span className="truncate text-[13.5px] font-medium" dir="auto">
          {category.icon ? `${category.icon} ` : ""}
          {category.name}
        </span>
        <div className="text-right">
          <BudgetInput month={month} categoryId={category.id} value={planned} />
        </div>
        <span className="tnum text-right text-[13px]">
          {fmtMoney(actual, currency, { decimals: false })}
        </span>
        <span
          className={`tnum text-right text-[13px] ${
            planned === 0 ? "text-faint" : remaining >= 0 ? "text-pos" : "text-neg"
          }`}
        >
          {planned === 0 ? "—" : fmtMoney(remaining, currency, { decimals: false })}
        </span>
      </div>
      {planned > 0 ? (
        <div className="mx-5 mb-2 h-1 overflow-hidden rounded-full bg-active">
          <div
            className={`h-full rounded-full ${
              isIncome ? "bg-pos" : actual > planned ? "bg-neg" : "bg-pos"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function TotalRow({
  label,
  planned,
  actual,
  currency,
  big = false,
}: {
  label: string;
  planned: number;
  actual: number;
  currency: string;
  big?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_110px_110px_110px] gap-2 border-t border-line px-5 ${big ? "py-3.5" : "py-2.5"}`}
    >
      <span className={`font-semibold ${big ? "text-[14.5px]" : "text-[13px]"}`}>
        {label}
      </span>
      <span className="tnum text-right text-[13px] font-semibold">
        {fmtMoney(planned, currency, { decimals: false })}
      </span>
      <span className="tnum text-right text-[13px] font-semibold">
        {fmtMoney(actual, currency, { decimals: false })}
      </span>
      <span className="tnum text-right text-[13px] font-semibold">
        {fmtMoney(planned - actual, currency, { decimals: false })}
      </span>
    </div>
  );
}
