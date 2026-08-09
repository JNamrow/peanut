"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChevronLeft, GripVertical, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import { buttonCls, Card, inputCls, selectCls } from "@/components/ui";
import type { ForecastEvent } from "@/lib/forecast";
import {
  deleteForecastEvent,
  saveSplits,
  saveWithdrawalOrder,
  updateForecastAccount,
  updateForecastEvent,
} from "./forecast-actions";
import type { AccountSetting, ForecastConfig } from "./forecast-ui";

export type PanelTarget =
  | { kind: "account"; id: string }
  | { kind: "extra" }
  | { kind: "withdrawal" }
  | { kind: "event"; id: string };

const EXTRA_OPTION = "__extra__";
const LIABILITY_TYPES = new Set(["credit", "loan", "other_liability"]);
const CHART_AXIS = { fontSize: 10, fill: "#a5a39e" };

const sym = (currency: string) => (currency === "ILS" ? "₪" : "$");

export function AccountPanel({
  kind,
  account,
  eventId,
  events,
  birthYear,
  lastAccountId,
  accounts,
  config,
  onSwitch,
  onClose,
}: {
  kind: "account" | "extra" | "withdrawal" | "event";
  account: AccountSetting | null;
  eventId?: string | null;
  events: ForecastEvent[];
  birthYear?: number | null;
  lastAccountId: string | null;
  accounts: AccountSetting[];
  config: ForecastConfig;
  onSwitch: (next: PanelTarget) => void;
  onClose: () => void;
}) {
  const event =
    kind === "event" ? (events.find((e) => e.id === eventId) ?? null) : null;
  return (
    <Card className="h-fit">
      {kind === "account" && account ? (
        <AccountView
          key={account.id}
          account={account}
          accounts={accounts}
          onSwitch={onSwitch}
          onClose={onClose}
        />
      ) : kind === "event" && event ? (
        <EventView
          key={event.id}
          event={event}
          birthYear={birthYear ?? null}
          onClose={onClose}
        />
      ) : kind === "extra" ? (
        <ExtraView
          accounts={accounts}
          config={config}
          lastAccountId={lastAccountId}
          onSwitch={onSwitch}
          onClose={onClose}
        />
      ) : kind === "withdrawal" ? (
        <WithdrawalView
          accounts={accounts}
          config={config}
          lastAccountId={lastAccountId}
          onSwitch={onSwitch}
          onClose={onClose}
        />
      ) : null}
    </Card>
  );
}

/** "Saved just now" flash after a successful auto-save. */
function useSavedFlash() {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function flash() {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2500);
  }
  return { saved, flash };
}

function PanelHeader({
  title,
  saved,
  onBack,
  onClose,
}: {
  title: string;
  saved: boolean;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-muted hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
      ) : null}
      <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
      {saved ? (
        <span className="shrink-0 text-[11px] text-faint">Saved just now</span>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="cursor-pointer text-muted hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-3">
      {title ? <div className="mb-2 font-semibold">{title}</div> : null}
      {children}
    </section>
  );
}

/* ------------------------------- Account ------------------------------- */

type GrowthUiMode = "fixed" | "variable" | "none";
type GrowthPoint = { year: number; rate: number };
interface AccountForm {
  include: boolean;
  mode: GrowthUiMode;
  pct: number;
  points: GrowthPoint[];
}

function AccountView({
  account,
  accounts,
  onSwitch,
  onClose,
}: {
  account: AccountSetting;
  accounts: AccountSetting[];
  onSwitch: (next: PanelTarget) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { saved, flash } = useSavedFlash();
  const startYear = new Date().getFullYear();
  const [form, setForm] = useState<AccountForm>({
    include: account.include,
    mode: account.growthMode === "default" ? "fixed" : account.growthMode,
    pct: account.growthPct ?? account.defaultGrowthPct,
    points: account.growthPoints,
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function persist(next: AccountForm) {
    setError(null);
    startTransition(async () => {
      const isDefault = next.mode === "fixed" && next.pct === account.defaultGrowthPct;
      const result = await updateForecastAccount(
        account.id,
        JSON.stringify({
          include: next.include,
          growthMode: next.mode === "fixed" ? (isDefault ? "default" : "fixed") : next.mode,
          growthPct: next.mode === "fixed" && !isDefault ? next.pct : null,
          growthPoints: next.points,
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      flash();
      router.refresh();
    });
  }

  function update(patch: Partial<AccountForm>, delay = 0) {
    const next = { ...form, ...patch };
    setForm(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => persist(next), delay);
  }

  function setMode(mode: GrowthUiMode) {
    if (mode === "variable" && form.points.length === 0) {
      update({ mode, points: [{ year: startYear, rate: form.pct }] });
    } else {
      update({ mode });
    }
  }

  function updatePoint(i: number, patch: Partial<GrowthPoint>) {
    update(
      { points: form.points.map((p, j) => (j === i ? { ...p, ...patch } : p)) },
      350,
    );
  }

  function addPoint() {
    const last = [...form.points].sort((a, b) => a.year - b.year).at(-1);
    update({
      points: [
        ...form.points,
        {
          year: Math.min((last?.year ?? startYear - 5) + 5, startYear + 60),
          rate: last?.rate ?? form.pct,
        },
      ],
    });
  }

  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const yearOptions = Array.from({ length: 61 }, (_, i) => startYear + i);
  const splitDisplay =
    account.splitMode === "percent"
      ? `${account.splitValue}%`
      : fmtMoney(account.splitValue, account.currency, { decimals: false });

  return (
    <>
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <select
          className={cn(selectCls, "h-8 w-full min-w-0 flex-1")}
          value={account.id}
          onChange={(e) => {
            const v = e.target.value;
            if (v === EXTRA_OPTION) onSwitch({ kind: "extra" });
            else onSwitch({ kind: "account", id: v });
          }}
        >
          <option value={EXTRA_OPTION}>Extra Savings</option>
          {currencies.map((c) => (
            <optgroup key={c} label={c === "ILS" ? "₪ ILS" : c === "USD" ? "$ USD" : c}>
              {accounts
                .filter((a) => a.currency === c)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {saved ? (
          <span className="shrink-0 text-[11px] text-faint">Saved just now</span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-muted hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-2 text-[13px]">
        <Section title="Change over time">
          <select
            className={cn(selectCls, "h-8 w-full")}
            value={form.mode}
            onChange={(e) => setMode(e.target.value as GrowthUiMode)}
          >
            <option value="fixed">Fixed rate (default)</option>
            <option value="variable">Variable rate (advanced)</option>
            <option value="none">Doesn&apos;t change</option>
          </select>

          {form.mode === "fixed" ? (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.5}
                  value={form.pct}
                  onChange={(e) => update({ pct: Number(e.target.value) }, 350)}
                  className="min-w-0 flex-1 accent-[#ee6a3c]"
                />
                <input
                  type="number"
                  step={0.1}
                  value={form.pct}
                  onChange={(e) => update({ pct: Number(e.target.value) || 0 }, 350)}
                  className={cn(inputCls, "h-8 w-[64px] px-2")}
                />
                <span className="text-[12px] text-muted">%</span>
              </div>
              {form.pct === account.defaultGrowthPct ? (
                <div className="mt-1 text-[11.5px] text-faint">(default)</div>
              ) : null}
            </>
          ) : null}

          {form.mode === "variable" ? (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {form.points.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    className={cn(selectCls, "h-8 min-w-0 flex-1")}
                    value={p.year}
                    onChange={(e) => updatePoint(i, { year: Number(e.target.value) })}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step={0.1}
                    value={p.rate}
                    onChange={(e) => updatePoint(i, { rate: Number(e.target.value) || 0 })}
                    className={cn(inputCls, "h-8 w-[64px] px-2")}
                  />
                  <span className="text-[12px] text-muted">%</span>
                  <button
                    type="button"
                    title="Remove point"
                    onClick={() =>
                      update({ points: form.points.filter((_, j) => j !== i) })
                    }
                    className="cursor-pointer text-faint hover:text-neg"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addPoint}
                className="cursor-pointer self-start text-[12.5px] font-medium text-accent"
              >
                + Add point
              </button>
              {form.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart
                    data={[...form.points].sort((a, b) => a.year - b.year)}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="year"
                      tick={CHART_AXIS}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={CHART_AXIS}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Line
                      isAnimationActive={false}
                      type="stepAfter"
                      dataKey="rate"
                      stroke="#EE6A3C"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: "#EE6A3C" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="Yearly direct contribution">
          <div className="flex items-center gap-2">
            <input
              disabled
              readOnly
              value={splitDisplay}
              className={cn(inputCls, "h-8 min-w-0 flex-1 disabled:bg-active disabled:text-muted")}
            />
            <button
              type="button"
              className={buttonCls("secondary", "sm")}
              onClick={() => onSwitch({ kind: "extra" })}
            >
              Edit
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-faint">
            How much you plan to move into this account each year, in today&apos;s
            money. It comes out of Extra savings.
          </p>
        </Section>

        <Section title="Expense withdrawal order">
          <p className="mb-2 text-[11.5px] text-faint">
            The order used to cover expenses in retirement and other events.
          </p>
          <button
            type="button"
            className={buttonCls("secondary", "sm")}
            onClick={() => onSwitch({ kind: "withdrawal" })}
          >
            Change withdrawal order
          </button>
        </Section>

        <Section title="Exclude from forecast">
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span className="text-[12px] text-muted">
              Leaves this account out of all projections.
            </span>
            <input
              type="checkbox"
              checked={!form.include}
              onChange={(e) => update({ include: !e.target.checked })}
              className="h-4 w-4 shrink-0 cursor-pointer accent-[#ee6a3c]"
            />
          </label>
        </Section>

        {error ? <p className="text-neg">{error}</p> : null}
      </div>
    </>
  );
}

/* -------------------------------- Event -------------------------------- */

interface EventForm {
  name: string;
  icon: string;
  year: number;
  endYear: string;
  amount: number;
  currency: string;
  kind: "one_time" | "yearly";
  affects: "income" | "expense";
}

function EventView({
  event,
  birthYear,
  onClose,
}: {
  event: ForecastEvent;
  birthYear: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { saved, flash } = useSavedFlash();
  const [form, setForm] = useState<EventForm>({
    name: event.name,
    icon: event.icon ?? "",
    year: event.year,
    endYear: event.endYear != null ? String(event.endYear) : "",
    amount: event.amount,
    currency: event.currency,
    kind: event.kind,
    affects: event.affects,
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function persist(next: EventForm) {
    setError(null);
    startTransition(async () => {
      const result = await updateForecastEvent(
        event.id,
        JSON.stringify({
          name: next.name.trim() || "Event",
          icon: next.icon.trim() || null,
          kind: next.kind,
          affects: next.affects,
          year: Number(next.year) || event.year,
          endYear:
            next.kind === "yearly" && next.endYear ? Number(next.endYear) : null,
          amount: Number(next.amount) || 0,
          currency: next.currency === "USD" ? "USD" : "ILS",
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      flash();
      router.refresh();
    });
  }

  function update(patch: Partial<EventForm>, delay = 0) {
    const next = { ...form, ...patch };
    setForm(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => persist(next), delay);
  }

  function del() {
    setError(null);
    startTransition(async () => {
      const result = await deleteForecastEvent(event.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const ageAt = (year: number) => (birthYear != null ? year - birthYear : null);
  const yearAge = ageAt(Number(form.year));
  const endAge = form.endYear ? ageAt(Number(form.endYear)) : null;

  return (
    <>
      <PanelHeader
        title={`${form.icon || "🎯"} ${form.name || "Event"}`}
        saved={saved}
        onClose={onClose}
      />
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2 text-[13px]">
        <Section title="Event">
          <div className="flex items-center gap-2">
            <input
              value={form.icon}
              title="Icon"
              onChange={(e) => update({ icon: e.target.value }, 500)}
              className={cn(inputCls, "h-8 w-[52px] shrink-0 px-0 text-center")}
            />
            <input
              value={form.name}
              placeholder="Name"
              onChange={(e) => update({ name: e.target.value }, 500)}
              className={cn(inputCls, "h-8 min-w-0 flex-1")}
            />
          </div>
        </Section>

        <Section title="When">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={form.year}
              onChange={(e) => update({ year: Number(e.target.value) }, 500)}
              className={cn(inputCls, "h-8 w-[90px] px-2")}
            />
            {yearAge != null ? (
              <span className="text-[12px] text-muted">(age {yearAge})</span>
            ) : null}
          </div>
          <select
            value={form.kind}
            onChange={(e) => update({ kind: e.target.value as "one_time" | "yearly" })}
            className={cn(selectCls, "mt-2 h-8 w-full")}
          >
            <option value="one_time">One time</option>
            <option value="yearly">Yearly</option>
          </select>
          {form.kind === "yearly" ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={form.endYear}
                placeholder="End year"
                onChange={(e) => update({ endYear: e.target.value }, 500)}
                className={cn(inputCls, "h-8 w-[90px] px-2")}
              />
              <span className="text-[12px] text-muted">
                {form.endYear
                  ? endAge != null
                    ? `(age ${endAge})`
                    : ""
                  : "empty = forever"}
              </span>
            </div>
          ) : null}
        </Section>

        <Section title="Amount">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={form.amount || ""}
              onChange={(e) => update({ amount: Number(e.target.value) || 0 }, 500)}
              className={cn(inputCls, "h-8 min-w-0 flex-1")}
            />
            <select
              value={form.currency}
              onChange={(e) => update({ currency: e.target.value })}
              className={cn(selectCls, "h-8 w-[64px] shrink-0")}
            >
              <option value="ILS">₪</option>
              <option value="USD">$</option>
            </select>
          </div>
          <select
            value={form.affects}
            onChange={(e) => update({ affects: e.target.value as "income" | "expense" })}
            className={cn(selectCls, "mt-2 h-8 w-full")}
          >
            <option value="income">Adds income</option>
            <option value="expense">Adds expense</option>
          </select>
        </Section>

        {error ? <p className="text-neg">{error}</p> : null}
        <button
          type="button"
          disabled={pending}
          onClick={del}
          className={cn(buttonCls("secondary"), "text-neg")}
        >
          <Trash2 size={13.5} /> Delete event
        </button>
      </div>
    </>
  );
}

/* ---------------------------- Extra savings ---------------------------- */

interface SplitRow {
  accountId: string;
  mode: "percent" | "amount";
  value: number;
}

function ExtraView({
  accounts,
  config,
  lastAccountId,
  onSwitch,
  onClose,
}: {
  accounts: AccountSetting[];
  config: ForecastConfig;
  lastAccountId: string | null;
  onSwitch: (next: PanelTarget) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { saved, flash } = useSavedFlash();
  const [enabled, setEnabled] = useState(config.splitEnabled);
  const [rows, setRows] = useState<SplitRow[]>(
    accounts.map((a) => ({
      accountId: a.id,
      mode: a.splitMode ?? "percent",
      value: a.splitValue,
    })),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function persist(nextEnabled: boolean, nextRows: SplitRow[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveSplits(
        JSON.stringify({ enabled: nextEnabled, rows: nextRows }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      flash();
      router.refresh();
    });
  }

  function update(nextEnabled: boolean, nextRows: SplitRow[], delay = 0) {
    setEnabled(nextEnabled);
    setRows(nextRows);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => persist(nextEnabled, nextRows), delay);
  }

  function updateRow(i: number, patch: Partial<SplitRow>, delay = 0) {
    update(
      enabled,
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
      delay,
    );
  }

  function moveOver(overId: string) {
    if (!dragId || dragId === overId) return;
    const from = rows.findIndex((r) => r.accountId === dragId);
    const to = rows.findIndex((r) => r.accountId === overId);
    if (from < 0 || to < 0) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRows(next);
  }

  function endDrag() {
    if (!dragId) return;
    setDragId(null);
    update(enabled, rows);
  }

  return (
    <>
      <PanelHeader
        title="Extra savings"
        saved={saved}
        onBack={() =>
          lastAccountId ? onSwitch({ kind: "account", id: lastAccountId }) : onClose()
        }
        onClose={onClose}
      />
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2 text-[13px]">
        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span className="font-semibold">Split extra savings</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => update(e.target.checked, rows)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[#ee6a3c]"
          />
        </label>
        <p className="-mt-1 text-[11.5px] text-faint">
          When you earn more than you spend, spread the extra across accounts.
          Amounts are in today&apos;s money. Order matters — each account draws from
          what remains.
        </p>

        {rows.map((r, i) => {
          const a = byId.get(r.accountId);
          if (!a) return null;
          return (
            <div
              key={r.accountId}
              draggable
              onDragStart={() => setDragId(r.accountId)}
              onDragOver={(e) => {
                e.preventDefault();
                moveOver(r.accountId);
              }}
              onDragEnd={endDrag}
              className={cn(
                "rounded-lg border border-line p-2.5",
                dragId === r.accountId && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 cursor-grab text-faint" />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {a.name}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                <input
                  type="number"
                  value={r.value}
                  onChange={(e) =>
                    updateRow(i, { value: Number(e.target.value) || 0 }, 350)
                  }
                  className={cn(inputCls, "h-8 w-[90px] px-2")}
                />
                <div className="flex overflow-hidden rounded-lg border border-line-strong">
                  {(["percent", "amount"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateRow(i, { mode: m })}
                      className={cn(
                        "cursor-pointer px-2 py-1 text-[12px]",
                        r.mode === m
                          ? "bg-active font-medium text-ink"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {m === "percent" ? "%" : sym(a.currency)}
                    </button>
                  ))}
                </div>
                {i > 0 && r.mode === "percent" ? (
                  <span className="text-[11px] text-faint">of remainder</span>
                ) : null}
              </div>
            </div>
          );
        })}

        {error ? <p className="text-neg">{error}</p> : null}
      </div>
    </>
  );
}

/* --------------------------- Withdrawal order --------------------------- */

function WithdrawalView({
  accounts,
  config,
  lastAccountId,
  onSwitch,
  onClose,
}: {
  accounts: AccountSetting[];
  config: ForecastConfig;
  lastAccountId: string | null;
  onSwitch: (next: PanelTarget) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { saved, flash } = useSavedFlash();
  const nonLiability = accounts.filter((a) => !LIABILITY_TYPES.has(a.type));
  const [order, setOrder] = useState<string[]>(() => [
    ...config.withdrawalOrder.filter((id) => nonLiability.some((a) => a.id === id)),
    ...nonLiability
      .map((a) => a.id)
      .filter((id) => !config.withdrawalOrder.includes(id)),
  ]);
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  function persist(nextOrder: string[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveWithdrawalOrder(JSON.stringify({ order: nextOrder }));
      if (result.error) {
        setError(result.error);
        return;
      }
      flash();
      router.refresh();
    });
  }

  function moveOver(overId: string) {
    if (!dragId || dragId === overId) return;
    const from = order.indexOf(dragId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrder(next);
  }

  function endDrag() {
    if (!dragId) return;
    setDragId(null);
    persist(order);
  }

  return (
    <>
      <PanelHeader
        title="Withdrawal order"
        saved={saved}
        onBack={() =>
          lastAccountId ? onSwitch({ kind: "account", id: lastAccountId }) : onClose()
        }
        onClose={onClose}
      />
      <div className="flex flex-col gap-2 px-4 pb-4 pt-2 text-[13px]">
        <p className="text-[11.5px] text-faint">
          Accounts are used top to bottom to cover shortfalls.
        </p>
        {order.map((id, i) => {
          const a = byId.get(id);
          if (!a) return null;
          return (
            <div
              key={id}
              draggable
              onDragStart={() => setDragId(id)}
              onDragOver={(e) => {
                e.preventDefault();
                moveOver(id);
              }}
              onDragEnd={endDrag}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-line p-2.5",
                dragId === id && "opacity-60",
              )}
            >
              <GripVertical size={14} className="shrink-0 cursor-grab text-faint" />
              <span className="tnum w-4 shrink-0 text-[12px] text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {a.name}
              </span>
              <span className="shrink-0 text-[11.5px] text-muted">
                {sym(a.currency)}
              </span>
            </div>
          );
        })}
        {error ? <p className="text-neg">{error}</p> : null}
      </div>
    </>
  );
}
