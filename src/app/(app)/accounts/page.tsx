import Link from "next/link";
import { fetchAll } from "@/lib/fetch-all";
import { getAccounts, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney } from "@/lib/format";
import { DualMoney } from "@/components/dual-money";
import { InstitutionLogo } from "@/components/institution-logo";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import { AddAccountButton } from "./add-account";
import { DualChart } from "./dual-chart";
import { BalanceChip } from "./balance-chip";
import type { Account } from "@/lib/types";

/** A single snapshot still deserves a line: pad it flat across the range. */
function padSeries(
  series: { date: string; value: number }[],
  days: number,
): { date: string; value: number }[] {
  if (series.length !== 1) return series;
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startStr = start.toISOString().slice(0, 10);
  const p = series[0];
  if (p.date <= startStr) {
    return [p, { date: new Date().toISOString().slice(0, 10), value: p.value }];
  }
  return [{ date: startStr, value: p.value }, p];
}

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

const BAR_COLORS: Record<string, string> = {
  Cash: "#1a9a5c",
  "Credit Cards": "#d94f45",
  Investments: "#63b3d9",
  "Pensions & Study Funds": "#8f7ad6",
  Loans: "#e8b93c",
  "Property & Other": "#4f8f8b",
};

const ACRONYMS = new Set(["ira", "hsa", "cd", "esa", "gic", "401k", "403b", "457b", "529"]);

/** "roth ira" -> "Roth IRA", fallback to the account type. */
function subtypeLabel(a: Pick<Account, "subtype" | "type">): string {
  return (a.subtype ?? a.type)
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

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
    ? await fetchAll((from, to) =>
        supabase
          .from("account_balance_snapshots")
          .select("*")
          .in("account_id", accountIds)
          .gte("as_of_date", since.toISOString().slice(0, 10))
          .order("as_of_date")
          .order("account_id")
          .range(from, to),
      )
    : { data: [] };

  const currencies = activeCurrencies(accounts);
  const netByCcy = sumBalancesByCurrency(accounts);
  const seriesByCcy = buildSeriesPerCurrency(accounts, snapshots ?? [], days);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const ilsSeries = padSeries(seriesByCcy.get("ILS") ?? [], days);
  const usdSeries = padSeries(seriesByCcy.get("USD") ?? [], days);
  const hasChart = ilsSeries.length > 1 || usdSeries.length > 1;

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
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <Card>
            {currencies.length === 0 ? (
              <EmptyState
                title="History builds daily"
                sub="Balance snapshots start when accounts exist."
              />
            ) : (
              <>
                <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
                  {currencies.map((ccy) => {
                    const series = seriesByCcy.get(ccy) ?? [];
                    const net = netByCcy.get(ccy)?.net ?? 0;
                    const start = series.length ? series[0].value : net;
                    const change = net - start;
                    const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;
                    return (
                      <div
                        key={ccy}
                        className={currencies.length === 1 ? "md:col-span-2" : ""}
                      >
                        <div className="px-5 pb-3 pt-4">
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
                      </div>
                    );
                  })}
                </div>
                <div className="px-2 pb-1 pt-1">
                  {hasChart ? (
                    <DualChart ils={ilsSeries} usd={usdSeries} height={230} />
                  ) : (
                    <p className="px-3 pb-3 text-[12.5px] text-muted">
                      History starts today.
                    </p>
                  )}
                </div>
              </>
            )}
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
                    {list.map((a) => {
                      const paysFrom =
                        a.type === "credit" && a.linked_account_id
                          ? accountById.get(a.linked_account_id)
                          : null;
                      const linkedCards =
                        a.type === "checking" || a.type === "savings"
                          ? accounts.filter(
                              (c) => c.linked_account_id === a.id && !c.hidden,
                            )
                          : [];
                      return (
                        <Link
                          key={a.id}
                          href={`/accounts/${a.id}`}
                          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <InstitutionLogo
                              institution={a.institution_name}
                              fallback={a.name}
                              size={32}
                            />
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="truncate text-[13.5px] font-medium"
                                  dir="auto"
                                >
                                  {a.name}
                                  {a.mask ? (
                                    <span className="ml-1 text-faint">···{a.mask}</span>
                                  ) : null}
                                </span>
                                {linkedCards.length > 0 ? (
                                  <span className="flex shrink-0 items-center">
                                    {linkedCards.slice(0, 4).map((c) => (
                                      <span
                                        key={c.id}
                                        className="-ml-2 first:ml-0"
                                        title={`${c.name} — ${fmtMoney(Number(c.current_balance ?? 0), c.currency)}`}
                                      >
                                        <InstitutionLogo
                                          institution={c.institution_name}
                                          fallback={c.name}
                                          size={22}
                                          className="rounded-full ring-2 ring-card"
                                        />
                                      </span>
                                    ))}
                                    {linkedCards.length > 4 ? (
                                      <span className="-ml-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-active text-[10px] font-semibold text-ink-soft ring-2 ring-card">
                                        +{linkedCards.length - 4}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </div>
                              <div className="truncate text-[12px] text-muted" dir="auto">
                                {subtypeLabel(a)}
                                {a.institution_name ? ` · ${a.institution_name}` : ""}
                                {paysFrom ? ` · pays from ${paysFrom.name}` : ""}
                              </div>
                            </div>
                          </div>
                          <BalanceChip
                            accountId={a.id}
                            balance={
                              a.current_balance == null
                                ? null
                                : Number(a.current_balance)
                            }
                            currency={a.currency}
                            type={a.type}
                            anchorDate={a.balance_anchor_date}
                          />
                        </Link>
                      );
                    })}
                  </div>
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
                  const parts = GROUPS.map((g) => {
                    const total = accounts
                      .filter(
                        (a) =>
                          g.types.includes(a.type) &&
                          !a.hidden &&
                          !a.is_liability &&
                          a.currency === ccy &&
                          a.include_in_net_worth &&
                          a.current_balance != null,
                      )
                      .reduce((s, a) => s + Number(a.current_balance), 0);
                    return { label: g.label, total };
                  }).filter((p) => p.total > 0);
                  const partSum = parts.reduce((s, p) => s + p.total, 0);
                  return (
                    <div key={ccy}>
                      <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted">
                        {CCY_SYMBOL[ccy] ?? ccy} {ccy}
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-[13px] font-semibold">Assets</span>
                        <span className="tnum text-[13px] font-semibold">
                          {fmtMoney(t?.assets ?? 0, ccy, { decimals: false })}
                        </span>
                      </div>
                      {partSum > 0 ? (
                        <>
                          <div className="my-1.5 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
                            {parts.map((p) => (
                              <div
                                key={p.label}
                                style={{
                                  width: `${(p.total / partSum) * 100}%`,
                                  background: BAR_COLORS[p.label] ?? "#a3a19e",
                                }}
                              />
                            ))}
                          </div>
                          {parts.map((p) => (
                            <div
                              key={p.label}
                              className="flex items-center justify-between py-0.5 text-[12.5px]"
                            >
                              <span className="flex items-center gap-1.5 text-ink-soft">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: BAR_COLORS[p.label] ?? "#a3a19e" }}
                                />
                                {p.label}
                              </span>
                              <span className="tnum">
                                {fmtMoney(p.total, ccy, { decimals: false })}
                              </span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      <div className="mt-1.5 flex items-center justify-between py-0.5">
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
