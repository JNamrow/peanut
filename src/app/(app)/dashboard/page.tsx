import Link from "next/link";
import { getAccounts, getCategories, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  computeCashflowPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney, fmtPct, monthStart, addMonths, shortDate } from "@/lib/format";
import { NetWorthChart, TrendBars } from "@/components/charts";
import { DualMoney } from "@/components/dual-money";
import { Card, CardHeader, EmptyState, buttonCls } from "@/components/ui";
import type { Account, Transaction } from "@/lib/types";
import { Plus } from "lucide-react";

const CCY_SYMBOL: Record<string, string> = { ILS: "₪", USD: "$" };

export default async function DashboardPage() {
  const ctx = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);
  const { supabase, space, members, userId } = ctx;

  const accountIds = accounts.map((a) => a.id);
  const sixMonthsAgo = addMonths(monthStart(), -5);
  const ninetyAgo = new Date();
  ninetyAgo.setDate(ninetyAgo.getDate() - 100);

  const [{ data: snapshots }, { data: recentTxns }, { data: periodTxns }, { data: recurring }] =
    await Promise.all([
      accountIds.length
        ? supabase
            .from("account_balance_snapshots")
            .select("*")
            .in("account_id", accountIds)
            .gte("as_of_date", ninetyAgo.toISOString().slice(0, 10))
        : Promise.resolve({ data: [] }),
      supabase
        .from("transactions")
        .select("*")
        .eq("space_id", space.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(7),
      supabase
        .from("transactions")
        .select("*")
        .eq("space_id", space.id)
        .gte("date", sixMonthsAgo),
      supabase
        .from("recurring_streams")
        .select("*")
        .eq("space_id", space.id)
        .eq("status", "active")
        .order("next_expected_date")
        .limit(5),
    ]);

  const me = members.find((m) => m.user_id === userId);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const currencies = activeCurrencies(accounts);
  const netByCcy = sumBalancesByCurrency(accounts);
  const seriesByCcy = buildSeriesPerCurrency(accounts, snapshots ?? [], 90);

  // Per-month, per-currency cash flow for the trend + this month's stats.
  const byMonth = new Map<string, Transaction[]>();
  for (const t of (periodTxns ?? []) as Transaction[]) {
    const m = t.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(t);
    byMonth.set(m, arr);
  }
  const trendByCcy = new Map<string, { label: string; income: number; expense: number }[]>();
  for (let i = 5; i >= 0; i--) {
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
  const thisMonthCf = computeCashflowPerCurrency(
    byMonth.get(monthStart().slice(0, 7)) ?? [],
    categories,
  );

  const catById = new Map(categories.map((c) => [c.id, c]));
  const investAccounts = accounts.filter(
    (a) => (a.type === "investment" || a.type === "pension") && !a.hidden,
  );
  const investByCcy = sumBalancesByCurrency(investAccounts);

  return (
    <div className="px-6 pt-5">
      <h1 className="mb-5 text-[19px] font-semibold">
        {greeting}, {me?.display_name ?? "there"}!
      </h1>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-4 xl:col-span-3">
          <Card>
            <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
              {currencies.length === 0 ? (
                <div className="md:col-span-2">
                  <EmptyState
                    title="No balance history yet"
                    sub="Add accounts and history will build up daily."
                  />
                </div>
              ) : (
                currencies.map((ccy) => {
                  const series = seriesByCcy.get(ccy) ?? [];
                  const net = netByCcy.get(ccy)?.net ?? 0;
                  const start = series.length ? series[0].value : net;
                  const change = net - start;
                  return (
                    <div key={ccy} className={currencies.length === 1 ? "md:col-span-2" : ""}>
                      <div className="px-5 pt-4">
                        <div className="text-[11px] font-semibold tracking-wider text-muted">
                          {CCY_SYMBOL[ccy] ?? ccy} NET WORTH
                        </div>
                        <div className="flex items-baseline gap-2.5">
                          <span className="tnum text-[24px] font-semibold">
                            {fmtMoney(net, ccy, { decimals: false })}
                          </span>
                          {series.length > 1 ? (
                            <span
                              className={`tnum text-[12.5px] font-medium ${change >= 0 ? "text-pos" : "text-neg"}`}
                            >
                              {change >= 0 ? "↗" : "↘"}{" "}
                              {fmtMoney(Math.abs(change), ccy, { decimals: false })} 3mo
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="px-2 pb-1 pt-1">
                        {series.length > 1 ? (
                          <NetWorthChart data={series} currency={ccy} height={150} />
                        ) : (
                          <p className="px-3 pb-3 text-[12.5px] text-muted">
                            History starts today.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Cash flow"
              sub="last 6 months"
              right={
                <Link href="/cash-flow" className="text-[12.5px] font-medium text-accent">
                  See all
                </Link>
              }
            />
            {currencies.map((ccy) => {
              const cf = thisMonthCf.get(ccy);
              const trend = trendByCcy.get(ccy) ?? [];
              const hasAny = trend.some((t) => t.income > 0 || t.expense > 0);
              if (!hasAny) return null;
              return (
                <div key={ccy} className="border-t border-line first:border-0">
                  <div className="flex items-center gap-4 px-5 pt-3">
                    <span className="text-[12px] font-semibold text-muted">
                      {CCY_SYMBOL[ccy] ?? ccy} {ccy}
                    </span>
                    <span className="tnum text-[12.5px] text-pos">
                      +{fmtMoney(cf?.income ?? 0, ccy, { decimals: false })}
                    </span>
                    <span className="tnum text-[12.5px] text-neg">
                      −{fmtMoney(cf?.expense ?? 0, ccy, { decimals: false })}
                    </span>
                    <span className="text-[12.5px] text-muted">
                      {cf && cf.income > 0 ? `${fmtPct(cf.savingsRate * 100, 0)} saved` : ""}
                    </span>
                  </div>
                  <div className="px-2 pb-1">
                    <TrendBars data={trend} currency={ccy} height={140} />
                  </div>
                </div>
              );
            })}
            {currencies.length === 0 ? (
              <p className="px-5 pb-4 text-[13px] text-muted">No activity yet.</p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Transactions"
              sub="most recent"
              right={
                <Link href="/transactions" className="text-[12.5px] font-medium text-accent">
                  All transactions
                </Link>
              }
            />
            <div className="px-2 pb-2">
              {(recentTxns ?? []).length === 0 ? (
                <EmptyState
                  title="No transactions yet"
                  sub="Connect Plaid or RiseUp and they will stream in."
                />
              ) : (
                ((recentTxns ?? []) as Transaction[]).map((t) => {
                  const cat = t.category_id ? catById.get(t.category_id) : null;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-hover"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-active text-[13px]">
                          {cat?.icon ?? "💸"}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-medium" dir="auto">
                            {t.name}
                          </div>
                          <div className="text-[12px] text-muted">
                            {shortDate(t.date)}
                            {cat ? ` · ${cat.name}` : ""}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`tnum text-[13.5px] font-medium ${Number(t.amount) > 0 ? "text-pos" : ""}`}
                      >
                        {fmtMoney(Number(t.amount), t.currency, { sign: Number(t.amount) > 0 })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="Accounts"
              right={
                <Link href="/accounts" className={buttonCls("secondary", "sm")}>
                  <Plus size={13} /> Add
                </Link>
              }
            />
            <div className="px-5 pb-4">
              {accounts.length === 0 ? (
                <EmptyState
                  title="No accounts yet"
                  sub="Connect your US accounts with Plaid and Israeli accounts with RiseUp."
                  action={
                    <Link href="/accounts" className={buttonCls("primary", "sm")}>
                      Add account
                    </Link>
                  }
                />
              ) : (
                <AccountGroupsMini accounts={accounts} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recurring"
              sub="coming up"
              right={
                <Link href="/recurring" className="text-[12.5px] font-medium text-accent">
                  See all
                </Link>
              }
            />
            <div className="px-5 pb-4">
              {(recurring ?? []).length === 0 ? (
                <p className="pb-2 text-[13px] text-muted">
                  Nothing detected yet. Peanut scans your transactions for repeat bills.
                </p>
              ) : (
                (recurring ?? []).map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-1.5">
                    <div>
                      <div className="text-[13.5px] font-medium" dir="auto">
                        {r.merchant_name}
                      </div>
                      <div className="text-[12px] text-muted">
                        {r.next_expected_date ? shortDate(r.next_expected_date) : "—"}
                      </div>
                    </div>
                    <span className="tnum text-[13.5px]">
                      {fmtMoney(Number(r.typical_amount ?? 0), r.currency)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Investments"
              right={
                <Link href="/investments" className="text-[12.5px] font-medium text-accent">
                  Details
                </Link>
              }
            />
            <div className="px-5 pb-4">
              <DualMoney
                size="lg"
                values={currencyOrderOf(investByCcy).map((c) => ({
                  currency: c,
                  value: investByCcy.get(c)?.net ?? 0,
                }))}
              />
              <div className="text-[12.5px] text-muted">
                Brokerage, pension, and study funds
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

import { currencyOrder } from "@/lib/multicurrency";

function currencyOrderOf(map: Map<string, unknown>): string[] {
  return currencyOrder(map.keys());
}

function AccountGroupsMini({ accounts }: { accounts: Account[] }) {
  const groups: { label: string; types: string[] }[] = [
    { label: "Cash", types: ["checking", "savings", "cash"] },
    { label: "Credit cards", types: ["credit"] },
    { label: "Investments", types: ["investment"] },
    { label: "Pensions", types: ["pension"] },
    { label: "Loans", types: ["loan"] },
    { label: "Other", types: ["property", "vehicle", "other_asset", "other_liability"] },
  ];
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const list = accounts.filter((a) => g.types.includes(a.type) && !a.hidden);
        if (list.length === 0) return null;
        const byCcy = sumBalancesByCurrency(list);
        return (
          <div key={g.label} className="flex items-center justify-between gap-2 py-1">
            <span className="text-[13.5px] text-ink-soft">
              {g.label}
              <span className="ml-1.5 text-[12px] text-faint">{list.length}</span>
            </span>
            <DualMoney
              size="md"
              className="justify-end font-medium"
              values={currencyOrderOf(byCcy).map((c) => ({
                currency: c,
                value: byCcy.get(c)?.net ?? 0,
              }))}
            />
          </div>
        );
      })}
    </div>
  );
}
