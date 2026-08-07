import Link from "next/link";
import { getAccounts, getContext, sumBalances } from "@/lib/data";
import { buildNetWorthSeries } from "@/lib/networth";
import { fmtMoney } from "@/lib/format";
import { NetWorthChart } from "@/components/charts";
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
  const ctx = await getContext();
  const accounts = await getAccounts();
  const { supabase, rates, displayCurrency } = ctx;

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

  const series = buildNetWorthSeries(accounts, snapshots ?? [], rates, displayCurrency, days);
  const { assets, liabilities, net } = sumBalances(accounts, rates, displayCurrency);
  const start = series.length ? series[0].value : net;
  const change = net - start;
  const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;

  return (
    <>
      <PageHeader title="Accounts" right={<AddAccountButton />} />
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 xl:grid-cols-[1fr_330px]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between px-5 pt-4">
              <div>
                <div className="text-[11px] font-semibold tracking-wider text-muted">
                  NET WORTH
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="tnum text-[26px] font-semibold">
                    {fmtMoney(net, displayCurrency, { decimals: false })}
                  </span>
                  {series.length > 1 ? (
                    <span
                      className={`tnum text-[13px] font-medium ${change >= 0 ? "text-pos" : "text-neg"}`}
                    >
                      {change >= 0 ? "↗" : "↘"}{" "}
                      {fmtMoney(Math.abs(change), displayCurrency, { decimals: false })} (
                      {Math.abs(changePct).toFixed(1)}%)
                    </span>
                  ) : null}
                </div>
              </div>
              <Segmented
                options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
                value={range}
                hrefBase="/accounts"
                param="range"
              />
            </div>
            <div className="px-2 pb-2 pt-1">
              {series.length > 1 ? (
                <NetWorthChart data={series} currency={displayCurrency} height={220} />
              ) : (
                <EmptyState
                  title="History builds daily"
                  sub="Balance snapshots start when accounts exist."
                />
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
              const total = list.reduce((s, a) => {
                const v = rates.convert(
                  Number(a.current_balance ?? 0),
                  a.currency,
                  displayCurrency,
                );
                return s + (a.is_liability ? -Math.abs(v) : v);
              }, 0);
              return (
                <Card key={g.label}>
                  <CardHeader
                    title={g.label}
                    right={
                      <span className="tnum text-[14px] font-semibold">
                        {fmtMoney(total, displayCurrency, { decimals: false })}
                      </span>
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
                            <div className="truncate text-[13.5px] font-medium">
                              {a.name}
                              {a.mask ? (
                                <span className="ml-1 text-faint">···{a.mask}</span>
                              ) : null}
                            </div>
                            <div className="text-[12px] text-muted">
                              {a.institution_name ?? a.source}
                              {a.source !== "manual" ? "" : " · manual"}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="tnum text-[13.5px] font-medium">
                            {fmtMoney(Number(a.current_balance ?? 0), a.currency)}
                          </div>
                          {a.currency !== displayCurrency ? (
                            <div className="tnum text-[11.5px] text-faint">
                              {fmtMoney(
                                rates.convert(
                                  Number(a.current_balance ?? 0),
                                  a.currency,
                                  displayCurrency,
                                ),
                                displayCurrency,
                                { decimals: false },
                              )}
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    ))}
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <div>
          <Card>
            <CardHeader title="Summary" />
            <div className="flex flex-col gap-2 px-5 pb-5">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-semibold">Assets</span>
                <span className="tnum text-[13.5px] font-semibold">
                  {fmtMoney(assets, displayCurrency, { decimals: false })}
                </span>
              </div>
              <SummaryBar accounts={accounts} displayCurrency={displayCurrency} usdIls={rates.usdIls()} />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13.5px] font-semibold">Liabilities</span>
                <span className="tnum text-[13.5px] font-semibold">
                  {fmtMoney(liabilities, displayCurrency, { decimals: false })}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const BAR_COLORS: Record<string, string> = {
  Cash: "#1a9a5c",
  "Credit Cards": "#d94f45",
  Investments: "#63b3d9",
  "Pensions & Study Funds": "#8f7ad6",
  Loans: "#e8b93c",
  "Property & Other": "#4f8f8b",
};

function SummaryBar({
  accounts,
  displayCurrency,
  usdIls,
}: {
  accounts: Account[];
  displayCurrency: string;
  usdIls: number;
}) {
  function conv(v: number, from: string): number {
    if (from === displayCurrency) return v;
    if (from === "USD" && displayCurrency === "ILS") return v * usdIls;
    if (from === "ILS" && displayCurrency === "USD") return v / usdIls;
    return v;
  }
  const parts = GROUPS.map((g) => {
    const total = accounts
      .filter((a) => g.types.includes(a.type) && !a.hidden && !a.is_liability)
      .reduce((s, a) => s + conv(Number(a.current_balance ?? 0), a.currency), 0);
    return { label: g.label, total };
  }).filter((p) => p.total > 0);
  const sum = parts.reduce((s, p) => s + p.total, 0);
  if (sum <= 0) return null;
  return (
    <div>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <div
            key={p.label}
            style={{
              width: `${(p.total / sum) * 100}%`,
              background: BAR_COLORS[p.label] ?? "#a3a19e",
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-1.5 text-ink-soft">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: BAR_COLORS[p.label] ?? "#a3a19e" }}
              />
              {p.label}
            </span>
            <span className="tnum">
              {fmtMoney(p.total, displayCurrency, { decimals: false })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
