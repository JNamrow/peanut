import Link from "next/link";
import { getAccounts, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney } from "@/lib/format";
import { NetWorthChart } from "@/components/charts";
import { DualMoney } from "@/components/dual-money";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import { AddAccountButton } from "./add-account";
import type { Account } from "@/lib/types";

const RANGES: Record<string, number> = {
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
  ALL: 1825,
};

const CCY_SYMBOL: Record<string, string> = { ILS: "₪", USD: "$" };

const GROUPS: { label: string; types: Account["type"][] }[] = [
  { label: "Cash", types: ["checking", "savings", "cash"] },
  { label: "Credit Cards", types: ["credit"] },
  { label: "Investments", types: ["investment"] },
  { label: "Pensions & Study Funds", types: ["pension"] },
  { label: "Loans", types: ["loan"] },
  { label: "Property & Other", types: ["property", "vehicle", "other_asset", "other_liability"] },
];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = "3M" } = await searchParams;
  const { supabase } = await getContext();
  const accounts = await getAccounts();

  const days = RANGES[range] ?? 91;
  const since = new Date();
  since.setDate(since.getDate() - days - 5);
  const accountIds = accounts.map((a) => a.id);
  const { data: snapshots } = accountIds.length
    ? await supabase
        .from("account_balance_snapshots")
        .select("*")
        .in("account_id", accountIds)
        .gte("as_of_date", since.toISOString().slice(0, 10))
    : { data: [] };

  const currencies = activeCurrencies(accounts);
  const netByCcy = sumBalancesByCurrency(accounts);
  const seriesByCcy = buildSeriesPerCurrency(accounts, snapshots ?? [], days);

  return (
    <>
      <PageHeader
        title="Accounts"
        right={
          <>
            <Segmented
              options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
              value={range}
              hrefBase="/accounts"
              param="range"
            />
            <AddAccountButton />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
              {currencies.length === 0 ? (
                <div className="md:col-span-2">
                  <EmptyState
                    title="History builds daily"
                    sub="Balance snapshots start when accounts exist."
                  />
                </div>
              ) : (
                currencies.map((ccy) => {
                  const series = seriesByCcy.get(ccy) ?? [];
                  const net = netByCcy.get(ccy)?.net ?? 0;
                  const start = series.length ? series[0].value : net;
                  const change = net - start;
                  const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;
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
                              {fmtMoney(Math.abs(change), ccy, { decimals: false })} (
                              {Math.abs(changePct).toFixed(1)}%)
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

          {accounts.length === 0 ? (
            <Card>
              <EmptyState
                title="Add your first account"
                sub="Plaid for US banks and brokerages. RiseUp for Israeli accounts. Pensions update themselves from published track yields."
                action={<AddAccountButton primary />}
              />
            </Card>
          ) : (
            GROUPS.map((g) => {
              const list = accounts.filter((a) => g.types.includes(a.type) && !a.hidden);
              if (list.length === 0) return null;
              const byCcy = sumBalancesByCurrency(list);
              const ccys = [...byCcy.keys()];
              return (
                <Card key={g.label}>
                  <CardHeader
                    title={g.label}
                    right={
                      <DualMoney
                        size="md"
                        className="font-semibold"
                        values={activeCurrencies(list).map((c) => ({
                          currency: c,
                          value: byCcy.get(c)?.net ?? 0,
                        }))}
                      />
                    }
                  />
                  <div className="px-2 pb-2">
                    {list.map((a) => (
                      <Link
                        key={a.id}
                        href={`/accounts/${a.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active text-[12px] font-semibold text-ink-soft">
                            {(a.institution_name ?? a.name).slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[13.5px] font-medium" dir="auto">
                              {a.name}
                              {a.mask ? (
                                <span className="ml-1 text-faint">···{a.mask}</span>
                              ) : null}
                            </div>
                            <div className="text-[12px] text-muted">
                              {a.institution_name ?? a.source}
                              {a.source === "manual" ? " · manual" : ""}
                            </div>
                          </div>
                        </div>
                        {a.current_balance == null ? (
                          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
                            Set balance
                          </span>
                        ) : (
                          <span className="tnum text-[13.5px] font-medium">
                            {fmtMoney(Number(a.current_balance), a.currency)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                  {ccys.length > 1 ? null : null}
                </Card>
              );
            })
          )}
        </div>

        <div>
          <Card>
            <CardHeader title="Summary" />
            <div className="flex flex-col gap-4 px-5 pb-5">
              {currencies.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing yet.</p>
              ) : (
                currencies.map((ccy) => {
                  const t = netByCcy.get(ccy);
                  return (
                    <div key={ccy}>
                      <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted">
                        {CCY_SYMBOL[ccy] ?? ccy} {ccy}
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-[13px]">Assets</span>
                        <span className="tnum text-[13px] font-semibold">
                          {fmtMoney(t?.assets ?? 0, ccy, { decimals: false })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-[13px]">Liabilities</span>
                        <span className="tnum text-[13px] font-semibold">
                          {fmtMoney(t?.liabilities ?? 0, ccy, { decimals: false })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between border-t border-line pt-1">
                        <span className="text-[13px] font-semibold">Net</span>
                        <span className="tnum text-[13px] font-semibold">
                          {fmtMoney(t?.net ?? 0, ccy, { decimals: false })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
