import Link from "next/link";
import { getAccounts, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Donut, DONUT_COLORS } from "@/components/charts";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import {
  BENCHMARKS,
  getBenchmarkCloses,
  isBenchmarkKey,
  type BenchmarkKey,
} from "@/lib/benchmarks";
import { fetchYields } from "@/lib/sync/pensions";
import { PerfChart, type PerfSeries } from "./perf-chart";
import type { Account, Holding, PensionConfig } from "@/lib/types";
import { TrendingUp } from "lucide-react";

const RANGES: Record<string, number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };
const CCY_SYMBOL: Record<string, string> = { ILS: "₪", USD: "$" };
const PORTFOLIO_COLOR = "#ee6a3c";

const TABS = [
  { value: "holdings", label: "Holdings" },
  { value: "allocation", label: "Allocation" },
  { value: "gains", label: "Gains & Losses" },
  { value: "funds", label: "Funds" },
] as const;
type Tab = (typeof TABS)[number]["value"];

type YieldRows = Awaited<ReturnType<typeof fetchYields>>;

function periodLabel(period: number): string {
  return `${Math.floor(period / 100)}-${String(period % 100).padStart(2, "0")}`;
}

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; bench?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = TABS.some((t) => t.value === params.tab)
    ? (params.tab as Tab)
    : "holdings";
  const range = RANGES[params.range ?? ""] ? params.range! : "3M";
  const days = RANGES[range];
  const bench: BenchmarkKey = isBenchmarkKey(params.bench) ? params.bench : "spy";

  const { supabase } = await getContext();
  const accounts = await getAccounts();
  const invAccounts = accounts.filter(
    (a) => (a.type === "investment" || a.type === "pension") && !a.hidden,
  );
  const ids = invAccounts.map((a) => a.id);
  const pensionIds = invAccounts
    .filter((a) => a.type === "pension")
    .map((a) => a.id);

  const since = new Date();
  since.setDate(since.getDate() - days - 5);
  const [{ data: snapshots }, { data: holdingRows }, { data: cfgRows }] =
    await Promise.all([
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
      pensionIds.length
        ? supabase.from("pension_configs").select("*").in("account_id", pensionIds)
        : Promise.resolve({ data: [] }),
    ]);

  const holdings = (holdingRows ?? []) as Holding[];
  const pensionCfgs = ((cfgRows ?? []) as PensionConfig[]).filter((c) =>
    pensionIds.includes(c.account_id),
  );
  const cfgByAccount = new Map(pensionCfgs.map((c) => [c.account_id, c]));

  const currencies = activeCurrencies(invAccounts);
  const totalsByCcy = sumBalancesByCurrency(invAccounts);
  const seriesByCcy = buildSeriesPerCurrency(invAccounts, snapshots ?? [], days);

  const holdingsByAccount = new Map<string, Holding[]>();
  for (const h of holdings) {
    const arr = holdingsByAccount.get(h.account_id) ?? [];
    arr.push(h);
    holdingsByAccount.set(h.account_id, arr);
  }

  // USD benchmark overlay (holdings tab only). ILS has no benchmark.
  let benchSeries: PerfSeries | null = null;
  if (tab === "holdings") {
    const usd = seriesByCcy.get("USD") ?? [];
    if (usd.length > 1) {
      const closes = await getBenchmarkCloses(bench, usd[0].date);
      const inRange = closes.filter((c) => c.date <= usd[usd.length - 1].date);
      if (inRange.length > 1 && inRange[0].close > 0) {
        const base = inRange[0].close;
        benchSeries = {
          name: BENCHMARKS[bench].label,
          color: BENCHMARKS[bench].color,
          points: inRange.map((c) => ({
            date: c.date,
            pct: ((c.close - base) / base) * 100,
          })),
        };
      }
    }
  }

  // Published pension yields (funds tab only). Failure -> rows: null.
  let fundCards: { account: Account; cfg: PensionConfig; rows: YieldRows | null }[] =
    [];
  if (tab === "funds") {
    fundCards = await Promise.all(
      pensionCfgs.map(async (cfg) => {
        const account = invAccounts.find((a) => a.id === cfg.account_id)!;
        try {
          return { account, cfg, rows: await fetchYields(cfg.dataset, Number(cfg.fund_id)) };
        } catch {
          return { account, cfg, rows: null };
        }
      }),
    );
  }

  const qs = (t: string) => `/investments?tab=${t}&range=${range}&bench=${bench}`;
  const header = (
    <PageHeader
      title="Investments"
      tabs={
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <a
              key={t.value}
              href={qs(t.value)}
              className={`rounded-lg px-2.5 py-1 text-[13.5px] font-medium ${
                tab === t.value
                  ? "text-accent underline decoration-2 underline-offset-8"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </a>
          ))}
        </div>
      }
      right={
        tab === "holdings" ? (
          <>
            {currencies.includes("USD") ? (
              <Segmented
                options={(Object.keys(BENCHMARKS) as BenchmarkKey[]).map((k) => ({
                  value: k,
                  label: BENCHMARKS[k].label,
                }))}
                value={bench}
                hrefBase={`/investments?tab=holdings&range=${range}`}
                param="bench"
              />
            ) : null}
            <Segmented
              options={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
              value={range}
              hrefBase={`/investments?tab=holdings&bench=${bench}`}
              param="range"
            />
          </>
        ) : null
      }
    />
  );

  if (invAccounts.length === 0) {
    return (
      <>
        {header}
        <div className="px-6 pt-2">
          <Card>
            <EmptyState
              icon={<TrendingUp size={19} />}
              title="No investment accounts yet"
              sub="Connect Robinhood with Plaid, or add a pension that tracks itself."
            />
          </Card>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------- Holdings
  if (tab === "holdings") {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-6 pt-2">
          {currencies.map((ccy) => {
            const series = seriesByCcy.get(ccy) ?? [];
            const total = totalsByCcy.get(ccy)?.net ?? 0;
            const start = series.length ? series[0].value : total;
            const change = total - start;
            const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : 0;

            const perf: PerfSeries[] = [];
            if (series.length > 1 && series[0].value !== 0) {
              const base = series[0].value;
              perf.push({
                name: `${CCY_SYMBOL[ccy] ?? ccy} portfolio`,
                color: PORTFOLIO_COLOR,
                points: series.map((p) => ({
                  date: p.date,
                  pct: ((p.value - base) / Math.abs(base)) * 100,
                })),
              });
              if (ccy === "USD" && benchSeries) perf.push(benchSeries);
            }
            const ccyAccounts = invAccounts.filter((a) => a.currency === ccy);

            return (
              <section key={ccy} className="flex flex-col gap-4">
                <Card>
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
                  <div className="px-2 pb-2 pt-1">
                    {perf.length > 0 ? (
                      <PerfChart series={perf} height={220} />
                    ) : (
                      <p className="px-3 pb-3 text-[12.5px] text-muted">
                        History starts today.
                      </p>
                    )}
                  </div>
                </Card>
                {ccyAccounts.map((a) => (
                  <AccountHoldingsCard
                    key={a.id}
                    account={a}
                    holdings={holdingsByAccount.get(a.id) ?? []}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </>
    );
  }

  // -------------------------------------------------------- Allocation
  if (tab === "allocation") {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-6 pt-2">
          {currencies.map((ccy) => {
            const list = invAccounts
              .filter((a) => a.currency === ccy)
              .map((a) => ({
                name: a.name,
                value: Math.round(Number(a.current_balance ?? 0)),
                type: a.type,
              }))
              .filter((x) => x.value > 0)
              .sort((a, b) => b.value - a.value);
            if (list.length === 0) return null;
            const total = list.reduce((s, x) => s + x.value, 0);
            const invTotal = list
              .filter((x) => x.type === "investment")
              .reduce((s, x) => s + x.value, 0);
            const penTotal = total - invTotal;
            return (
              <Card key={ccy}>
                <CardHeader
                  title="Allocation"
                  sub={`${CCY_SYMBOL[ccy] ?? ""} ${ccy}`}
                />
                <div className="grid grid-cols-1 items-center gap-6 px-5 pb-5 md:grid-cols-[240px_minmax(0,1fr)]">
                  <Donut
                    data={list.map(({ name, value }) => ({ name, value }))}
                    currency={ccy}
                    height={200}
                  />
                  <div>
                    <div className="flex flex-col gap-1">
                      {list.map((x, i) => (
                        <div key={x.name + i} className="flex items-center gap-3 py-0.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              background: DONUT_COLORS[i % DONUT_COLORS.length],
                            }}
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-[13px] font-medium"
                            dir="auto"
                          >
                            {x.name}
                          </span>
                          <span className="tnum text-[13px]">
                            {fmtMoney(x.value, ccy, { decimals: false })}
                          </span>
                          <span className="tnum w-10 text-right text-[12px] text-muted">
                            {Math.round((x.value / total) * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5">
                      <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted">
                        BY TYPE
                      </div>
                      <div className="flex h-3 overflow-hidden rounded-full bg-active">
                        {invTotal > 0 ? (
                          <div
                            className="h-full bg-chart-1"
                            style={{ width: `${(invTotal / total) * 100}%` }}
                          />
                        ) : null}
                        {penTotal > 0 ? (
                          <div
                            className="h-full bg-chart-4"
                            style={{ width: `${(penTotal / total) * 100}%` }}
                          />
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                        {invTotal > 0 ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-chart-1" />
                            <span className="text-ink-soft">Investment</span>
                            <span className="tnum font-medium">
                              {fmtMoney(invTotal, ccy, { decimals: false })}
                            </span>
                            <span className="tnum text-muted">
                              {Math.round((invTotal / total) * 100)}%
                            </span>
                          </span>
                        ) : null}
                        {penTotal > 0 ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-chart-4" />
                            <span className="text-ink-soft">Pension</span>
                            <span className="tnum font-medium">
                              {fmtMoney(penTotal, ccy, { decimals: false })}
                            </span>
                            <span className="tnum text-muted">
                              {Math.round((penTotal / total) * 100)}%
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </>
    );
  }

  // ---------------------------------------------------- Gains & Losses
  if (tab === "gains") {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-6 pt-2">
          {currencies.map((ccy) => {
            const total = totalsByCcy.get(ccy)?.net ?? 0;
            const ccyHoldings = holdings
              .filter((h) => h.currency === ccy)
              .sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0));
            const withCb = ccyHoldings.filter(
              (h) => h.cost_basis != null && h.value != null,
            );
            const costBasis = withCb.reduce((s, h) => s + Number(h.cost_basis), 0);
            const curValue = withCb.reduce((s, h) => s + Number(h.value), 0);
            const gain = curValue - costBasis;
            const gainPct = costBasis > 0 ? (gain / costBasis) * 100 : 0;
            const pensions = invAccounts.filter(
              (a) => a.currency === ccy && a.type === "pension",
            );

            return (
              <section key={ccy} className="flex flex-col gap-4">
                <div>
                  <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted">
                    {CCY_SYMBOL[ccy] ?? ccy} {ccy}
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard
                      label="PORTFOLIO VALUE"
                      value={fmtMoney(total, ccy, { decimals: false })}
                    />
                    <StatCard
                      label="COST BASIS"
                      value={
                        withCb.length > 0
                          ? fmtMoney(costBasis, ccy, { decimals: false })
                          : "—"
                      }
                    />
                    <StatCard
                      label="GAIN / LOSS"
                      value={
                        withCb.length > 0
                          ? fmtMoney(gain, ccy, { sign: true, decimals: false })
                          : "—"
                      }
                      tone={withCb.length > 0 ? (gain >= 0 ? "pos" : "neg") : undefined}
                    />
                    <StatCard
                      label="GAIN / LOSS %"
                      value={withCb.length > 0 ? fmtPct(gainPct, 1) : "—"}
                      tone={withCb.length > 0 ? (gain >= 0 ? "pos" : "neg") : undefined}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted">
                    Partial — based on holdings with a cost basis
                    {withCb.length < ccyHoldings.length
                      ? ` (${withCb.length} of ${ccyHoldings.length})`
                      : ""}
                    .
                  </p>
                </div>

                {ccyHoldings.length > 0 ? (
                  <Card>
                    <CardHeader title="Holdings" sub={ccy} />
                    <div className="px-5 pb-4">
                      <div className="grid grid-cols-[minmax(0,1fr)_80px_110px_110px_150px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                        <span>Security</span>
                        <span className="text-right">Quantity</span>
                        <span className="text-right">Cost basis</span>
                        <span className="text-right">Value</span>
                        <span className="text-right">Gain / loss</span>
                      </div>
                      {ccyHoldings.map((h) => {
                        const hasCb = h.cost_basis != null && h.value != null;
                        const hGain = hasCb
                          ? Number(h.value) - Number(h.cost_basis)
                          : 0;
                        const hPct =
                          hasCb && Number(h.cost_basis) > 0
                            ? (hGain / Number(h.cost_basis)) * 100
                            : 0;
                        return (
                          <div
                            key={h.id}
                            className="grid grid-cols-[minmax(0,1fr)_80px_110px_110px_150px] items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                          >
                            <span className="truncate" dir="auto">
                              <span className="font-medium">{h.symbol ?? "—"}</span>
                              <span className="ml-1.5 text-muted">{h.name}</span>
                            </span>
                            <span className="tnum text-right">
                              {h.quantity != null
                                ? Number(h.quantity).toLocaleString()
                                : "—"}
                            </span>
                            <span className="tnum text-right">
                              {h.cost_basis != null
                                ? fmtMoney(Number(h.cost_basis), h.currency)
                                : "—"}
                            </span>
                            <span className="tnum text-right font-medium">
                              {h.value != null
                                ? fmtMoney(Number(h.value), h.currency)
                                : "—"}
                            </span>
                            <span className="text-right">
                              {hasCb ? (
                                <GainPill gain={hGain} pct={hPct} currency={h.currency} />
                              ) : (
                                <span className="text-[12.5px] text-faint">no basis</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ) : null}

                {pensions.length > 0 ? (
                  <Card>
                    <CardHeader
                      title="Pensions"
                      sub="gain since anchor — includes contributions"
                    />
                    <div className="px-5 pb-4">
                      <div className="grid grid-cols-[minmax(0,1fr)_110px_130px_130px_150px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                        <span>Account</span>
                        <span className="text-right">Anchor date</span>
                        <span className="text-right">Anchor balance</span>
                        <span className="text-right">Current</span>
                        <span className="text-right">Gain since anchor</span>
                      </div>
                      {pensions.map((a) => {
                        const cfg = cfgByAccount.get(a.id);
                        const anchor =
                          cfg?.anchor_balance != null ? Number(cfg.anchor_balance) : null;
                        const cur = Number(a.current_balance ?? 0);
                        const pGain = anchor != null ? cur - anchor : null;
                        const pPct =
                          anchor != null && anchor > 0 && pGain != null
                            ? (pGain / anchor) * 100
                            : 0;
                        return (
                          <div
                            key={a.id}
                            className="grid grid-cols-[minmax(0,1fr)_110px_130px_130px_150px] items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                          >
                            <span className="truncate font-medium" dir="auto">
                              {a.name}
                            </span>
                            <span className="tnum text-right text-muted">
                              {cfg?.anchor_date ?? "—"}
                            </span>
                            <span className="tnum text-right">
                              {anchor != null ? fmtMoney(anchor, a.currency) : "—"}
                            </span>
                            <span className="tnum text-right font-medium">
                              {fmtMoney(cur, a.currency)}
                            </span>
                            <span className="text-right">
                              {pGain != null ? (
                                <GainPill gain={pGain} pct={pPct} currency={a.currency} />
                              ) : (
                                <span className="text-[12.5px] text-faint">no anchor</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ) : null}
              </section>
            );
          })}
        </div>
      </>
    );
  }

  // -------------------------------------------------------------- Funds
  return (
    <>
      {header}
      <div className="px-6 pt-2">
        {fundCards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<TrendingUp size={19} />}
              title="No pension funds configured"
              sub="Add a pension account with a fund number to track its published yields here."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {fundCards.map(({ account, cfg, rows }) => {
              const last12 = (rows ?? []).slice(0, 12);
              const year = new Date().getFullYear();
              const ytd = (rows ?? [])
                .filter((r) => Math.floor(Number(r.REPORT_PERIOD) / 100) === year)
                .reduce((s, r) => s + Number(r.MONTHLY_YIELD), 0);
              return (
                <Card key={account.id}>
                  <CardHeader
                    title={
                      <Link
                        href={`/accounts/${account.id}`}
                        className="hover:text-accent"
                        dir="auto"
                      >
                        {account.name}
                      </Link>
                    }
                    sub={`${cfg.dataset} · fund ${cfg.fund_id}`}
                  />
                  <div className="px-5 pb-4">
                    {rows === null ? (
                      <p className="py-6 text-center text-[13px] text-muted">
                        Couldn&apos;t reach data.gov.il — published yields are
                        unavailable right now. Try again later.
                      </p>
                    ) : last12.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-muted">
                        No published yields found for fund {cfg.fund_id}.
                      </p>
                    ) : (
                      <>
                        {last12[0].FUND_NAME ? (
                          <p
                            className="mb-2 truncate text-[12.5px] text-ink-soft"
                            dir="auto"
                          >
                            {last12[0].FUND_NAME}
                          </p>
                        ) : null}
                        <div className="grid grid-cols-[1fr_120px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                          <span>Period</span>
                          <span className="text-right">Monthly yield</span>
                        </div>
                        {last12.map((r) => {
                          const y = Number(r.MONTHLY_YIELD);
                          return (
                            <div
                              key={r.REPORT_PERIOD}
                              className="grid grid-cols-[1fr_120px] gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                            >
                              <span className="tnum">
                                {periodLabel(Number(r.REPORT_PERIOD))}
                              </span>
                              <span
                                className={`tnum text-right font-medium ${y >= 0 ? "text-pos" : "text-neg"}`}
                              >
                                {y >= 0 ? "+" : ""}
                                {fmtPct(y, 2)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[13px]">
                          <span className="font-medium">{year} YTD</span>
                          <span
                            className={`tnum font-semibold ${ytd >= 0 ? "text-pos" : "text-neg"}`}
                          >
                            {ytd >= 0 ? "+" : ""}
                            {fmtPct(ytd, 2)}
                          </span>
                        </div>
                        <p className="mt-2 text-[12px] text-muted">
                          Published yields lag by about 5 weeks; gross of your
                          personal management fee.
                        </p>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// -------------------------------------------------------- local pieces

function AccountHoldingsCard({
  account,
  holdings,
}: {
  account: Account;
  holdings: Holding[];
}) {
  const balance = Number(account.current_balance ?? 0);
  return (
    <Card>
      <CardHeader
        title={
          <Link href={`/accounts/${account.id}`} className="hover:text-accent" dir="auto">
            {account.name}
          </Link>
        }
        sub={
          account.type === "pension"
            ? "auto-tracked pension"
            : (account.institution_name ?? "")
        }
        right={
          <span className="tnum text-[14px] font-semibold">
            {fmtMoney(balance, account.currency)}
          </span>
        }
      />
      {holdings.length > 0 ? (
        <div className="px-5 pb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
            <span>Security</span>
            <span className="text-right">Price</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Value</span>
          </div>
          {holdings
            .slice()
            .sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0))
            .map((h) => (
              <div
                key={h.id}
                className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
              >
                <span className="truncate" dir="auto">
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
}

function StatCard({
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

function GainPill({
  gain,
  pct,
  currency,
}: {
  gain: number;
  pct: number;
  currency: string;
}) {
  const pos = gain >= 0;
  return (
    <span
      className={`tnum inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${
        pos ? "bg-pos-soft text-pos" : "bg-neg-soft text-neg"
      }`}
    >
      {fmtMoney(gain, currency, { sign: true, decimals: false })}
      <span className="ml-1 opacity-80">({fmtPct(pct, 1)})</span>
    </span>
  );
}
