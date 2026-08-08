"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import { buttonCls, Card, CardHeader, PageHeader, inputCls, selectCls } from "@/components/ui";
import {
  EVENT_TEMPLATES,
  type ForecastEvent,
  type ForecastIncome,
  type ForecastMember,
  type ForecastResult,
} from "@/lib/forecast";
import {
  addForecastEvent,
  deleteForecastEvent,
  updateAssumptions,
} from "./forecast-actions";

const ILS_COLOR = "#1a9a5c";
const USD_COLOR = "#63b3d9";
const AXIS = { fontSize: 11, fill: "#a5a39e" };

interface Settings {
  inflationPct: number;
  returnPct: number;
  useActualExpenses: boolean;
  expensesOverride: Record<string, number | null>;
}

export function ForecastView({
  result,
  currencies,
  members,
  incomes,
  events,
  settings,
  actualExpenses,
}: {
  result: ForecastResult;
  currencies: string[];
  members: ForecastMember[];
  incomes: ForecastIncome[];
  events: ForecastEvent[];
  settings: Settings;
  actualExpenses: Record<string, number>;
}) {
  const [tab, setTab] = useState<"accounts" | "cashflow" | "events">("accounts");
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);

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

  const yearCols = useMemo(() => {
    const all = chartData.map((d) => d.year);
    return all;
  }, [chartData]);

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
            <button className={buttonCls("secondary")} onClick={() => setAssumptionsOpen((v) => !v)}>
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
          assumptionsOpen && "xl:grid-cols-[1fr_340px]",
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
                    value={fmtMoney(s.eoy, ccy, { compact: true })}
                  />
                );
              })}
              {currencies.map((ccy) => {
                const s = statFor(ccy);
                return (
                  <StatCell
                    key={`${ccy}-end`}
                    label={`${ccy === "ILS" ? "₪" : "$"} at ${result.retirementYear ? "retirement" : "end"}`}
                    value={
                      result.retirementYear && s.atRetire != null
                        ? fmtMoney(s.atRetire, ccy, { compact: true })
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
              {tab !== "events" ? (
                <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-card py-1.5 pr-3 text-left font-medium text-muted">
                        {tab === "accounts" ? "Net worth" : "Cash flow"}
                      </th>
                      {yearCols.map((y) => (
                        <th key={y} className="tnum px-2 py-1.5 text-right font-medium text-muted">
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currencies.map((ccy) =>
                      tab === "accounts" ? (
                        <tr key={ccy} className="border-t border-line">
                          <td className="sticky left-0 bg-card py-1.5 pr-3 font-semibold">
                            {ccy === "ILS" ? "₪ ILS" : "$ USD"}
                          </td>
                          {(result.byCurrency[ccy] ?? []).map((r) => (
                            <td key={r.year} className="tnum px-2 py-1.5 text-right">
                              {fmtMoney(r.netWorth, ccy, { compact: true })}
                            </td>
                          ))}
                        </tr>
                      ) : (
                        [
                          ["Income", "income"],
                          ["Expenses", "expenses"],
                          ["Savings", "savings"],
                        ].map(([label, key]) => (
                          <tr key={`${ccy}-${key}`} className="border-t border-line">
                            <td className="sticky left-0 bg-card py-1.5 pr-3 font-semibold">
                              {ccy === "ILS" ? "₪" : "$"} {label}
                            </td>
                            {(result.byCurrency[ccy] ?? []).map((r) => (
                              <td
                                key={r.year}
                                className={cn(
                                  "tnum px-2 py-1.5 text-right",
                                  key === "savings" &&
                                    (r.savings >= 0 ? "text-pos" : "text-neg"),
                                )}
                              >
                                {fmtMoney(
                                  r[key as "income" | "expenses" | "savings"],
                                  ccy,
                                  { compact: true },
                                )}
                              </td>
                            ))}
                          </tr>
                        ))
                      ),
                    )}
                  </tbody>
                </table>
              ) : (
                <EventList events={events} />
              )}
            </div>
          </Card>
        </div>

        {assumptionsOpen ? (
          <AssumptionsPanel
            members={members}
            incomes={incomes}
            settings={settings}
            actualExpenses={actualExpenses}
            currencies={currencies}
            onClose={() => setAssumptionsOpen(false)}
          />
        ) : null}
      </div>

      {eventOpen ? <AddEventModal onClose={() => setEventOpen(false)} /> : null}
    </>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="tnum text-[19px] font-semibold">{value}</div>
      {sub ? <div className="text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

function EventList({ events }: { events: ForecastEvent[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (events.length === 0) {
    return (
      <p className="py-4 text-center text-[13px] text-muted">
        No life events yet. Add one — buy a home, have a kid, change income.
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      {events.map((ev) => (
        <div
          key={ev.id}
          className="flex items-center justify-between border-t border-line py-2 first:border-0"
        >
          <span className="flex items-center gap-2.5">
            <span className="text-[16px]">{ev.icon ?? "🎯"}</span>
            <span>
              <span className="block text-[13.5px] font-medium">{ev.name}</span>
              <span className="block text-[12px] text-muted">
                {ev.year}
                {ev.kind === "yearly"
                  ? ` – ${ev.endYear ?? "forever"} · yearly`
                  : " · one time"}
                {" · "}
                {ev.affects === "income" ? "adds income" : "adds expense"}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="tnum text-[13.5px] font-medium">
              {fmtMoney(ev.amount, ev.currency, { decimals: false })}
            </span>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteForecastEvent(ev.id);
                  router.refresh();
                })
              }
              className="cursor-pointer text-faint hover:text-neg"
              title="Delete event"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
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
