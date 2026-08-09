"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, EyeOff, Funnel, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { CategoryPicker, useDismiss } from "@/components/category-picker";
import { TxnPeek } from "./txn-peek";
import { fmtMoney, longDate, shortDate } from "@/lib/format";
import type { Account, Category, Transaction } from "@/lib/types";
import {
  applyCategoryScope,
  addManualTransaction,
  renameMerchant,
  setTransactionCategory,
  toggleTransactionHidden,
} from "../actions";

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ------------------------------------------------------------------ filters

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DatePreset {
  name: string;
  from: string; // "" = unbounded
  to: string;
}

function datePresets(): DatePreset[] {
  const now = new Date();
  const today = ymdLocal(now);
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return ymdLocal(d);
  };
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { name: "Last 7 days", from: daysAgo(6), to: today },
    { name: "Last 14 days", from: daysAgo(13), to: today },
    { name: "Last 30 days", from: daysAgo(29), to: today },
    {
      name: "This month",
      from: ymdLocal(new Date(y, m, 1)),
      to: ymdLocal(new Date(y, m + 1, 0)),
    },
    {
      name: "Last month",
      from: ymdLocal(new Date(y, m - 1, 1)),
      to: ymdLocal(new Date(y, m, 0)),
    },
    { name: "This year", from: `${y}-01-01`, to: `${y}-12-31` },
    { name: "Last year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    { name: "All time", from: "", to: "" },
  ];
}

function rangeChipLabel(
  presets: DatePreset[],
  from?: string,
  to?: string,
): string {
  if (from && to) {
    const hit = presets.find((p) => p.from === from && p.to === to);
    if (hit) return hit.name;
    return `${shortDate(from)} – ${shortDate(to)}`;
  }
  if (from) return `From ${shortDate(from)}`;
  if (to) return `Until ${shortDate(to)}`;
  return "All time";
}

type FilterKey = "q" | "account" | "category" | "flow" | "range";
type FilterDraft = { q: string; account: string; category: string; flow: string; from: string; to: string };

const FLOW_OPTIONS = [
  { value: "", label: "All" },
  { value: "in", label: "Income" },
  { value: "out", label: "Expenses" },
] as const;

export function TxnFilters({
  accounts,
  categories,
  current,
  total,
}: {
  accounts: Account[];
  categories: Category[];
  current: Record<string, string | undefined>;
  total: number;
}) {
  const router = useRouter();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>({
    q: "",
    account: "",
    category: "",
    flow: "",
    from: "",
    to: "",
  });
  const presets = useMemo(() => datePresets(), []);

  useDismiss(anchorRef, open, () => setOpen(false));

  function openPopover() {
    setDraft({
      q: current.q ?? "",
      account: current.account ?? "",
      category: current.category ?? "",
      flow: current.flow ?? "",
      from: current.from ?? "",
      to: current.to ?? "",
    });
    setOpen(true);
  }

  function push(next: Record<string, string | undefined>) {
    router.push(`/transactions${buildQuery(next)}`);
  }

  function apply() {
    push({
      q: draft.q.trim() || undefined,
      account: draft.account || undefined,
      category: draft.category || undefined,
      flow: draft.flow || undefined,
      from: draft.from || undefined,
      to: draft.to || undefined,
    });
    setOpen(false);
  }

  function clear() {
    router.push("/transactions");
    setOpen(false);
  }

  function removeChip(key: FilterKey) {
    push({
      q: key === "q" ? undefined : current.q,
      account: key === "account" ? undefined : current.account,
      category: key === "category" ? undefined : current.category,
      flow: key === "flow" ? undefined : current.flow,
      from: key === "range" ? undefined : current.from,
      to: key === "range" ? undefined : current.to,
    });
  }

  const chips: { key: FilterKey; label: string }[] = [];
  if (current.q) chips.push({ key: "q", label: `“${current.q}”` });
  if (current.account) {
    const a = accounts.find((x) => x.id === current.account);
    chips.push({ key: "account", label: a?.name ?? "Account" });
  }
  if (current.category) {
    const c = categories.find((x) => x.id === current.category);
    chips.push({
      key: "category",
      label: c ? `${c.icon ? `${c.icon} ` : ""}${c.name}` : "Category",
    });
  }
  if (current.flow === "in" || current.flow === "out") {
    chips.push({
      key: "flow",
      label: current.flow === "in" ? "Income" : "Expenses",
    });
  }
  if (current.from || current.to) {
    chips.push({
      key: "range",
      label: rangeChipLabel(presets, current.from, current.to),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
      <div ref={anchorRef} className="relative">
        <button
          type="button"
          className={buttonCls("secondary")}
          onClick={() => (open ? setOpen(false) : openPopover())}
        >
          <Funnel size={14} /> Filters
        </button>

        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-[400px] rounded-card border border-line bg-card p-3 shadow-pop">
            <div className="flex flex-col gap-2.5">
              <input
                value={draft.q}
                onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply();
                }}
                placeholder="Search merchant"
                dir="auto"
                className={inputCls}
              />
              <select
                className={`${selectCls} w-full`}
                value={draft.account}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, account: e.target.value }))
                }
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                className={`${selectCls} w-full`}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-0.5 rounded-lg bg-active p-0.5">
                {FLOW_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, flow: o.value }))}
                    className={cn(
                      "flex-1 cursor-pointer rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                      draft.flow === o.value
                        ? "bg-card text-ink shadow-card"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-line pt-2.5">
                <div className="grid grid-cols-[125px_1fr] gap-3">
                  <div className="flex flex-col items-stretch gap-0.5">
                    {presets.map((p) => {
                      const active = draft.from === p.from && draft.to === p.to;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() =>
                            setDraft((d) => ({ ...d, from: p.from, to: p.to }))
                          }
                          className={cn(
                            "cursor-pointer rounded-md px-2 py-1 text-left text-[12.5px]",
                            active
                              ? "font-semibold text-accent"
                              : "text-ink-soft hover:bg-hover",
                          )}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-faint">
                          Start date
                        </label>
                        <button
                          type="button"
                          className="cursor-pointer text-[11px] text-muted hover:text-ink"
                          onClick={() => setDraft((d) => ({ ...d, from: "" }))}
                        >
                          Clear
                        </button>
                      </div>
                      <input
                        type="date"
                        value={draft.from}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, from: e.target.value }))
                        }
                        className={cn(inputCls, "h-8 text-[13px]")}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-faint">
                          End date
                        </label>
                        <button
                          type="button"
                          className="cursor-pointer text-[11px] text-muted hover:text-ink"
                          onClick={() => setDraft((d) => ({ ...d, to: "" }))}
                        >
                          Clear
                        </button>
                      </div>
                      <input
                        type="date"
                        value={draft.to}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, to: e.target.value }))
                        }
                        className={cn(inputCls, "h-8 text-[13px]")}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <button type="button" className={buttonCls("ghost", "sm")} onClick={clear}>
                  Clear
                </button>
                <button type="button" className={buttonCls("primary", "sm")} onClick={apply}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-active px-2 py-1 text-[12px] font-medium text-ink-soft"
        >
          <span className="truncate" dir="auto">
            {chip.label}
          </span>
          <button
            type="button"
            title="Remove filter"
            onClick={() => removeChip(chip.key)}
            className="shrink-0 cursor-pointer text-faint hover:text-ink"
          >
            <X size={12} />
          </button>
        </span>
      ))}

      <span className="ml-auto text-[12.5px] text-muted">
        {total.toLocaleString()} transactions
      </span>
    </div>
  );
}

// -------------------------------------------------------------------- table

export function TxnTable({
  txns,
  accounts,
  categories,
  displayCurrency,
  usdIls,
  page,
  pageSize,
  total,
  params,
}: {
  txns: Transaction[];
  accounts: Account[];
  categories: Category[];
  displayCurrency: string;
  usdIls: number;
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of txns) {
      const arr = m.get(t.date) ?? [];
      arr.push(t);
      m.set(t.date, arr);
    }
    return [...m.entries()];
  }, [txns]);
  void displayCurrency;
  void usdIls;

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="pb-2">
      {groups.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">
          No transactions match.
        </p>
      ) : (
        groups.map(([date, list]) => {
          const perCcy = new Map<string, number>();
          for (const t of list) {
            perCcy.set(t.currency, (perCcy.get(t.currency) ?? 0) + Number(t.amount));
          }
          const dayTotals = ["ILS", "USD", ...[...perCcy.keys()].filter((c) => c !== "ILS" && c !== "USD")]
            .filter((c) => perCcy.has(c))
            .map((c) => ({ ccy: c, v: perCcy.get(c)! }));
          return (
            <div key={date}>
              <div className="flex items-center justify-between bg-bg/70 px-4 py-1.5">
                <span className="text-[12px] font-medium text-muted">
                  {longDate(date)}
                </span>
                <span className="flex items-center gap-2.5">
                  {dayTotals.map((d) => (
                    <span key={d.ccy} className="tnum text-[12px] text-muted">
                      {fmtMoney(d.v, d.ccy, { sign: d.v > 0 })}
                    </span>
                  ))}
                </span>
              </div>
              {list.map((t) => (
                <TxnRow
                  key={t.id}
                  txn={t}
                  account={accountById.get(t.account_id)}
                  categories={categories}
                />
              ))}
            </div>
          );
        })
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2 py-3 text-[13px]">
          {page > 1 ? (
            <a
              className={buttonCls("secondary", "sm")}
              href={`/transactions${buildQuery({ ...params, page: String(page - 1) })}`}
            >
              ← Newer
            </a>
          ) : null}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a
              className={buttonCls("secondary", "sm")}
              href={`/transactions${buildQuery({ ...params, page: String(page + 1) })}`}
            >
              Older →
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const METHOD_LABELS: Record<NonNullable<Transaction["payment_method"]>, string> = {
  card: "Credit card",
  transfer: "Bank transfer",
  bank: "Bank",
};

function TxnRow({
  txn,
  account,
  categories,
}: {
  txn: Transaction;
  account?: Account;
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [localCat, setLocalCat] = useState(txn.category_id ?? "");
  // Set only after a successful rename, so applyAll renames on sibling rows
  // still show fresh server data after refresh.
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const merchantRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Category id waiting for a "how far should this apply?" choice.
  const [scopeFor, setScopeFor] = useState<string | null>(null);
  const [amountOnly, setAmountOnly] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [applyAll, setApplyAll] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const cat = categories.find((c) => c.id === localCat);
  const amount = Number(txn.amount);
  const name = nameOverride ?? txn.name;

  useDismiss(merchantRef, editorOpen, () => setEditorOpen(false));
  useDismiss(scopeRef, scopeFor !== null, () => setScopeFor(null));

  // Shared by the row's picker and the side peek so both stay in sync.
  function selectCategory(id: string) {
    const changed = id !== "" && id !== localCat;
    setLocalCat(id);
    startTransition(async () => {
      await setTransactionCategory(txn.id, id);
      router.refresh();
    });
    if (changed) setAmountOnly(false);
    setScopeFor(changed ? id : null);
  }

  function applyScope(future: boolean, historical: boolean) {
    const catId = scopeFor;
    if (!catId) return;
    setScopeFor(null);
    startTransition(async () => {
      await applyCategoryScope(txn.id, catId, { future, historical, amountOnly });
      router.refresh();
    });
  }

  function openEditor() {
    setDraftName(name);
    setApplyAll(true);
    setNameError(null);
    setEditorOpen(true);
  }

  function saveName() {
    const next = draftName.trim();
    if (!next) {
      setNameError("Name is required");
      return;
    }
    if (next === name) {
      setEditorOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await renameMerchant(txn.id, next, applyAll);
      if (res.error) {
        setNameError(res.error);
        return;
      }
      setNameOverride(next);
      setEditorOpen(false);
      router.refresh();
    });
  }

  return (
    <div
      className={`group grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_150px] items-center gap-3 border-t border-line px-4 py-2 hover:bg-hover ${txn.hide_from_reports ? "opacity-45 has-[[data-pop]]:opacity-100" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-active text-[13px]">
          {cat?.icon ?? "💸"}
        </span>
        <div ref={merchantRef} className="relative min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              title="Edit merchant name"
              onClick={() => (editorOpen ? setEditorOpen(false) : openEditor())}
              className="min-w-0 cursor-pointer truncate text-left text-[13.5px] font-medium hover:underline"
              dir="auto"
            >
              {name}
            </button>
            <button
              type="button"
              title={`All transactions from “${name}”`}
              onClick={() =>
                router.push(`/transactions?q=${encodeURIComponent(name)}`)
              }
              className="invisible shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink group-hover:visible"
            >
              <ChevronRight size={13.5} />
            </button>
          </div>
          {txn.pending ? (
            <span className="text-[11px] font-medium text-accent">Pending</span>
          ) : null}
          {txn.notes ? (
            <div className="truncate text-[11px] text-muted" dir="auto">
              {txn.notes}
            </div>
          ) : null}

          {editorOpen ? (
            <div
              data-pop
              className="absolute left-0 top-full z-50 mt-1 w-[270px] rounded-card border border-line bg-card p-3 shadow-pop"
            >
              <div className="flex flex-col gap-2.5">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                  }}
                  dir="auto"
                  className={cn(inputCls, "h-8 text-[13px]")}
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={applyAll}
                    onChange={(e) => setApplyAll(e.target.checked)}
                    className="accent-accent"
                  />
                  Apply to all transactions with this name
                </label>
                {nameError ? (
                  <p className="text-[12px] text-neg">{nameError}</p>
                ) : null}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className={buttonCls("ghost", "sm")}
                    onClick={() => setEditorOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={buttonCls("primary", "sm")}
                    disabled={pending}
                    onClick={saveName}
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-w-0 items-center gap-1">
        <CategoryPicker
          categories={categories}
          value={localCat}
          disabled={pending}
          onSelect={selectCategory}
        />
        {localCat ? (
          <button
            type="button"
            title={cat ? `All ${cat.name} transactions` : "All in this category"}
            onClick={() => router.push(`/transactions?category=${localCat}`)}
            className="invisible shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink group-hover:visible"
          >
            <ChevronRight size={14} />
          </button>
        ) : null}

        {scopeFor ? (
          <div
            ref={scopeRef}
            data-pop
            className="absolute left-0 top-full z-50 mt-1 w-[264px] rounded-card border border-line bg-card p-1.5 shadow-pop"
          >
            <p className="px-2 pb-1 pt-1 text-[12px] text-muted" dir="auto">
              Use “{categories.find((c) => c.id === scopeFor)?.name ?? "this"}”
              for <span className="font-medium text-ink">{name}</span>:
            </p>
            <label className="flex cursor-pointer items-center gap-1.5 px-2 pb-1.5 text-[12.5px] text-ink-soft">
              <input
                type="checkbox"
                checked={amountOnly}
                onChange={(e) => setAmountOnly(e.target.checked)}
                className="accent-accent"
              />
              Only when the amount is {fmtMoney(Math.abs(amount), txn.currency)}
            </label>
            {(
              [
                ["Only this transaction", null],
                ["All future transactions", [true, false]],
                ["Future + all past transactions", [true, true]],
              ] as [string, [boolean, boolean] | null][]
            ).map(([label, opt]) => (
              <button
                key={label}
                type="button"
                disabled={pending}
                onClick={() =>
                  opt ? applyScope(opt[0], opt[1]) : setScopeFor(null)
                }
                className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <span className="block truncate text-[12.5px] text-muted">
          {account?.name ?? "—"}
        </span>
        {txn.payment_method ? (
          <span className="block truncate text-[11px] text-faint">
            {METHOD_LABELS[txn.payment_method]}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          title={txn.hide_from_reports ? "Show in reports" : "Hide from reports"}
          className="invisible cursor-pointer text-faint hover:text-ink group-hover:visible"
          onClick={() =>
            startTransition(async () => {
              await toggleTransactionHidden(txn.id, !txn.hide_from_reports);
              router.refresh();
            })
          }
        >
          <EyeOff size={13.5} />
        </button>
        <span
          className={`tnum text-[13.5px] font-medium ${amount > 0 ? "text-pos" : ""}`}
        >
          {fmtMoney(amount, txn.currency, { sign: amount > 0 })}
        </span>
        <button
          type="button"
          title="Transaction details"
          onClick={() => setPeekOpen(true)}
          className="invisible shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink group-hover:visible"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {peekOpen ? (
        <TxnPeek
          txn={txn}
          categories={categories}
          accountName={account?.name ?? "—"}
          merchantName={name}
          categoryId={localCat}
          onSelectCategory={selectCategory}
          onClose={() => setPeekOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------- add

export function AddTransactionButton({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: Category[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button className={buttonCls("primary")} onClick={() => setOpen(true)}>
        <Plus size={15} /> Add
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-[440px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Add transaction</h2>
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer text-muted hover:text-ink"
              >
                <X size={17} />
              </button>
            </div>
            <form
              action={(fd) =>
                startTransition(async () => {
                  await addManualTransaction(fd);
                  router.refresh();
                  setOpen(false);
                })
              }
              className="flex flex-col gap-2.5"
            >
              <input name="name" className={inputCls} placeholder="Merchant / description" />
              <div className="grid grid-cols-2 gap-2.5">
                <input name="amount" type="number" step="0.01" className={inputCls} placeholder="Amount" />
                <select name="kind" className={selectCls} defaultValue="expense">
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <input
                  name="date"
                  type="date"
                  className={inputCls}
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
                <select name="account_id" className={selectCls}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <select name="category_id" className={selectCls} defaultValue="">
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              <button className={buttonCls("primary")} disabled={pending || accounts.length === 0}>
                {pending ? "Adding…" : "Add transaction"}
              </button>
              {accounts.length === 0 ? (
                <p className="text-[12.5px] text-muted">Add an account first.</p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
