import Link from "next/link";
import { getAccounts, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney } from "@/lib/format";
import { NetWorthChart, Donut } from "@/components/charts";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import type { Holding } from "@/lib/types";
import { TrendingUp } from "lucide-react";

const RANGES: Record<string, number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };
const CCY_SYMBOL: Record<string, string> = { ILS: "₪", USD: "$" };

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = "3M" } = await searchParams;
  const days = RANGES[range] ?? 91;
  const { supabase } = await getContext();
  const accounts = await getAccounts();

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

  const currencies = activeCurrencies(invAccounts);
  const totalsByCcy = sumBalancesByCurrency(invAccounts);
  const seriesByCcy = buildSeriesPerCurrency(invAccounts, snapshots ?? [], days);

  const holdingsByAccount = new Map<string, Holding[]>();
  for (const h of (holdings ?? []) as Holding[]) {
    const arr = holdingsByAccount.get(h.account_id) ?? [];
    arr.push(h);
    holdingsByAccount.set(h.account_id, arr);
  }

  return (
    <>
      <PageHeader
        title="Investments"
        right={
          <Segmented
            options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
            value={range}
            hrefBase="/investments"
            param="range"
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-2">
        <Card>
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            {currencies.length === 0 ? (
              <div className="md:col-span-2">
                <EmptyState
                  icon={<TrendingUp size={19} />}
                  title="No investment accounts yet"
                  sub="Connect Robinhood with Plaid, or add a pension that tracks itself."
                />
              </div>
            ) : (
              currencies.map((ccy) => {
                const series = seriesByCcy.get(ccy) ?? [];
                const total = totalsByCcy.get(ccy)?.net ?? 0;
                const start = series.length ? series[0].value : total;
                const change = total - start;
                const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;
                return (
                  <div key={ccy} className={currencies.length === 1 ? "md:col-span-2" : ""}>
                    <div className="px-5 pt-4">
                      <div className="text-[11px] font-semibold tracking-wider text-muted">
                        {CCY_SYMBOL[ccy] ?? ccy} PORTFOLIO
                      </div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="tnum text-[24px] font-semibold">
                          {fmtMoney(total, ccy, { decimals: false })}
                        </span>
                        {series.length > 1 ? (
                          <span
                            className={`tnum text-[12.5px] font-medium ${change >= 0 ? "text-pos" : "text-neg"}`}
                          >
                            {change >= 0 ? "↗" : "↘"}{" "}
                            {fmtMoney(Math.abs(change), ccy, { decimals: false })} (
                            {Math.abs(changePct).toFixed(1)}%) {range}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="px-2 pb-1 pt-1">
                      {series.length > 1 ? (
                        <NetWorthChart data={series} currency={ccy} height={170} />
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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
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
                    sub={a.type === "pension" ? "auto-tracked pension" : (a.institution_name ?? "")}
                    right={
                      <span className="tnum text-[14px] font-semibold">
                        {fmtMoney(balance, a.currency)}
                      </span>
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
          <div className="flex flex-col gap-4">
            {currencies.map((ccy) => {
              const list = invAccounts
                .filter((a) => a.currency === ccy)
                .map((a) => ({
                  name: a.name,
                  value: Math.round(Number(a.current_balance ?? 0)),
                }))
                .filter((x) => x.value > 0)
                .sort((a, b) => b.value - a.value);
              if (list.length === 0) return null;
              return (
                <Card key={ccy}>
                  <CardHeader title="Allocation" sub={`${CCY_SYMBOL[ccy] ?? ""} ${ccy}`} />
                  <div className="px-4 pb-4">
                    <Donut data={list} currency={ccy} height={190} />
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
