import Link from "next/link";
import { getAccounts, getCategories, getContext, sumBalances } from "@/lib/data";
import { buildNetWorthSeries } from "@/lib/networth";
import { computeCashflow } from "@/lib/cashflow";
import { fmtMoney, fmtPct, monthStart, addMonths, shortDate } from "@/lib/format";
import { NetWorthChart, TrendBars } from "@/components/charts";
import { Card, CardHeader, EmptyState, buttonCls } from "@/components/ui";
import type { Transaction } from "@/lib/types";
import { Plus } from "lucide-react";

export default async function DashboardPage() {
  const ctx = await getContext();
  const [accounts, categories] = await Promise.all([
    getAccounts(),
    getCategories(),
  ]);
  const { supabase, space, rates, displayCurrency, members, userId } = ctx;

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

  const series = buildNetWorthSeries(
    accounts,
    snapshots ?? [],
    rates,
    displayCurrency,
    90,
  );
  const { net } = sumBalances(accounts, rates, displayCurrency);
  const netStart = series.length ? series[0].value : net;
  const netChange = net - netStart;

  // income vs expenses, last 6 months
  const byMonth = new Map<string, Transaction[]>();
  for (const t of (periodTxns ?? []) as Transaction[]) {
    const m = t.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(t);
    byMonth.set(m, arr);
  }
  const trend: { label: string; income: number; expense: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(monthStart(), -i).slice(0, 7);
    const cf = computeCashflow(byMonth.get(m) ?? [], categories, rates, displayCurrency);
    trend.push({
      label: new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
      income: Math.round(cf.income),
      expense: Math.round(cf.expense),
    });
  }
  const thisMonth = computeCashflow(
    byMonth.get(monthStart().slice(0, 7)) ?? [],
    categories,
    rates,
    displayCurrency,
  );

  const catById = new Map(categories.map((c) => [c.id, c]));
  const investTotal = accounts
    .filter((a) => (a.type === "investment" || a.type === "pension") && !a.hidden)
    .reduce(
      (s, a) => s + rates.convert(Number(a.current_balance ?? 0), a.currency, displayCurrency),
      0,
    );

  return (
    <div className="px-6 pt-5">
      <h1 className="mb-5 text-[19px] font-semibold">
        {greeting}, {me?.display_name ?? "there"}!
      </h1>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-4 xl:col-span-3">
          <Card>
            <div className="px-5 pt-4">
              <div className="text-[11px] font-semibold tracking-wider text-muted">
                NET WORTH
              </div>
              <div className="flex items-baseline gap-3">
                <span className="tnum text-[26px] font-semibold">
                  {fmtMoney(net, displayCurrency, { decimals: false })}
                </span>
                {series.length > 1 ? (
                  <span
                    className={`tnum text-[13px] font-medium ${netChange >= 0 ? "text-pos" : "text-neg"}`}
                  >
                    {netChange >= 0 ? "↗" : "↘"}{" "}
                    {fmtMoney(Math.abs(netChange), displayCurrency, { decimals: false })}{" "}
                    past 3 months
                  </span>
                ) : null}
              </div>
            </div>
            <div className="px-2 pb-2 pt-1">
              {series.length > 1 ? (
                <NetWorthChart data={series} currency={displayCurrency} height={200} />
              ) : (
                <EmptyState
                  title="No balance history yet"
                  sub="Add accounts and history will build up daily."
                />
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
            <div className="grid grid-cols-3 gap-2 px-5 pb-1">
              <MiniStat
                label="INCOME"
                value={fmtMoney(thisMonth.income, displayCurrency, { decimals: false })}
                tone="pos"
              />
              <MiniStat
                label="EXPENSES"
                value={fmtMoney(thisMonth.expense, displayCurrency, { decimals: false })}
              />
              <MiniStat
                label="SAVINGS RATE"
                value={thisMonth.income > 0 ? fmtPct(thisMonth.savingsRate * 100, 0) : "—"}
              />
            </div>
            <div className="px-2 pb-2">
              <TrendBars data={trend} currency={displayCurrency} height={180} />
            </div>
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
                          <div className="truncate text-[13.5px] font-medium">{t.name}</div>
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
                <AccountGroupsMini
                  accounts={accounts}
                  displayCurrency={displayCurrency}
                  ratesUsdIls={rates.usdIls()}
                />
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
                      <div className="text-[13.5px] font-medium">{r.merchant_name}</div>
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
              <div className="tnum text-[22px] font-semibold">
                {fmtMoney(investTotal, displayCurrency, { decimals: false })}
              </div>
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

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos";
}) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className={`tnum text-[17px] font-semibold ${tone === "pos" ? "text-pos" : ""}`}>
        {value}
      </div>
      <div className="text-[10.5px] font-semibold tracking-wider text-muted">{label}</div>
    </div>
  );
}

import type { Account } from "@/lib/types";

function AccountGroupsMini({
  accounts,
  displayCurrency,
  ratesUsdIls,
}: {
  accounts: Account[];
  displayCurrency: string;
  ratesUsdIls: number;
}) {
  const groups: { label: string; types: string[] }[] = [
    { label: "Cash", types: ["checking", "savings", "cash"] },
    { label: "Credit cards", types: ["credit"] },
    { label: "Investments", types: ["investment"] },
    { label: "Pensions", types: ["pension"] },
    { label: "Loans", types: ["loan"] },
    { label: "Other", types: ["property", "vehicle", "other_asset", "other_liability"] },
  ];
  function conv(v: number, from: string): number {
    if (from === displayCurrency) return v;
    if (from === "USD" && displayCurrency === "ILS") return v * ratesUsdIls;
    if (from === "ILS" && displayCurrency === "USD") return v / ratesUsdIls;
    return v;
  }
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const list = accounts.filter((a) => g.types.includes(a.type) && !a.hidden);
        if (list.length === 0) return null;
        const total = list.reduce((s, a) => {
          const v = conv(Number(a.current_balance ?? 0), a.currency);
          return s + (a.is_liability ? -Math.abs(v) : v);
        }, 0);
        return (
          <div key={g.label} className="flex items-center justify-between py-1">
            <span className="text-[13.5px] text-ink-soft">
              {g.label}
              <span className="ml-1.5 text-[12px] text-faint">{list.length}</span>
            </span>
            <span className="tnum text-[13.5px] font-medium">
              {fmtMoney(total, displayCurrency, { decimals: false })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
