"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import { buttonCls, Card, CardHeader, PageHeader, inputCls, selectCls } from "@/components/ui";
import {
  EVENT_TEMPLATES,
  type ForecastAccountRow,
  type ForecastEvent,
  type ForecastIncome,
  type ForecastMember,
  type ForecastResult,
  type ForecastSeriesRow,
} from "@/lib/forecast";
import { addForecastEvent, updateAssumptions } from "./forecast-actions";
import { AccountPanel, type PanelTarget } from "./account-panel";

const ILS_COLOR = "#1a9a5c";
const USD_COLOR = "#63b3d9";
const AXIS = { fontSize: 11, fill: "#a5a39e" };
const ASSET_GROUP_ORDER = ["Cash", "Investments", "Pensions", "Other Assets", "Extra"];
const LIABILITY_GROUP_ORDER = ["Credit Cards", "Loans", "Other Liabilities"];

interface Settings {
  inflationPct: number;
  returnPct: number;
  useActualExpenses: boolean;
  expensesOverride: Record<string, number | null>;
  futureValues: "today" | "nominal";
}

export interface AccountSetting {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  type: string;
  include: boolean;
  growthMode: "default" | "fixed" | "none" | "variable";
  growthPct: number | null;
  defaultGrowthPct: number;
  growthPoints: { year: number; rate: number }[];
  splitMode: "percent" | "amount" | null;
  splitValue: number;
}

export interface ForecastConfig {
  splitEnabled: boolean;
  withdrawalOrder: string[];
  futureValues: "today" | "nominal";
}

// One side slot, Monarch-style: assumptions, one account, or a sub-view.
type Panel = { kind: "assumptions" } | PanelTarget | null;

export function ForecastView({
  result,
  currencies,
  members,
  incomes,
  events,
  accountSettings,
  config,
  settings,
  actualExpenses,
}: {
  result: ForecastResult;
  currencies: string[];
  members: ForecastMember[];
  incomes: ForecastIncome[];
  events: ForecastEvent[];
  accountSettings: AccountSetting[];
  config: ForecastConfig;
  settings: Settings;
  actualExpenses: Record<string, number>;
}) {
  const [tab, setTab] = useState<"accounts" | "cashflow" | "events">("accounts");
  const [panel, setPanel] = useState<Panel>(null);
  const [lastAccountId, setLastAccountId] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  // Row-path keys: `${ccy}:assets` / `${ccy}:liab`, `${ccy}:g:${group}`, `${ccy}:b:${accountId}`.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const ccy of currencies) {
      s.add(`${ccy}:assets`);
      s.add(`${ccy}:cf:income`);
      s.add(`${ccy}:cf:expenses`);
      for (const row of result.accountRows[ccy] ?? []) s.add(`${ccy}:g:${row.group}`);
    }
    return s;
  });

  function toggleRow(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openPanel(p: Panel) {
    if (p?.kind === "account") setLastAccountId(p.id);
    setPanel(p);
  }

  const now = new Date().getFullYear();
  const chartData = useMemo(() => {
    const byYear = new Map<number, { year: number; ils?: number; usd?: number; icons: string[] }>();
    for (const ccy of currencies) {
      for (const row of result.byCurrency[ccy] ?? []) {
        const e = byYear.get(row.year) ?? { year: row.year, icons: [] };
        if (ccy === "ILS") e.ils = row.netWorth;
        if (ccy === "USD") e.usd = row.netWorth;
        for (const ev of row.events) if (ev.icon) e.icons.push(ev.icon);
        byYear.set(row.year, e);
      }
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }, [result, currencies]);

  const eventYears = useMemo(() => {
    const m = new Map<number, string>();
    for (const ev of events) m.set(ev.year, (m.get(ev.year) ?? "") + (ev.icon ?? "🎯"));
    return m;
  }, [events]);

  function statFor(ccy: string) {
    const rows = result.byCurrency[ccy] ?? [];
    const eoy = rows.find((r) => r.year === now)?.netWorth ?? 0;
    const atRetire = result.retirementYear
      ? (rows.find((r) => r.year === result.retirementYear)?.netWorth ?? null)
      : null;
    const atEnd = rows[rows.length - 1]?.netWorth ?? 0;
    return { eoy, atRetire, atEnd };
  }

  const retireAge = (() => {
    if (!result.retirementYear) return null;
    const m = members.find(
      (x) => x.birthYear != null && x.retirementYear === result.retirementYear,
    );
    return m?.birthYear ? result.retirementYear - m.birthYear : null;
  })();

  const yearCols = useMemo(() => chartData.map((d) => d.year), [chartData]);

  // Youngest member (latest birth year) drives the "Age N" labels.
  const youngestBirthYear = useMemo(() => {
    const ys = members
      .map((m) => m.birthYear)
      .filter((y): y is number => y != null);
    return ys.length ? Math.max(...ys) : null;
  }, [members]);

  const primaryCcy = currencies.includes("ILS") ? "ILS" : "USD";
  const primaryAxisId = primaryCcy === "ILS" ? "ils" : "usd";

  // Monarch-style start label: "2026 · Age 30 · ₪219.1K".
  const startDot = useMemo(() => {
    const d = chartData[0];
    if (!d) return null;
    const value = primaryCcy === "ILS" ? d.ils : d.usd;
    if (value == null) return null;
    const age = youngestBirthYear != null ? d.year - youngestBirthYear : null;
    return {
      year: d.year,
      value,
      label: `${d.year}${age != null ? ` · Age ${age}` : ""} · ${fmtMoney(value, primaryCcy, { compact: true })}`,
    };
  }, [chartData, primaryCcy, youngestBirthYear]);

  // The event open in the side panel shades its active years on the chart.
  const shadedEvent =
    panel?.kind === "event" ? (events.find((e) => e.id === panel.id) ?? null) : null;
  const shadeRange = useMemo(() => {
    if (!shadedEvent || yearCols.length < 2) return null;
    const first = yearCols[0];
    const last = yearCols[yearCols.length - 1];
    let x1 = Math.min(Math.max(shadedEvent.year, first), last);
    let x2 =
      shadedEvent.kind === "one_time"
        ? x1
        : Math.min(Math.max(shadedEvent.endYear ?? last, x1), last);
    // A point-scale axis renders x1===x2 as zero width; widen to one year band.
    if (x1 === x2) {
      if (x2 < last) x2 += 1;
      else x1 -= 1;
    }
    return { x1, x2 };
  }, [shadedEvent, yearCols]);

  return (
    <>
      <PageHeader
        title={
          <span>
            Forecasting
            <span className="ml-2 rounded-full bg-active px-2.5 py-1 text-[12px] font-medium text-ink-soft">
              Baseline forecast
            </span>
          </span>
        }
        right={
          <>
            <button
              className={buttonCls("secondary")}
              onClick={() =>
                setPanel((p) => (p?.kind === "assumptions" ? null : { kind: "assumptions" }))
              }
            >
              <Pencil size={13.5} /> Edit assumptions
            </button>
            <button className={buttonCls("primary")} onClick={() => setEventOpen(true)}>
              <Plus size={14} /> Add event
            </button>
          </>
        }
      />
      <div
        className={cn(
          "grid grid-cols-1 gap-4 px-6 pt-2",
          panel && "xl:grid-cols-[minmax(0,1fr)_340px]",
        )}
      >
        <div className="flex flex-col gap-4">
          <Card>
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line lg:grid-cols-4">
              {currencies.map((ccy) => {
                const s = statFor(ccy);
                return (
                  <StatCell
                    key={`${ccy}-eoy`}
                    label={`${ccy === "ILS" ? "₪" : "$"} Net worth (EOY)`}
                    tooltip="The total value of the assets and debts included in your forecast at the end of the year."
                    value={fmtMoney(s.eoy, ccy, { compact: true })}
                  />
                );
              })}
              {currencies.map((ccy) => {
                const s = statFor(ccy);
                const atRetirement = !!result.retirementYear && s.atRetire != null;
                return (
                  <StatCell
                    key={`${ccy}-end`}
                    label={`${ccy === "ILS" ? "₪" : "$"} at ${result.retirementYear ? "retirement" : "end"}`}
                    tooltip={
                      atRetirement
                        ? "Projected net worth in the year the first member retires."
                        : "Projected net worth at the end of the plan."
                    }
                    value={
                      atRetirement
                        ? fmtMoney(s.atRetire!, ccy, { compact: true })
                        : fmtMoney(s.atEnd, ccy, { compact: true })
                    }
                    sub={
                      retireAge != null
                        ? `retire at ${retireAge} · end: ${fmtMoney(s.atEnd, ccy, { compact: true })}`
                        : undefined
                    }
                  />
                );
              })}
            </div>
            <div className="px-2 pb-2 pt-3">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 20, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#eae8e3" vertical={false} />
                  {shadeRange ? (
                    <ReferenceArea
                      yAxisId={primaryAxisId}
                      x1={shadeRange.x1}
                      x2={shadeRange.x2}
                      fill="#ee6a3c"
                      fillOpacity={0.08}
                      stroke="none"
                    />
                  ) : null}
                  <XAxis dataKey="year" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                  {currencies.includes("ILS") ? (
                    <YAxis
                      yAxisId="ils"
                      orientation="left"
                      tick={AXIS}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => fmtMoney(v, "ILS", { compact: true })}
                    />
                  ) : null}
                  {currencies.includes("USD") ? (
                    <YAxis
                      yAxisId="usd"
                      orientation={currencies.includes("ILS") ? "right" : "left"}
                      tick={AXIS}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => fmtMoney(v, "USD", { compact: true })}
                    />
                  ) : null}
                  <Tooltip
                    formatter={(v, name) => [
                      fmtMoney(Number(v), name === "ils" ? "ILS" : "USD"),
                      name === "ils" ? "₪ Net worth" : "$ Net worth",
                    ]}
                    labelFormatter={(y) => String(y)}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #eae8e3",
                      fontSize: 12.5,
                      boxShadow: "0 4px 16px rgba(34,32,29,.14)",
                    }}
                  />
                  {result.retirementYear ? (
                    <ReferenceLine
                      yAxisId={currencies.includes("ILS") ? "ils" : "usd"}
                      x={result.retirementYear}
                      stroke="#dcdad4"
                      label={{ value: "🌅", position: "top", fontSize: 14 }}
                    />
                  ) : null}
                  {[...eventYears.entries()].map(([year, icons]) => (
                    <ReferenceLine
                      key={year}
                      yAxisId={currencies.includes("ILS") ? "ils" : "usd"}
                      x={year}
                      stroke="#efedea"
                      label={{ value: icons, position: "top", fontSize: 13 }}
                    />
                  ))}
                  {currencies.includes("ILS") ? (
                    <Line
                      isAnimationActive={false}
                      yAxisId="ils"
                      type="monotone"
                      dataKey="ils"
                      stroke={ILS_COLOR}
                      strokeWidth={2}
                      dot={false}
                    />
                  ) : null}
                  {currencies.includes("USD") ? (
                    <Line
                      isAnimationActive={false}
                      yAxisId="usd"
                      type="monotone"
                      dataKey="usd"
                      stroke={USD_COLOR}
                      strokeWidth={2}
                      dot={false}
                    />
                  ) : null}
                  {startDot ? (
                    <ReferenceDot
                      yAxisId={primaryAxisId}
                      x={startDot.year}
                      y={startDot.value}
                      r={3.5}
                      fill={primaryCcy === "ILS" ? ILS_COLOR : USD_COLOR}
                      stroke="#fff"
                      strokeWidth={1.5}
                      label={{
                        value: startDot.label,
                        position: "right",
                        offset: 8,
                        fontSize: 11,
                        fill: "#6f6c66",
                      }}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 pb-1 text-[12px] text-muted">
                {currencies.includes("ILS") ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded" style={{ background: ILS_COLOR }} /> ₪ Net worth
                  </span>
                ) : null}
                {currencies.includes("USD") ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded" style={{ background: USD_COLOR }} /> $ Net worth
                  </span>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-1 px-4 pt-3">
              {(
                [
                  ["accounts", "Net worth"],
                  ["cashflow", "Cash Flow"],
                  ["events", "Events"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium",
                    tab === key ? "bg-active text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto px-4 pb-4 pt-2">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-card py-1.5 pr-3 text-left font-medium text-muted">
                      {tab === "accounts"
                        ? "Net worth"
                        : tab === "cashflow"
                          ? "Cash flow"
                          : "Events"}
                    </th>
                    {yearCols.map((y) => (
                      <th key={y} className="tnum px-2 py-1.5 text-right font-medium text-muted">
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tab === "events" ? (
                    <EventTimelineRows
                      events={events}
                      members={members}
                      years={yearCols}
                      activeId={panel?.kind === "event" ? panel.id : null}
                      onOpen={(id) => openPanel({ kind: "event", id })}
                    />
                  ) : (
                    currencies.map((ccy) =>
                      tab === "accounts" ? (
                        <NetWorthRows
                          key={ccy}
                          ccy={ccy}
                          result={result}
                          futureValues={config.futureValues}
                          expanded={expanded}
                          onToggle={toggleRow}
                          onOpenSettings={(id) => openPanel({ kind: "account", id })}
                          activeId={panel?.kind === "account" ? panel.id : null}
                        />
                      ) : (
                        <CashflowRows
                          key={ccy}
                          ccy={ccy}
                          result={result}
                          expanded={expanded}
                          onToggle={toggleRow}
                        />
                      ),
                    )
                  )}
                </tbody>
              </table>
              {tab === "accounts" &&
              accountSettings.some((a) => !a.include) ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-3 text-[12px] text-muted">
                  <span>Excluded from forecast:</span>
                  {accountSettings
                    .filter((a) => !a.include)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openPanel({ kind: "account", id: a.id })}
                        className="flex cursor-pointer items-center gap-1 rounded-full bg-active px-2 py-0.5 hover:text-ink"
                      >
                        {a.name}
                        <Settings size={11} />
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        {panel?.kind === "assumptions" ? (
          <AssumptionsPanel
            members={members}
            incomes={incomes}
            settings={settings}
            actualExpenses={actualExpenses}
            currencies={currencies}
            onClose={() => setPanel(null)}
          />
        ) : panel ? (
          <AccountPanel
            key={
              panel.kind === "account"
                ? `account:${panel.id}`
                : panel.kind === "event"
                  ? `event:${panel.id}`
                  : panel.kind
            }
            kind={panel.kind}
            account={
              panel.kind === "account"
                ? (accountSettings.find((a) => a.id === panel.id) ?? null)
                : null
            }
            eventId={panel.kind === "event" ? panel.id : null}
            events={events}
            birthYear={youngestBirthYear}
            lastAccountId={lastAccountId}
            accounts={accountSettings}
            config={config}
            onSwitch={openPanel}
            onClose={() => setPanel(null)}
          />
        ) : null}
      </div>

      {eventOpen ? <AddEventModal onClose={() => setEventOpen(false)} /> : null}
    </>
  );
}

/* --------------------------- Net worth tree --------------------------- */

function fmtRate(pct: number): string {
  return String(Math.round(pct * 10) / 10);
}

function InfoDot({ title }: { title: string }) {
  return (
    <span title={title} className="cursor-help text-[10px] text-faint">
      ⓘ
    </span>
  );
}

function Chevron({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink"
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
}

/** One currency block: total, Assets/Liabilities sections, groups, accounts, breakdowns. */
function NetWorthRows({
  ccy,
  result,
  futureValues,
  expanded,
  onToggle,
  onOpenSettings,
  activeId,
}: {
  ccy: string;
  result: ForecastResult;
  futureValues: "today" | "nominal";
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenSettings: (id: string) => void;
  activeId: string | null;
}) {
  const totals = result.byCurrency[ccy] ?? [];
  const rows = result.accountRows[ccy] ?? [];
  const nYears = totals.length || (rows[0]?.series.length ?? 0);
  const assets = rows.filter((r) => !r.isLiability);
  const liabilities = rows.filter((r) => r.isLiability);

  function sumSeries(rs: ForecastAccountRow[]): number[] {
    const out = new Array<number>(nYears).fill(0);
    for (const r of rs) for (let i = 0; i < nYears; i++) out[i] += r.series[i] ?? 0;
    return out;
  }

  function orderedGroups(rs: ForecastAccountRow[], order: string[]): string[] {
    const present = [...new Set(rs.map((r) => r.group))];
    return [
      ...order.filter((g) => present.includes(g)),
      ...present.filter((g) => !order.includes(g)),
    ];
  }

  function breakdownRows(r: ForecastAccountRow): ReactNode[] {
    const out: ReactNode[] = [];
    const labelCell = (content: ReactNode) => (
      <td className="sticky left-0 bg-card py-1 pr-3">
        <span className="flex items-center gap-1.5 pl-12 text-[12px] text-muted">
          {content}
        </span>
      </td>
    );
    out.push(
      <tr key={`${ccy}:bd:${r.id}:start`} className="border-t border-line">
        {labelCell("Starting balance")}
        {r.breakdown.map((b, i) => (
          <td key={i} className="tnum px-2 py-1 text-right text-[12px] text-muted">
            {i === 0 ? (
              <>
                <InfoDot title="Today's balance." />{" "}
              </>
            ) : null}
            {fmtMoney(b.start, ccy, { compact: true })}
          </td>
        ))}
      </tr>,
    );
    if (futureValues === "today") {
      out.push(
        <tr key={`${ccy}:bd:${r.id}:inflation`} className="border-t border-line">
          {labelCell(
            <>
              Inflation adjustment{" "}
              <InfoDot title="Adjusts the starting balance for inflation to show its buying power in today's money." />
            </>,
          )}
          {r.breakdown.map((b, i) => (
            <td
              key={i}
              className={cn(
                "tnum px-2 py-1 text-right text-[12px]",
                b.inflation < 0 ? "text-neg" : "text-muted",
              )}
            >
              {i === 0 || b.inflation === 0
                ? "-"
                : fmtMoney(b.inflation, ccy, { compact: true })}
            </td>
          ))}
        </tr>,
      );
    }
    if (r.ratePct !== 0) {
      out.push(
        <tr key={`${ccy}:bd:${r.id}:growth`} className="border-t border-line">
          {labelCell(
            <>
              Growth <span className="text-[11px]">↗ {fmtRate(r.ratePct)}%</span>
            </>,
          )}
          {r.breakdown.map((b, i) => (
            <td
              key={i}
              className={cn(
                "tnum px-2 py-1 text-right text-[12px]",
                b.growth > 0 ? "text-pos" : b.growth < 0 ? "text-neg" : "text-muted",
              )}
            >
              {b.growth === 0 ? "-" : fmtMoney(b.growth, ccy, { compact: true, sign: true })}
            </td>
          ))}
        </tr>,
      );
    }
    if (r.breakdown.some((b) => b.contribution !== 0)) {
      out.push(
        <tr key={`${ccy}:bd:${r.id}:contribution`} className="border-t border-line">
          {/* Monarch labels the Extra bucket's flows "Deposits". */}
          {labelCell(r.id === null ? "Deposits" : "Contribution")}
          {r.breakdown.map((b, i) => (
            <td
              key={i}
              className={cn(
                "tnum px-2 py-1 text-right text-[12px]",
                b.contribution > 0
                  ? "text-pos"
                  : b.contribution < 0
                    ? "text-neg"
                    : "text-muted",
              )}
            >
              {b.contribution === 0
                ? "-"
                : fmtMoney(b.contribution, ccy, { compact: true, sign: true })}
            </td>
          ))}
        </tr>,
      );
    }
    return out;
  }

  function accountRowTrs(r: ForecastAccountRow): ReactNode[] {
    const bdKey = `${ccy}:b:${r.id}`;
    const bdOpen = expanded.has(bdKey);
    const out: ReactNode[] = [
      <tr key={`${ccy}:a:${r.id}`} className="group/frow border-t border-line">
        <td className="sticky left-0 bg-card py-1 pr-3">
          <span className="flex items-center gap-1 pl-8">
            <Chevron open={bdOpen} onClick={() => onToggle(bdKey)} />
            <span className="truncate" dir="auto">
              {r.name}
            </span>
            {r.id ? (
              <button
                type="button"
                title={`${r.name} forecast settings`}
                onClick={() => onOpenSettings(r.id!)}
                className={cn(
                  "shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink",
                  activeId === r.id ? "text-ink" : "invisible group-hover/frow:visible",
                )}
              >
                <Settings size={12.5} />
              </button>
            ) : null}
            {r.ratePct !== 0 ? (
              <span className="shrink-0 text-[11px] text-muted">
                ↗ {fmtRate(r.ratePct)}%
              </span>
            ) : null}
          </span>
        </td>
        {r.series.map((v, i) => (
          <td key={i} className="tnum px-2 py-1 text-right text-muted">
            {fmtMoney(v, ccy, { compact: true })}
          </td>
        ))}
      </tr>,
    ];
    if (bdOpen) out.push(...breakdownRows(r));
    return out;
  }

  function sectionTrs(
    label: string,
    sectionKey: string,
    sectionRows: ForecastAccountRow[],
    groupOrder: string[],
  ): ReactNode[] {
    const open = expanded.has(sectionKey);
    const out: ReactNode[] = [
      <tr key={sectionKey} className="border-t border-line">
        <td className="sticky left-0 bg-card py-1.5 pr-3">
          <span className="flex items-center gap-1 font-semibold">
            <Chevron open={open} onClick={() => onToggle(sectionKey)} />
            {label}
          </span>
        </td>
        {sumSeries(sectionRows).map((v, i) => (
          <td key={i} className="tnum px-2 py-1.5 text-right font-semibold">
            {fmtMoney(v, ccy, { compact: true })}
          </td>
        ))}
      </tr>,
    ];
    if (!open) return out;
    for (const group of orderedGroups(sectionRows, groupOrder)) {
      const groupRows = sectionRows.filter((r) => r.group === group);
      if (group === "Extra") {
        // The Extra bucket is its own group-level row; no sub-accounts.
        for (const r of groupRows) {
          const bdKey = `${ccy}:b:extra`;
          const bdOpen = expanded.has(bdKey);
          out.push(
            <tr key={`${ccy}:extra`} className="border-t border-line">
              <td className="sticky left-0 bg-card py-1.5 pr-3">
                <span className="flex items-center gap-1 pl-4 font-medium">
                  <Chevron open={bdOpen} onClick={() => onToggle(bdKey)} />
                  Extra savings
                  <InfoDot title="Savings that are not directed to a specific account." />
                  {r.ratePct !== 0 ? (
                    <span className="shrink-0 text-[11px] text-muted">
                      ↗ {fmtRate(r.ratePct)}%
                    </span>
                  ) : null}
                </span>
              </td>
              {r.series.map((v, i) => (
                <td key={i} className="tnum px-2 py-1.5 text-right font-medium">
                  {fmtMoney(v, ccy, { compact: true })}
                </td>
              ))}
            </tr>,
          );
          if (bdOpen) out.push(...breakdownRows(r));
        }
        continue;
      }
      const groupKey = `${ccy}:g:${group}`;
      const groupOpen = expanded.has(groupKey);
      out.push(
        <tr key={groupKey} className="border-t border-line">
          <td className="sticky left-0 bg-card py-1.5 pr-3">
            <span className="flex items-center gap-1 pl-4 font-medium">
              <Chevron open={groupOpen} onClick={() => onToggle(groupKey)} />
              {group}
            </span>
          </td>
          {sumSeries(groupRows).map((v, i) => (
            <td key={i} className="tnum px-2 py-1.5 text-right font-medium">
              {fmtMoney(v, ccy, { compact: true })}
            </td>
          ))}
        </tr>,
      );
      if (groupOpen) for (const r of groupRows) out.push(...accountRowTrs(r));
    }
    return out;
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className="sticky left-0 bg-card py-1.5 pr-3 font-semibold">
          {ccy === "ILS" ? "₪ ILS" : ccy === "USD" ? "$ USD" : ccy} net worth
        </td>
        {totals.map((r) => (
          <td key={r.year} className="tnum px-2 py-1.5 text-right font-semibold">
            {fmtMoney(r.netWorth, ccy, { compact: true })}
          </td>
        ))}
      </tr>
      {sectionTrs("Assets", `${ccy}:assets`, assets, ASSET_GROUP_ORDER)}
      {liabilities.length > 0
        ? sectionTrs("Liabilities", `${ccy}:liab`, liabilities, LIABILITY_GROUP_ORDER)
        : null}
    </>
  );
}

/* ------------------------------ Fragments ------------------------------ */

function StatCell({
  label,
  value,
  sub,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  tooltip?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11.5px] text-muted">
        {tooltip ? (
          <span title={tooltip} className="cursor-help">
            {label} <span className="text-[10px] text-faint">ⓘ</span>
          </span>
        ) : (
          label
        )}
      </div>
      <div className="tnum text-[19px] font-semibold">{value}</div>
      {sub ? <div className="text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

/** Cash Flow tab: Income tree, Expenses tree, Net Cash Flow — per currency. */
function CashflowRows({
  ccy,
  result,
  expanded,
  onToggle,
}: {
  ccy: string;
  result: ForecastResult;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const cf = result.cashflow[ccy];
  if (!cf) return null;
  const sign = ccy === "ILS" ? "₪" : "$";
  const nYears = cf.net.length;

  function sumSeries(rows: ForecastSeriesRow[]): number[] {
    const out = new Array<number>(nYears).fill(0);
    for (const r of rows) for (let i = 0; i < nYears; i++) out[i] += r.series[i] ?? 0;
    return out;
  }

  function subRow(r: ForecastSeriesRow, fallbackIcon: string, key: string) {
    return (
      <tr key={key} className="border-t border-line">
        <td className="sticky left-0 bg-card py-1 pr-3">
          <span className="flex items-center gap-1.5 pl-6 text-[12px] text-muted">
            <span className="text-[13px]">{r.icon ?? fallbackIcon}</span>
            <span className="truncate" dir="auto">
              {r.name}
            </span>
          </span>
        </td>
        {r.series.map((v, i) => (
          <td key={i} className="tnum px-2 py-1 text-right text-[12px] text-muted">
            {fmtMoney(v, ccy, { compact: true })}
          </td>
        ))}
      </tr>
    );
  }

  function totalRow(label: string, rowKey: string, values: number[]) {
    const open = expanded.has(rowKey);
    return (
      <tr key={rowKey} className="border-t border-line">
        <td className="sticky left-0 bg-card py-1.5 pr-3">
          <span className="flex items-center gap-1 font-semibold">
            <Chevron open={open} onClick={() => onToggle(rowKey)} />
            {sign} {label}
          </span>
        </td>
        {values.map((v, i) => (
          <td key={i} className="tnum px-2 py-1.5 text-right font-semibold">
            {fmtMoney(v, ccy, { compact: true })}
          </td>
        ))}
      </tr>
    );
  }

  const incomeKey = `${ccy}:cf:income`;
  const expensesKey = `${ccy}:cf:expenses`;
  const out: ReactNode[] = [totalRow("Income", incomeKey, sumSeries(cf.incomeSources))];
  if (expanded.has(incomeKey)) {
    out.push(
      ...cf.incomeSources.map((r, i) => subRow(r, "💼", `${ccy}:cf:i:${r.id ?? i}`)),
    );
  }
  out.push(totalRow("Expenses", expensesKey, sumSeries(cf.expenseRows)));
  if (expanded.has(expensesKey)) {
    out.push(
      ...cf.expenseRows.map((r, i) => subRow(r, "💳", `${ccy}:cf:e:${r.id ?? i}`)),
    );
  }
  out.push(
    <tr key={`${ccy}:cf:net`} className="border-t border-line">
      <td className="sticky left-0 bg-card py-1.5 pr-3 font-semibold">
        {sign} Net Cash Flow
      </td>
      {cf.net.map((v, i) => (
        <td
          key={i}
          className={cn(
            "tnum px-2 py-1.5 text-right font-semibold",
            v >= 0 ? "text-pos" : "text-neg",
          )}
        >
          {fmtMoney(v, ccy, { compact: true })}
        </td>
      ))}
    </tr>,
  );
  return <>{out}</>;
}

/** Events tab: timeline grid — one row per event, dot under its year column. */
function EventTimelineRows({
  events,
  members,
  years,
  activeId,
  onOpen,
}: {
  events: ForecastEvent[];
  members: ForecastMember[];
  years: number[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const lastYear = years[years.length - 1];
  const retiring = members.filter((m) => m.retirementYear != null);

  function row(opts: {
    key: string;
    icon: string;
    name: string;
    year: number;
    active?: boolean;
    onClick?: () => void;
  }) {
    const { key, icon, name, year, active, onClick } = opts;
    return (
      <tr
        key={key}
        onClick={onClick}
        className={cn("border-t border-line", onClick && "cursor-pointer")}
      >
        <td className="sticky left-0 bg-card py-1.5 pr-3">
          <span className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-[14px]">{icon}</span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] font-medium",
                active && "text-accent",
              )}
              dir="auto"
            >
              {name}
            </span>
            <span className="tnum shrink-0 pl-2 text-[11.5px] text-faint">{year}</span>
            {onClick ? (
              <ChevronRight size={13} className="shrink-0 text-faint" />
            ) : (
              <span className="w-[13px] shrink-0" />
            )}
          </span>
        </td>
        {years.map((y) => (
          <td key={y} className="px-2 py-1.5 text-center">
            {y === year ? (
              <span
                className={cn(
                  "mx-auto block h-2 w-2 rounded-full",
                  active ? "bg-accent" : "bg-accent/60",
                )}
              />
            ) : null}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <>
      {events.map((ev) =>
        row({
          key: ev.id,
          icon: ev.icon ?? "🎯",
          name: ev.name,
          year: ev.year,
          active: activeId === ev.id,
          onClick: () => onOpen(ev.id),
        }),
      )}
      {retiring.map((m) =>
        row({
          key: `retire:${m.userId}`,
          icon: "🌅",
          name: retiring.length > 1 ? `Retirement · ${m.name}` : "Retirement",
          year: m.retirementYear!,
        }),
      )}
      {lastYear != null
        ? row({ key: "end", icon: "🏁", name: "End of plan", year: lastYear })
        : null}
    </>
  );
}

function AddEventModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<(typeof EVENT_TEMPLATES)[number] | null>(null);
  const now = new Date().getFullYear();
  const [form, setForm] = useState({
    name: "",
    year: now + 1,
    endYear: "" as string,
    amount: "" as string,
    currency: "ILS",
  });

  function save() {
    if (!template) return;
    setError(null);
    startTransition(async () => {
      const result = await addForecastEvent(
        JSON.stringify({
          name: form.name || template.name,
          icon: template.icon,
          kind: template.kind,
          affects: template.affects,
          year: Number(form.year),
          endYear: form.endYear ? Number(form.endYear) : null,
          amount: Number(form.amount),
          currency: form.currency,
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-[480px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">
            {template ? `New event: ${template.name}` : "New event"}
          </h2>
          <button onClick={onClose} className="cursor-pointer text-muted hover:text-ink">
            <X size={17} />
          </button>
        </div>
        {!template ? (
          <div className="flex flex-col gap-1.5">
            {EVENT_TEMPLATES.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTemplate(t);
                  setForm((f) => ({ ...f, name: t.key === "custom" ? "" : t.name }));
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-left hover:border-accent hover:bg-accent-soft/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-active text-[16px]">
                  {t.icon}
                </span>
                <span>
                  <span className="block text-[13.5px] font-medium">{t.name}</span>
                  <span className="block text-[12px] text-muted">{t.sub}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Name"
              className={inputCls}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}
                placeholder="Year"
                className={inputCls}
              />
              {template.kind === "yearly" ? (
                <input
                  type="number"
                  value={form.endYear}
                  onChange={(e) => setForm((f) => ({ ...f, endYear: e.target.value }))}
                  placeholder="End year (optional)"
                  className={inputCls}
                />
              ) : (
                <span />
              )}
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder={
                  template.kind === "yearly" ? "Amount per year" : "One-time amount"
                }
                className={inputCls}
              />
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className={selectCls}
              >
                <option value="ILS">₪ ILS</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
            <p className="text-[12px] text-faint">
              {template.affects === "income"
                ? "Adds to income in the chosen year(s)."
                : "Adds to expenses in the chosen year(s)."}
            </p>
            {error ? <p className="text-[13px] text-neg">{error}</p> : null}
            <div className="flex justify-between">
              <button className={buttonCls("ghost")} onClick={() => setTemplate(null)}>
                Back
              </button>
              <button className={buttonCls("primary")} disabled={pending} onClick={save}>
                {pending ? "Adding…" : "Add event"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AssumptionsPanel({
  members,
  incomes,
  settings,
  actualExpenses,
  currencies,
  onClose,
}: {
  members: ForecastMember[];
  incomes: ForecastIncome[];
  settings: Settings;
  actualExpenses: Record<string, number>;
  currencies: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inflation, setInflation] = useState(settings.inflationPct);
  const [ret, setRet] = useState(settings.returnPct);
  const [useActual, setUseActual] = useState(settings.useActualExpenses);
  const [futureValues, setFutureValues] = useState<"today" | "nominal">(
    settings.futureValues,
  );
  const [override, setOverride] = useState<Record<string, string>>(
    Object.fromEntries(
      currencies.map((c) => [c, String(settings.expensesOverride[c] ?? actualExpenses[c] ?? 0)]),
    ),
  );
  const [srcs, setSrcs] = useState(
    incomes.map((i) => ({
      name: i.name,
      yearlyAmount: i.yearlyAmount,
      currency: i.currency,
      memberUserId: i.memberUserId,
    })),
  );
  const [retYears, setRetYears] = useState<Record<string, number>>(
    Object.fromEntries(
      members.map((m) => [m.userId, m.retirementYear ?? new Date().getFullYear() + 30]),
    ),
  );

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateAssumptions(
        JSON.stringify({
          inflationPct: inflation,
          returnPct: ret,
          useActualExpenses: useActual,
          futureValues,
          expensesOverride: Object.fromEntries(
            Object.entries(override).map(([k, v]) => [k, Number(v) || 0]),
          ),
          incomes: srcs,
          retirementYears: Object.entries(retYears).map(([userId, retirementYear]) => ({
            userId,
            retirementYear,
          })),
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="h-fit">
      <CardHeader
        title="Edit assumptions"
        right={
          <button onClick={onClose} className="cursor-pointer text-muted hover:text-ink">
            <X size={16} />
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-5 pb-5 text-[13px]">
        <div>
          <div className="mb-1 font-semibold">Income sources</div>
          {srcs.map((s, i) => (
            <div key={i} className="mb-1.5 grid grid-cols-[1fr_90px_64px] gap-1.5">
              <input
                value={s.name}
                onChange={(e) =>
                  setSrcs((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                className={`${inputCls} h-8`}
              />
              <input
                type="number"
                value={s.yearlyAmount || ""}
                onChange={(e) =>
                  setSrcs((p) =>
                    p.map((x, j) =>
                      j === i ? { ...x, yearlyAmount: Number(e.target.value) || 0 } : x,
                    ),
                  )
                }
                className={`${inputCls} h-8`}
              />
              <select
                value={s.currency}
                onChange={(e) =>
                  setSrcs((p) =>
                    p.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)),
                  )
                }
                className={`${selectCls} h-8`}
              >
                <option value="ILS">₪</option>
                <option value="USD">$</option>
              </select>
            </div>
          ))}
          <button
            className="cursor-pointer text-[12.5px] font-medium text-accent"
            onClick={() =>
              setSrcs((p) => [
                ...p,
                {
                  name: "Income",
                  yearlyAmount: 0,
                  currency: "ILS",
                  memberUserId: members[0]?.userId ?? null,
                },
              ])
            }
          >
            + Add new
          </button>
        </div>

        <label className="flex items-center justify-between gap-2">
          <span>
            <span className="block font-semibold">Use actual expenses</span>
            <span className="block text-[12px] text-muted">
              Last 12 months set the baseline
            </span>
          </span>
          <input
            type="checkbox"
            checked={useActual}
            onChange={(e) => setUseActual(e.target.checked)}
            className="h-4 w-4 accent-[#ee6a3c]"
          />
        </label>
        {!useActual
          ? currencies.map((c) => (
              <label key={c} className="flex items-center justify-between gap-2">
                <span className="text-muted">Yearly expenses ({c})</span>
                <input
                  type="number"
                  value={override[c] ?? ""}
                  onChange={(e) =>
                    setOverride((p) => ({ ...p, [c]: e.target.value }))
                  }
                  className={`${inputCls} h-8 w-[110px]`}
                />
              </label>
            ))
          : null}

        {members.map((m) => (
          <label key={m.userId} className="flex items-center justify-between gap-2">
            <span className="text-muted">{m.name} retires in</span>
            <input
              type="number"
              value={retYears[m.userId] ?? ""}
              onChange={(e) =>
                setRetYears((p) => ({ ...p, [m.userId]: Number(e.target.value) }))
              }
              className={`${inputCls} h-8 w-[90px]`}
            />
          </label>
        ))}

        <label className="flex items-center justify-between gap-2">
          <span className="text-muted">Yearly inflation %</span>
          <input
            type="number"
            step="0.1"
            value={inflation}
            onChange={(e) => setInflation(Number(e.target.value))}
            className={`${inputCls} h-8 w-[90px]`}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted">Investment return %</span>
          <input
            type="number"
            step="0.1"
            value={ret}
            onChange={(e) => setRet(Number(e.target.value))}
            className={`${inputCls} h-8 w-[90px]`}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted">Show future values in</span>
          <select
            value={futureValues}
            onChange={(e) => setFutureValues(e.target.value as "today" | "nominal")}
            className={`${selectCls} h-8`}
          >
            <option value="today">Today&apos;s money (recommended)</option>
            <option value="nominal">Future money</option>
          </select>
        </label>
        <p className="text-[11.5px] text-faint">
          Most plans use 2–3% inflation. Long-term stock returns average ~7%.
          Growth applies to the invested share of each currency.
        </p>

        {error ? <p className="text-neg">{error}</p> : null}
        <button className={buttonCls("primary")} disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save assumptions"}
        </button>
      </div>
    </Card>
  );
}
