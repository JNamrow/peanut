import Link from "next/link";
import { getAccounts, getContext } from "@/lib/data";
import { buildNetWorthSeries } from "@/lib/networth";
import { fmtMoney } from "@/lib/format";
import { NetWorthChart, Donut } from "@/components/charts";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import type { Holding } from "@/lib/types";
import { TrendingUp } from "lucide-react";

const RANGES: Record<string, number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = "3M" } = await searchParams;
  const days = RANGES[range] ?? 91;
  const ctx = await getContext();
  const accounts = await getAccounts();
  const { supabase, rates, displayCurrency } = ctx;

  const invAccounts = accounts.filter(
    (a) => (a.type === "investment" || a.type === "pension") && !a.hidden,
  );
  const ids = invAccounts.map((a) => a.id);

  const since = new Date();
  since.setDate(since.getDate() - days - 5);
  const [{ data: snapshots }, { data: holdings }] = await Promise.all([
    ids.length
      ? supabase
          .from("account_balance_snapshots")
          .select("*")
          .in("account_id", ids)
          .gte("as_of_date", since.toISOString().slice(0, 10))
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("holdings").select("*").in("account_id", ids)
      : Promise.resolve({ data: [] }),
  ]);

  const series = buildNetWorthSeries(
    invAccounts,
    snapshots ?? [],
    rates,
    displayCurrency,
    days,
  );
  const total = invAccounts.reduce(
    (s, a) => s + rates.convert(Number(a.current_balance ?? 0), a.currency, displayCurrency),
    0,
  );
  const start = series.length ? series[0].value : total;
  const change = total - start;
  const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;

  const allocation = invAccounts
    .map((a) => ({
      name: a.name,
      value: Math.round(
        rates.convert(Number(a.current_balance ?? 0), a.currency, displayCurrency),
      ),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const holdingsByAccount = new Map<string, Holding[]>();
  for (const h of (holdings ?? []) as Holding[]) {
    const arr = holdingsByAccount.get(h.account_id) ?? [];
    arr.push(h);
    holdingsByAccount.set(h.account_id, arr);
  }

  return (
    <>
      <PageHeader title="Investments" />
      <div className="flex flex-col gap-4 px-6 pt-2">
        <Card>
          <div className="flex items-start justify-between px-5 pt-4">
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-muted">
                PORTFOLIO VALUE
              </div>
              <div className="flex items-baseline gap-3">
                <span className="tnum text-[26px] font-semibold">
                  {fmtMoney(total, displayCurrency, { decimals: false })}
                </span>
                {series.length > 1 ? (
                  <span
                    className={`tnum text-[13px] font-medium ${change >= 0 ? "text-pos" : "text-neg"}`}
                  >
                    {change >= 0 ? "↗" : "↘"}{" "}
                    {fmtMoney(Math.abs(change), displayCurrency, { decimals: false })} (
                    {Math.abs(changePct).toFixed(1)}%) {range}
                  </span>
                ) : null}
              </div>
            </div>
            <Segmented
              options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
              value={range}
              hrefBase="/investments"
              param="range"
            />
          </div>
          <div className="px-2 pb-2 pt-1">
            {series.length > 1 ? (
              <NetWorthChart data={series} currency={displayCurrency} height={210} />
            ) : (
              <EmptyState
                icon={<TrendingUp size={19} />}
                title="No investment accounts yet"
                sub="Connect Robinhood with Plaid, or add a pension that tracks itself."
              />
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_330px]">
          <div className="flex flex-col gap-4">
            {invAccounts.map((a) => {
              const accHoldings = holdingsByAccount.get(a.id) ?? [];
              const balance = Number(a.current_balance ?? 0);
              return (
                <Card key={a.id}>
                  <CardHeader
                    title={
                      <Link href={`/accounts/${a.id}`} className="hover:text-accent">
                        {a.name}
                      </Link>
                    }
                    sub={a.type === "pension" ? "auto-tracked pension" : a.institution_name ?? ""}
                    right={
                      <div className="text-right">
                        <div className="tnum text-[14px] font-semibold">
                          {fmtMoney(balance, a.currency)}
                        </div>
                        {a.currency !== displayCurrency ? (
                          <div className="tnum text-[11.5px] text-faint">
                            {fmtMoney(
                              rates.convert(balance, a.currency, displayCurrency),
                              displayCurrency,
                              { decimals: false },
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  {accHoldings.length > 0 ? (
                    <div className="px-5 pb-3">
                      <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                        <span>Security</span>
                        <span className="text-right">Price</span>
                        <span className="text-right">Quantity</span>
                        <span className="text-right">Value</span>
                      </div>
                      {accHoldings
                        .sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0))
                        .map((h) => (
                          <div
                            key={h.id}
                            className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                          >
                            <span className="truncate">
                              <span className="font-medium">{h.symbol ?? "—"}</span>
                              <span className="ml-1.5 text-muted">{h.name}</span>
                            </span>
                            <span className="tnum text-right">
                              {h.price != null ? fmtMoney(Number(h.price), h.currency) : "—"}
                            </span>
                            <span className="tnum text-right">
                              {h.quantity != null ? Number(h.quantity).toLocaleString() : "—"}
                            </span>
                            <span className="tnum text-right font-medium">
                              {h.value != null ? fmtMoney(Number(h.value), h.currency) : "—"}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
          <div>
            <Card>
              <CardHeader title="Allocation" sub="by account" />
              <div className="px-4 pb-4">
                {allocation.length > 0 ? (
                  <Donut data={allocation} currency={displayCurrency} height={210} />
                ) : (
                  <p className="py-6 text-center text-[13px] text-muted">Nothing yet.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
