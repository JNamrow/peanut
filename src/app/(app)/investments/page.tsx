import Link from "next/link";
import { fetchAll } from "@/lib/fetch-all";
import type { ReactNode } from "react";
import { Info, TrendingUp } from "lucide-react";
import { getAccounts, getContext } from "@/lib/data";
import {
  activeCurrencies,
  buildSeriesPerCurrency,
  sumBalancesByCurrency,
} from "@/lib/multicurrency";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Donut, DONUT_COLORS } from "@/components/charts";
import { InstitutionLogo } from "@/components/institution-logo";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
} from "@/components/ui";
import {
  BENCHMARKS,
  backtestHoldings,
  getBenchmarkCloses,
  isBenchmarkKey,
  type BenchmarkKey,
} from "@/lib/benchmarks";
import { fetchYields } from "@/lib/sync/pensions";
import { AllocBar, type AllocSegment } from "./alloc-bar";
import { PerfChart, type PerfSeries } from "./perf-chart";
import type { Account, Holding, PensionConfig } from "@/lib/types";

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

// Monarch's asset-class band order + palette (green/blue/purple/orange/pink).
const ALLOC_CLASSES = [
  "Brokerage",
  "Retirement",
  "Crypto",
  "Pensions & Study Funds",
] as const;
const ALLOC_COLORS = ["#1a9a5c", "#4a6cd4", "#8b4fd4", "#e8763c", "#d96aa8"];

type YieldRows = Awaited<ReturnType<typeof fetchYields>>;

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

function periodLabel(period: number): string {
  return `${Math.floor(period / 100)}-${String(period % 100).padStart(2, "0")}`;
}

/** No securities-level data yet — classes come from the account itself. */
function allocClass(a: Account): (typeof ALLOC_CLASSES)[number] {
  if (a.type === "pension") return "Pensions & Study Funds";
  const sub = (a.subtype ?? "").toLowerCase();
  if (sub.includes("crypto")) return "Crypto";
  if (sub.includes("ira") || sub.includes("roth") || sub.includes("401"))
    return "Retirement";
  return "Brokerage";
}

function subtypeLabel(a: Account): string {
  const raw = a.subtype ?? (a.type === "pension" ? "pension" : "investment");
  const cleaned = raw.replace(/[-_]/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
        ? fetchAll((from, to) =>
            supabase
              .from("account_balance_snapshots")
              .select("*")
              .in("account_id", ids)
              .gte("as_of_date", since.toISOString().slice(0, 10))
              .order("as_of_date")
              .order("account_id")
              .range(from, to),
          )
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

  // Monarch-style backtest: price TODAY's holdings backwards with market
  // history (their "Backtested performance"). USD symbols only.
  let backtested: { date: string; pct: number }[] | null = null;
  const usdSymbolHoldings = holdings
    .filter(
      (h) => h.symbol && Number(h.quantity) > 0 && (h.currency ?? "USD") === "USD",
    )
    .map((h) => ({ symbol: h.symbol as string, quantity: Number(h.quantity) }));
  if (tab === "holdings" && usdSymbolHoldings.length > 0) {
    const bt = await backtestHoldings(
      usdSymbolHoldings,
      since.toISOString().slice(0, 10),
    );
    if (bt && bt.length > 1) backtested = bt;
  }

  // Benchmark % over the SELECTED RANGE (not the portfolio window), so the
  // chart is useful even on day one of portfolio history. USD only.
  const benchStats: { key: BenchmarkKey; label: string; pct: number }[] = [];
  let benchSeries: PerfSeries | null = null;
  if (tab === "holdings" && currencies.includes("USD")) {
    {
      const startDate = since.toISOString().slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const keys = Object.keys(BENCHMARKS) as BenchmarkKey[];
      const allCloses = await Promise.all(
        keys.map((k) => getBenchmarkCloses(k, startDate)),
      );
      keys.forEach((k, i) => {
        const inRange = allCloses[i].filter((c) => c.date <= endDate);
        if (inRange.length < 2 || inRange[0].close <= 0) return;
        const base = inRange[0].close;
        benchStats.push({
          key: k,
          label: BENCHMARKS[k].label,
          pct: ((inRange[inRange.length - 1].close - base) / base) * 100,
        });
        if (k === bench) {
          benchSeries = {
            name: BENCHMARKS[k].label,
            color: BENCHMARKS[k].color,
            points: inRange.map((c) => ({
              date: c.date,
              pct: ((c.close - base) / base) * 100,
            })),
          };
        }
      });
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
          return {
            account,
            cfg,
            rows: await fetchYields(cfg.dataset, Number(cfg.fund_id), 14),
          };
        } catch {
          return { account, cfg, rows: null };
        }
      }),
    );
  }

  const qs = (t: string) => `/investments?tab=${t}&range=${range}&bench=${bench}`;
  const header = (
    <>
      <PageHeader
        title="Investments"
        right={
          <>
            {tab === "holdings" && currencies.includes("USD") ? (
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
              hrefBase={`/investments?tab=${tab}&bench=${bench}`}
              param="range"
            />
          </>
        }
      />
      <div className="flex items-center gap-1 px-6 pb-1">
        {TABS.map((t) => (
          <a
            key={t.value}
            href={qs(t.value)}
            className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${
              tab === t.value
                ? "bg-active text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>
    </>
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
            const rawSeries = seriesByCcy.get(ccy) ?? [];
            // One snapshot day still gets a chart: pad it flat across the range.
            const series = padSeries(rawSeries, days);
            const backtest = ccy === "USD" ? backtested : null;
            const hasRealHistory = rawSeries.length > 1 || backtest != null;
            const total = totalsByCcy.get(ccy)?.net ?? 0;
            const start = series.length ? series[0].value : total;
            const change = total - start;
            // A padded (flat) window is 0% change by definition.
            const changePct = backtest
              ? backtest[backtest.length - 1].pct
              : rawSeries.length > 1
                ? start !== 0
                  ? (change / Math.abs(start)) * 100
                  : null
                : series.length > 1
                  ? 0
                  : null;

            const perf: PerfSeries[] = [];
            if (backtest) {
              perf.push({
                name: "Your Portfolio",
                color: PORTFOLIO_COLOR,
                points: backtest,
              });
              if (benchSeries) perf.push(benchSeries);
            } else if (series.length > 1 && series[0].value !== 0) {
              const base = series[0].value;
              perf.push({
                name: "Your Portfolio",
                color: PORTFOLIO_COLOR,
                points: series.map((p) => ({
                  date: p.date,
                  pct: ((p.value - base) / Math.abs(base)) * 100,
                })),
              });
              if (ccy === "USD" && benchSeries) perf.push(benchSeries);
            }
            const ccyAccounts = invAccounts.filter((a) => a.currency === ccy);
            const noHoldingsHint =
              ccy === "USD" && usdSymbolHoldings.length === 0;

            return (
              <section key={ccy} className="flex flex-col gap-4">
                <Card>
                  <CardHeader
                    title="Performance"
                    sub={`${CCY_SYMBOL[ccy] ?? ""} ${ccy}`}
                    right={
                      <span className="tnum text-[15px] font-semibold">
                        {fmtMoney(total, ccy, { decimals: false })}
                      </span>
                    }
                  />
                  <div className="grid grid-flow-col auto-cols-fr divide-x divide-line border-y border-line">
                    <PerfCell label="Your Portfolio" pct={changePct} />
                    {ccy === "USD"
                      ? benchStats.map((b) => (
                          <PerfCell
                            key={b.key}
                            label={b.label}
                            pct={b.pct}
                            active={b.key === bench}
                          />
                        ))
                      : null}
                  </div>
                  <div className="px-2 pb-2 pt-3">
                    {perf.length > 0 ? (
                      <PerfChart series={perf} height={230} />
                    ) : (
                      <p className="px-3 pb-3 text-[12.5px] text-muted">
                        History starts today.
                      </p>
                    )}
                    {noHoldingsHint ? (
                      <p className="px-3 pb-2 text-[12px] text-faint">
                        Rich backtested history (like Monarch&apos;s) unlocks
                        the moment Robinhood shares its holdings — approve the
                        Investments product at dashboard.plaid.com, then Sync.
                      </p>
                    ) : null}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Accounts" sub={ccy} />
                  <div className="pb-2">
                    {ccyAccounts.map((a) => {
                      const rows = (holdingsByAccount.get(a.id) ?? [])
                        .slice()
                        .sort(
                          (x, y) => Number(y.value ?? 0) - Number(x.value ?? 0),
                        );
                      return (
                        <div
                          key={a.id}
                          className="border-b border-line last:border-0"
                        >
                          <Link
                            href={`/accounts/${a.id}`}
                            className="flex items-center gap-3 px-5 py-3 hover:bg-hover"
                          >
                            <InstitutionLogo
                              institution={
                                a.institution_name ??
                                cfgByAccount.get(a.id)?.provider ??
                                null
                              }
                              fallback={a.name}
                              size={34}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-[13.5px] font-medium"
                                dir="auto"
                              >
                                {a.name}
                              </span>
                              <span className="block text-[12px] text-muted">
                                {subtypeLabel(a)}
                              </span>
                            </span>
                            <span className="tnum text-[13.5px] font-semibold">
                              {fmtMoney(Number(a.current_balance ?? 0), a.currency)}
                            </span>
                          </Link>
                          {rows.length > 0 ? (
                            <div className="px-5 pb-3 pl-[72px]">
                              <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                                <span>Security</span>
                                <span className="text-right">Price</span>
                                <span className="text-right">Quantity</span>
                                <span className="text-right">Value</span>
                              </div>
                              {rows.map((h) => (
                                <div
                                  key={h.id}
                                  className="grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                                >
                                  <span className="truncate" dir="auto">
                                    <span className="font-medium">
                                      {h.symbol ?? "—"}
                                    </span>
                                    <span className="ml-1.5 text-muted">
                                      {h.name}
                                    </span>
                                  </span>
                                  <span className="tnum text-right">
                                    {h.price != null
                                      ? fmtMoney(Number(h.price), h.currency)
                                      : "—"}
                                  </span>
                                  <span className="tnum text-right">
                                    {h.quantity != null
                                      ? Number(h.quantity).toLocaleString()
                                      : "—"}
                                  </span>
                                  <span className="tnum text-right font-medium">
                                    {h.value != null
                                      ? fmtMoney(Number(h.value), h.currency)
                                      : "—"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </Card>
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
            const ccyAccounts = invAccounts.filter(
              (a) => a.currency === ccy && Number(a.current_balance ?? 0) > 0,
            );
            if (ccyAccounts.length === 0) return null;
            const total = ccyAccounts.reduce(
              (s, a) => s + Number(a.current_balance ?? 0),
              0,
            );

            const groups = ALLOC_CLASSES.map((cls, i) => {
              const members = ccyAccounts
                .filter((a) => allocClass(a) === cls)
                .sort(
                  (x, y) =>
                    Number(y.current_balance ?? 0) - Number(x.current_balance ?? 0),
                );
              const value = members.reduce(
                (s, a) => s + Number(a.current_balance ?? 0),
                0,
              );
              return {
                cls,
                color: ALLOC_COLORS[i % ALLOC_COLORS.length],
                members,
                value,
              };
            }).filter((g) => g.value > 0);

            const segments: AllocSegment[] = groups.map((g) => ({
              name: g.cls,
              value: g.value,
              color: g.color,
            }));

            const COLS =
              "grid grid-cols-[minmax(0,1fr)_80px_80px_120px_64px] items-center gap-2";

            return (
              <Card key={ccy}>
                <CardHeader
                  title="Allocation breakdown"
                  sub="Asset class"
                  right={
                    <span className="text-[13px] text-muted">
                      {CCY_SYMBOL[ccy] ?? ""} {ccy}
                    </span>
                  }
                />
                <div className="px-5 pb-4">
                  <AllocBar segments={segments} currency={ccy} height={280} />
                </div>
                <div className="px-5 pb-5">
                  {groups.map((g, gi) => (
                    <div key={g.cls} className={gi > 0 ? "mt-3" : ""}>
                      <div className={`${COLS} rounded-lg bg-active px-3 py-1.5`}>
                        <span className="flex items-center gap-2 text-[12px] font-semibold">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: g.color }}
                          />
                          {g.cls}
                        </span>
                        {gi === 0 ? (
                          <>
                            <span className="text-right text-[11px] font-medium text-muted">
                              Price
                            </span>
                            <span className="text-right text-[11px] font-medium text-muted">
                              Quantity
                            </span>
                            <span className="text-right text-[11px] font-medium text-muted">
                              Value
                            </span>
                            <span className="text-right text-[11px] font-medium text-muted">
                              Weight
                            </span>
                          </>
                        ) : null}
                      </div>
                      <div
                        className={`${COLS} border-b border-line px-3 py-2 text-[13px]`}
                      >
                        <span className="truncate font-semibold">{g.cls}</span>
                        <span />
                        <span />
                        <span className="tnum text-right font-semibold">
                          {fmtMoney(g.value, ccy, { decimals: false })}
                        </span>
                        <span className="tnum text-right font-semibold">
                          {((g.value / total) * 100).toFixed(1)}%
                        </span>
                      </div>
                      {g.members.map((a) => (
                        <Link
                          key={a.id}
                          href={`/accounts/${a.id}`}
                          className={`${COLS} border-b border-line px-3 py-1.5 text-[13px] last:border-0 hover:bg-hover`}
                        >
                          <span className="truncate" dir="auto">
                            {a.name}
                          </span>
                          <span />
                          <span />
                          <span className="tnum text-right">
                            {fmtMoney(Number(a.current_balance ?? 0), ccy, {
                              decimals: false,
                            })}
                          </span>
                          <span className="tnum text-right text-muted">
                            {(
                              (Number(a.current_balance ?? 0) / total) *
                              100
                            ).toFixed(1)}
                            %
                          </span>
                        </Link>
                      ))}
                    </div>
                  ))}
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
          <InfoBanner>
            Cost basis comes from your broker where available. Pensions show
            gain since your last anchor (includes deposits).
          </InfoBanner>
          {currencies.map((ccy) => {
            const total = totalsByCcy.get(ccy)?.net ?? 0;
            const ccyHoldings = holdings
              .filter((h) => h.currency === ccy)
              .sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0));
            const withCb = ccyHoldings.filter(
              (h) => h.cost_basis != null && h.value != null,
            );
            const pensions = invAccounts.filter(
              (a) => a.currency === ccy && a.type === "pension",
            );
            const anchored = pensions.filter(
              (a) => cfgByAccount.get(a.id)?.anchor_balance != null,
            );
            const cost =
              withCb.reduce((s, h) => s + Number(h.cost_basis), 0) +
              anchored.reduce(
                (s, a) => s + Number(cfgByAccount.get(a.id)!.anchor_balance),
                0,
              );
            const value =
              withCb.reduce((s, h) => s + Number(h.value), 0) +
              anchored.reduce((s, a) => s + Number(a.current_balance ?? 0), 0);
            const hasCost = withCb.length > 0 || anchored.length > 0;
            const gain = value - cost;
            const gainPct = cost > 0 ? (gain / cost) * 100 : 0;

            return (
              <section key={ccy} className="flex flex-col gap-4">
                <Card>
                  <div className="grid grid-cols-2 divide-x divide-line lg:grid-cols-4">
                    <GainStat
                      label="Portfolio value"
                      value={fmtMoney(total, ccy, { decimals: false })}
                    />
                    <GainStat
                      label="Portfolio cost (partial)"
                      value={
                        hasCost ? fmtMoney(cost, ccy, { decimals: false }) : "—"
                      }
                    />
                    <GainStat
                      label="Gain/loss"
                      value={
                        hasCost
                          ? fmtMoney(gain, ccy, { sign: true, decimals: false })
                          : "—"
                      }
                      tone={hasCost ? (gain >= 0 ? "pos" : "neg") : undefined}
                    />
                    <GainStat
                      label="Gain/loss %"
                      value={hasCost ? fmtPct(gainPct, 2) : "—"}
                      tone={hasCost ? (gain >= 0 ? "pos" : "neg") : undefined}
                    />
                  </div>
                </Card>

                {ccyHoldings.length > 0 ? (
                  <Card>
                    <CardHeader title="Holdings" sub={ccy} />
                    <div className="px-5 pb-4">
                      <div className="grid grid-cols-[minmax(0,1fr)_80px_120px_120px_150px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                        <span>Security</span>
                        <span className="text-right">Quantity</span>
                        <span className="text-right">Total cost basis</span>
                        <span className="text-right">Current value</span>
                        <span className="text-right">Gain/loss</span>
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
                            className="grid grid-cols-[minmax(0,1fr)_80px_120px_120px_150px] items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
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
                                <GainPill
                                  gain={hGain}
                                  pct={hPct}
                                  currency={h.currency}
                                />
                              ) : (
                                <span className="text-[12.5px] text-faint">
                                  no basis
                                </span>
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
                      sub="gain since anchor — includes deposits"
                    />
                    <div className="px-5 pb-4">
                      <div className="grid grid-cols-[minmax(0,1fr)_130px_130px_150px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                        <span>Account</span>
                        <span className="text-right">Anchor balance</span>
                        <span className="text-right">Current value</span>
                        <span className="text-right">Gain since anchor</span>
                      </div>
                      {pensions.map((a) => {
                        const cfg = cfgByAccount.get(a.id);
                        const anchor =
                          cfg?.anchor_balance != null
                            ? Number(cfg.anchor_balance)
                            : null;
                        const cur = Number(a.current_balance ?? 0);
                        const pGain = anchor != null ? cur - anchor : null;
                        const pPct =
                          anchor != null && anchor > 0 && pGain != null
                            ? (pGain / anchor) * 100
                            : 0;
                        return (
                          <div
                            key={a.id}
                            className="grid grid-cols-[minmax(0,1fr)_130px_130px_150px] items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
                          >
                            <span className="truncate font-medium" dir="auto">
                              {a.name}
                            </span>
                            <span className="tnum text-right">
                              {anchor != null
                                ? fmtMoney(anchor, a.currency)
                                : "—"}
                            </span>
                            <span className="tnum text-right font-medium">
                              {fmtMoney(cur, a.currency)}
                            </span>
                            <span className="text-right">
                              {pGain != null ? (
                                <GainPill
                                  gain={pGain}
                                  pct={pPct}
                                  currency={a.currency}
                                />
                              ) : (
                                <span className="text-[12.5px] text-faint">
                                  no anchor
                                </span>
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
  const pensionAccounts = invAccounts
    .filter((a) => a.type === "pension" && Number(a.current_balance ?? 0) > 0)
    .sort(
      (x, y) => Number(y.current_balance ?? 0) - Number(x.current_balance ?? 0),
    );
  const pensionTotal = pensionAccounts.reduce(
    (s, a) => s + Number(a.current_balance ?? 0),
    0,
  );
  const pensionCcy = pensionAccounts[0]?.currency ?? "ILS";

  return (
    <>
      {header}
      <div className="flex flex-col gap-4 px-6 pt-2">
        <InfoBanner>
          Israeli pension and study funds — official published yields from
          data.gov.il (about a 5-week lag).
        </InfoBanner>
        {pensionCfgs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<TrendingUp size={19} />}
              title="No pension funds configured"
              sub="Add a pension from Accounts → Add account → Pension, with its fund number, to track published yields here."
            />
          </Card>
        ) : (
          <>
            {pensionAccounts.length > 0 ? (
              <Card>
                <CardHeader title="Fund analysis" sub="by fund value" />
                <div className="grid grid-cols-1 items-center gap-6 px-5 pb-5 md:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="relative">
                    <Donut
                      data={pensionAccounts.map((a) => ({
                        name: a.name,
                        value: Math.round(Number(a.current_balance ?? 0)),
                      }))}
                      currency={pensionCcy}
                      height={220}
                    />
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="tnum text-[17px] font-semibold">
                        {fmtMoney(pensionTotal, pensionCcy, { decimals: false })}
                      </span>
                      <span className="text-[11.5px] text-muted">
                        Total value
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="grid grid-cols-[minmax(0,1fr)_70px_130px] gap-2 border-b border-line pb-1.5 text-[11.5px] font-medium text-muted">
                      <span>Fund</span>
                      <span className="text-right">Percent</span>
                      <span className="text-right">Value</span>
                    </div>
                    {pensionAccounts.map((a, i) => {
                      const v = Number(a.current_balance ?? 0);
                      return (
                        <div
                          key={a.id}
                          className="grid grid-cols-[minmax(0,1fr)_70px_130px] items-center gap-2 border-b border-line py-1.5 text-[13px]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                background: DONUT_COLORS[i % DONUT_COLORS.length],
                              }}
                            />
                            <span className="truncate" dir="auto">
                              {a.name}
                            </span>
                          </span>
                          <span className="tnum text-right text-muted">
                            {((v / pensionTotal) * 100).toFixed(1)}%
                          </span>
                          <span className="tnum text-right">
                            {fmtMoney(v, a.currency, { decimals: false })}
                          </span>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-[minmax(0,1fr)_70px_130px] items-center gap-2 pt-2 text-[13px] font-semibold">
                      <span>Total</span>
                      <span className="tnum text-right">100%</span>
                      <span className="tnum text-right">
                        {fmtMoney(pensionTotal, pensionCcy, { decimals: false })}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {fundCards.map(({ account, cfg, rows }) => {
                const last12 = (rows ?? []).slice(0, 12).slice().reverse();
                const year = new Date().getFullYear();
                const ytd =
                  Math.round(
                    (rows ?? [])
                      .filter(
                        (r) => Math.floor(Number(r.REPORT_PERIOD) / 100) === year,
                      )
                      .reduce((s, r) => s + Number(r.MONTHLY_YIELD), 0) * 100,
                  ) / 100;
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
                      sub={`track ${cfg.fund_id} · ${cfg.dataset}`}
                      right={
                        rows !== null && rows.length > 0 ? (
                          <span
                            className={`tnum rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                              ytd >= 0
                                ? "bg-pos-soft text-pos"
                                : "bg-neg-soft text-neg"
                            }`}
                          >
                            YTD {ytd >= 0 ? "+" : ""}
                            {fmtPct(ytd, 2)}
                          </span>
                        ) : null
                      }
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
                              className="mb-2.5 truncate text-[12.5px] text-ink-soft"
                              dir="auto"
                            >
                              {last12[0].FUND_NAME}
                            </p>
                          ) : null}
                          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                            {last12.map((r) => {
                              const y = Number(r.MONTHLY_YIELD);
                              return (
                                <div
                                  key={r.REPORT_PERIOD}
                                  className="rounded-lg bg-bg px-2.5 py-2"
                                >
                                  <div className="tnum text-[11px] text-muted">
                                    {periodLabel(Number(r.REPORT_PERIOD))}
                                  </div>
                                  <div
                                    className={`tnum text-[13px] font-medium ${
                                      y >= 0 ? "text-pos" : "text-neg"
                                    }`}
                                  >
                                    {y >= 0 ? "+" : ""}
                                    {fmtPct(y, 2)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-2.5 text-[12px] text-muted">
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
          </>
        )}
      </div>
    </>
  );
}

// -------------------------------------------------------- local pieces

function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-[#eef4fb] px-4 py-3 text-[12.5px] text-ink-soft">
      <Info size={15} className="mt-0.5 shrink-0 text-[#4a6cd4]" />
      <span>{children}</span>
    </div>
  );
}

function PerfCell({
  label,
  pct,
  active = false,
}: {
  label: string;
  pct: number | null;
  active?: boolean;
}) {
  return (
    <div className="px-5 py-3.5">
      <div
        className={`text-[12px] font-medium ${active ? "text-ink" : "text-muted"}`}
      >
        {label}
      </div>
      {pct != null ? (
        <div
          className={`tnum mt-0.5 text-[20px] font-bold ${
            pct >= 0 ? "text-pos" : "text-neg"
          }`}
        >
          {fmtPct(pct, 2)}
        </div>
      ) : (
        <div className="tnum mt-0.5 text-[20px] font-bold text-faint">—</div>
      )}
    </div>
  );
}

function GainStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div
        className={`tnum mt-0.5 text-[20px] font-semibold ${
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""
        }`}
      >
        {value}
      </div>
    </div>
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
