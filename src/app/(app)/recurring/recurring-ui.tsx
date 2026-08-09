"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  buttonCls,
  inputCls,
} from "@/components/ui";
import { addMonths, fmtMoney, monthLabel, shortDate } from "@/lib/format";
import { useDismiss } from "@/components/category-picker";
import {
  CADENCE_LABELS,
  type Cadence,
  type MonthOccurrence,
  type RecurringMonth,
} from "@/lib/recurring";
import type { Category } from "@/lib/types";
import {
  runRecurringDetection,
  searchRecurringMerchants,
  setRecurringStatus,
} from "../actions";
import { RecurringModal, type RecurringDraft } from "./recurring-modal";

export interface StreamLite {
  id: string;
  merchantName: string;
  cadence: Cadence;
  typicalAmount: number;
  currency: string;
  nextExpectedDate: string | null;
  kind: "expense" | "income";
  status: "suggested" | "active" | "dismissed" | "ended";
  accountId: string | null;
  startDate: string | null;
}

export interface CardCycle {
  id: string;
  name: string;
  cycle: number;
  currency: string;
}

type MerchantResult = Awaited<
  ReturnType<typeof searchRecurringMerchants>
>["results"][number];

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Per-currency sums as "₪X · $Y" (skips zero currencies). */
function joinTotals(totals: Map<string, number>): string {
  const parts = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .map(([ccy, v]) => fmtMoney(v, ccy));
  return parts.length ? parts.join(" · ") : "—";
}

export function DetectButton({ primary = false }: { primary?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={buttonCls(primary ? "primary" : "secondary")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await runRecurringDetection();
          router.refresh();
        })
      }
    >
      <Sparkles size={14} /> {pending ? "Scanning…" : "Find recurring"}
    </button>
  );
}

// ------------------------------------------------------------------ main

export function RecurringUI({
  month,
  tab,
  data,
  streams,
  suggestions,
  cards,
  accounts,
}: {
  month: string;
  tab: "monthly" | "all";
  data: RecurringMonth;
  streams: StreamLite[];
  suggestions: StreamLite[];
  cards: CardCycle[];
  accounts: { id: string; name: string }[];
  categories?: Category[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<"expense" | "income">("expense");
  const [editDraft, setEditDraft] = useState<RecurringDraft | null>(null);

  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const streamById = useMemo(
    () => new Map(streams.map((s) => [s.id, s])),
    [streams],
  );

  function openAdd(kind: "expense" | "income") {
    setAddKind(kind);
    setAddOpen(true);
  }

  function editStream(s: StreamLite) {
    setEditDraft({
      streamId: s.id,
      merchantName: s.merchantName,
      cadence: s.cadence,
      kind: s.kind,
      amount: s.typicalAmount,
      currency: s.currency,
      startDate: s.startDate ?? localToday(),
      status: s.status === "ended" ? "ended" : "active",
    });
  }

  function editByStreamId(id: string) {
    const s = streamById.get(id);
    if (s) editStream(s);
  }

  return (
    <>
      <PageHeader
        title="Recurring"
        tabs={
          <Segmented
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "all", label: "All recurring" },
            ]}
            value={tab}
            hrefBase={`/recurring?month=${month}`}
            param="tab"
          />
        }
        right={
          <div className="flex items-center gap-1.5">
            <DetectButton />
            <button className={buttonCls("primary")} onClick={() => openAdd("expense")}>
              <Plus size={14} /> Add recurring
            </button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-6 pb-8 pt-2">
        {tab === "monthly" ? (
          <MonthlyView
            month={month}
            data={data}
            cards={cards}
            accountName={accountName}
            onAdd={openAdd}
            onEdit={editByStreamId}
          />
        ) : (
          <AllView
            streams={streams}
            suggestions={suggestions}
            onEdit={editStream}
          />
        )}
      </div>
      {addOpen ? (
        <AddRecurringModal defaultKind={addKind} onClose={() => setAddOpen(false)} />
      ) : null}
      {editDraft ? (
        <RecurringModal initial={editDraft} onClose={() => setEditDraft(null)} />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ monthly

function MonthlyView({
  month,
  data,
  cards,
  accountName,
  onAdd,
  onEdit,
}: {
  month: string;
  data: RecurringMonth;
  cards: CardCycle[];
  accountName: Map<string, string>;
  onAdd: (kind: "expense" | "income") => void;
  onEdit: (streamId: string) => void;
}) {
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);

  const cardTotals = new Map<string, number>();
  for (const c of cards) {
    cardTotals.set(c.currency, (cardTotals.get(c.currency) ?? 0) + c.cycle);
  }
  const incomeTotals = new Map<string, number>();
  const expenseTotals = new Map<string, number>();
  for (const [ccy, t] of Object.entries(data.totals)) {
    if (t.incomeTotal > 0) incomeTotals.set(ccy, t.incomeTotal);
    if (t.expenseTotal > 0) expenseTotals.set(ccy, t.expenseTotal);
  }

  const empty = data.upcoming.length === 0 && data.paid.length === 0;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-[16px] font-semibold">{monthLabel(month)}</div>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/recurring?tab=monthly&month=${prev}`}
            className={buttonCls("secondary", "sm")}
          >
            <ChevronLeft size={14} />
          </Link>
          <Link href="/recurring?tab=monthly" className={buttonCls("secondary", "sm")}>
            Today
          </Link>
          <Link
            href={`/recurring?tab=monthly&month=${next}`}
            className={buttonCls("secondary", "sm")}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      <Card className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SummaryColumn
          label="Income"
          totals={data.totals}
          field="income"
          trackCls="bg-active"
          fillCls="bg-pos"
          addLabel="Add recurring income"
          onAdd={() => onAdd("income")}
        />
        <SummaryColumn
          label="Expenses"
          totals={data.totals}
          field="expense"
          trackCls="bg-neg-soft"
          fillCls="bg-neg"
          addLabel="Add recurring expenses"
          onAdd={() => onAdd("expense")}
        />
        <div className="px-5 py-4">
          <div className="text-[13px] font-semibold">Credit cards</div>
          {cards.length === 0 ? (
            <div className="mt-2 text-[12.5px] text-muted">No credit cards.</div>
          ) : (
            <>
              <div className="mt-2 flex flex-col gap-1">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-baseline justify-between gap-3 text-[12.5px]"
                  >
                    <span className="truncate text-ink-soft" dir="auto">
                      {c.name}
                    </span>
                    <span className="tnum shrink-0">{fmtMoney(c.cycle, c.currency)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-line pt-1.5 text-[12.5px] font-semibold">
                <span>Total</span>
                <span className="tnum">{joinTotals(cardTotals)}</span>
              </div>
              <div className="mt-1 text-[11.5px] text-faint">Charges so far this cycle</div>
            </>
          )}
        </div>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            icon={<Search size={19} />}
            title="No recurring items yet."
            sub="Add merchants or approve suggestions to see them here."
            action={
              <Link
                href={`/recurring?tab=all&month=${month}`}
                className={buttonCls("secondary")}
              >
                Manage recurring
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="pb-1">
          <OccurrenceSection
            title="Upcoming"
            occurrences={data.upcoming}
            accountName={accountName}
            onEdit={onEdit}
          />
          <OccurrenceSection
            title="Paid"
            occurrences={data.paid}
            accountName={accountName}
            onEdit={onEdit}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <span className="text-[13px] font-semibold">Upcoming Total</span>
            <div className="flex flex-wrap items-center gap-5 text-[12.5px]">
              <span>
                <span className="text-faint">Income </span>
                <span className="tnum font-medium text-pos">{joinTotals(incomeTotals)}</span>
              </span>
              <span>
                <span className="text-faint">Credit cards </span>
                <span className="tnum font-medium">{joinTotals(cardTotals)}</span>
              </span>
              <span>
                <span className="text-faint">Expenses </span>
                <span className="tnum font-medium">{joinTotals(expenseTotals)}</span>
              </span>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function SummaryColumn({
  label,
  totals,
  field,
  trackCls,
  fillCls,
  addLabel,
  onAdd,
}: {
  label: string;
  totals: RecurringMonth["totals"];
  field: "income" | "expense";
  trackCls: string;
  fillCls: string;
  addLabel: string;
  onAdd: () => void;
}) {
  const rows = Object.entries(totals)
    .map(([ccy, t]) => ({
      ccy,
      paid: field === "income" ? t.incomePaid : t.expensePaid,
      total: field === "income" ? t.incomeTotal : t.expenseTotal,
    }))
    .filter((r) => r.total > 0);

  return (
    <div className="px-5 py-4">
      <div className="text-[13px] font-semibold">{label}</div>
      {rows.length === 0 ? (
        <div className="mt-2 text-[12.5px] text-muted">
          No recurring {field === "income" ? "income" : "expenses"} this month.
        </div>
      ) : (
        rows.map((r) => (
          <div key={r.ccy} className="mt-2">
            <div className={cn("h-1.5 w-full overflow-hidden rounded-full", trackCls)}>
              <div
                className={cn("h-full rounded-full", fillCls)}
                style={{ width: `${Math.min(100, (r.paid / r.total) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 text-[12px] text-muted">
              {fmtMoney(r.paid, r.ccy)} paid · {fmtMoney(Math.max(0, r.total - r.paid), r.ccy)}{" "}
              remaining
            </div>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 cursor-pointer text-[12.5px] font-medium text-accent hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

const gridCls =
  "grid grid-cols-[minmax(0,1fr)_150px_170px_120px_36px] items-center gap-3 px-5";

function OccurrenceSection({
  title,
  occurrences,
  accountName,
  onEdit,
}: {
  title: string;
  occurrences: MonthOccurrence[];
  accountName: Map<string, string>;
  onEdit: (streamId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 px-5 py-3 text-left"
      >
        <ChevronDown
          size={14}
          className={cn("text-muted transition-transform", !open && "-rotate-90")}
        />
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[12.5px] text-muted">{occurrences.length}</span>
      </button>
      {open ? (
        occurrences.length === 0 ? (
          <div className="px-5 pb-3 text-[12.5px] text-muted">
            Nothing {title === "Paid" ? "paid yet" : "upcoming"} this month.
          </div>
        ) : (
          <div className="pb-2">
            <div
              className={cn(
                gridCls,
                "pb-1 text-[11px] font-medium uppercase tracking-wide text-faint",
              )}
            >
              <div>Merchant</div>
              <div>Date</div>
              <div>Payment account</div>
              <div className="text-right">Amount</div>
              <div />
            </div>
            {occurrences.map((o) => (
              <OccurrenceRow
                key={`${o.streamId}-${o.date}-${o.txnId ?? "exp"}`}
                o={o}
                accountName={accountName}
                onEdit={onEdit}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function relDays(daysUntil: number): string {
  if (daysUntil === 0) return "(today)";
  if (daysUntil > 0) return `(in ${daysUntil} day${daysUntil === 1 ? "" : "s"})`;
  const n = -daysUntil;
  return `(${n} day${n === 1 ? "" : "s"} ago)`;
}

function OccurrenceRow({
  o,
  accountName,
  onEdit,
}: {
  o: MonthOccurrence;
  accountName: Map<string, string>;
  onEdit: (streamId: string) => void;
}) {
  return (
    <div className={cn(gridCls, "py-2.5 hover:bg-hover")}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active text-[14px]">
          🔁
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium" dir="auto">
            {o.name}
          </div>
          <div className="text-[12px] text-muted">{CADENCE_LABELS[o.cadence]}</div>
        </div>
      </div>
      <div className="text-[13px]">
        {shortDate(o.date)}{" "}
        <span className={cn("text-faint", !o.paid && o.daysUntil < 0 && "text-neg")}>
          {relDays(o.daysUntil)}
        </span>
      </div>
      <div className="truncate text-[13px] text-ink-soft" dir="auto">
        {o.accountId ? (accountName.get(o.accountId) ?? "—") : "—"}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {o.paid ? <Check size={13} className="shrink-0 text-pos" /> : null}
        <span
          className={cn(
            "tnum text-[13.5px] font-medium",
            o.kind === "income" && "text-pos",
          )}
        >
          {fmtMoney(o.amount, o.currency)}
        </span>
      </div>
      <RowMenu onEdit={() => onEdit(o.streamId)} />
    </div>
  );
}

function RowMenu({ onEdit }: { onEdit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Actions"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-active hover:text-ink"
      >
        <Ellipsis size={15} />
      </button>
      {open ? (
        <div
          data-pop
          className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-line bg-card p-1 shadow-pop"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
          >
            <Pencil size={13} /> Edit
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ all

function AllView({
  streams,
  suggestions,
  onEdit,
}: {
  streams: StreamLite[];
  suggestions: StreamLite[];
  onEdit: (s: StreamLite) => void;
}) {
  const router = useRouter();
  const [handled, setHandled] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const visible = suggestions.filter((s) => !handled.includes(s.id));
  const active = streams.filter((s) => s.status === "active");
  const ended = streams.filter((s) => s.status === "ended");

  function resolve(id: string, status: "active" | "dismissed") {
    // Optimistic: drop the row instantly, then persist.
    setHandled((h) => [...h, id]);
    startTransition(async () => {
      await setRecurringStatus(id, status);
      router.refresh();
    });
  }

  return (
    <>
      {visible.length > 0 ? (
        <Card>
          <SectionLabel title="Suggested" count={visible.length} />
          <div className="px-2 pb-2">
            {visible.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover"
              >
                <StreamCell s={s} />
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-[13.5px] font-medium">
                    {fmtMoney(s.typicalAmount, s.currency)}
                  </span>
                  <button
                    type="button"
                    className={buttonCls("primary", "sm")}
                    onClick={() => resolve(s.id, "active")}
                  >
                    <Check size={13} /> Approve
                  </button>
                  <button
                    type="button"
                    className={buttonCls("secondary", "sm")}
                    onClick={() => resolve(s.id, "dismissed")}
                  >
                    <X size={13} /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionLabel title="Active" count={active.length} />
        <div className="px-2 pb-2">
          {active.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={19} />}
              title="No recurring items yet"
              sub="Press Find recurring to scan your transactions, or Add recurring to create one by hand."
            />
          ) : (
            active.map((s) => <StreamRow key={s.id} s={s} onEdit={onEdit} />)
          )}
        </div>
      </Card>

      {ended.length > 0 ? (
        <Card>
          <SectionLabel title="Canceled" count={ended.length} />
          <div className="px-2 pb-2">
            {ended.map((s) => (
              <StreamRow key={s.id} s={s} onEdit={onEdit} />
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function SectionLabel({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 px-5 pb-1 pt-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <span className="text-[13px] text-muted">{count}</span>
    </div>
  );
}

function StreamCell({ s }: { s: StreamLite }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active text-[14px]">
        🔁
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium" dir="auto">
          {s.merchantName}
        </div>
        <div className="text-[12px] text-muted">
          {CADENCE_LABELS[s.cadence]}
          {s.nextExpectedDate && s.status !== "ended"
            ? ` · next ${shortDate(s.nextExpectedDate)}`
            : ""}
        </div>
      </div>
    </div>
  );
}

function StreamRow({
  s,
  onEdit,
}: {
  s: StreamLite;
  onEdit: (s: StreamLite) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover">
      <StreamCell s={s} />
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "tnum text-[13.5px] font-medium",
            s.kind === "income" && "text-pos",
          )}
        >
          {fmtMoney(s.typicalAmount, s.currency)}
        </span>
        <button
          type="button"
          title="Edit"
          onClick={() => onEdit(s)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-active hover:text-ink"
        >
          <Pencil size={14} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ add flow

function AddRecurringModal({
  defaultKind,
  onClose,
}: {
  defaultKind: "expense" | "income";
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MerchantResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<RecurringDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const term = q.trim();
    if (timer.current) clearTimeout(timer.current);
    if (term.length < 3) {
      setResults(null);
      setError(null);
      return;
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await searchRecurringMerchants(term);
        if (res.error) {
          setError(res.error);
          return;
        }
        setError(null);
        setResults(res.results);
      });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (draft) {
    return <RecurringModal initial={draft} onClose={onClose} />;
  }

  function pick(r: MerchantResult) {
    setDraft({
      streamId: r.streamId,
      merchantName: r.name,
      amount: r.typicalAmount,
      currency: r.currency,
      kind: defaultKind,
      startDate: r.lastDate,
      cadence: "monthly",
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        data-pop
        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card shadow-pop"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold">Add recurring</h2>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="cursor-pointer text-muted hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>
        <div className="px-5 pb-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Enter 3 characters or more..."
            dir="auto"
            className={inputCls}
          />
        </div>
        <div className="max-h-[320px] min-h-[220px] overflow-y-auto px-2 pb-3">
          {q.trim().length < 3 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <Search size={20} className="mb-1 text-faint" />
              <div className="text-[13.5px] font-semibold">Search for a merchant</div>
              <div className="max-w-[280px] text-[12.5px] text-muted">
                Enter a search term above to find merchants with recurring transactions.
              </div>
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-neg">{error}</div>
          ) : results === null || (pending && results.length === 0) ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">
              No merchants found.
            </div>
          ) : (
            results.map((r) => (
              <button
                type="button"
                key={r.name}
                onClick={() => pick(r)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium" dir="auto">
                      {r.name}
                    </span>
                    {r.streamId ? (
                      <span className="shrink-0 rounded-full bg-active px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        Recurring
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[12px] text-muted">
                    {r.count} transaction{r.count === 1 ? "" : "s"} · last{" "}
                    {shortDate(r.lastDate)}
                  </div>
                </div>
                <span className="tnum shrink-0 text-[13.5px] font-medium">
                  {fmtMoney(r.typicalAmount, r.currency)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
