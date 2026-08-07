"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, EyeOff } from "lucide-react";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { fmtMoney, longDate } from "@/lib/format";
import type { Account, Category, Transaction } from "@/lib/types";
import {
  addManualTransaction,
  setTransactionCategory,
  toggleTransactionHidden,
} from "../actions";

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

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
  const months = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < 18; i++) {
      out.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      );
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);

  function setParam(key: string, value: string) {
    router.push(
      `/transactions${buildQuery({ ...current, [key]: value || undefined, page: undefined })}`,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
      <input
        defaultValue={current.q ?? ""}
        placeholder="Search"
        className={`${inputCls} max-w-[200px]`}
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value);
        }}
      />
      <select
        className={selectCls}
        value={current.account ?? ""}
        onChange={(e) => setParam("account", e.target.value)}
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={current.category ?? ""}
        onChange={(e) => setParam("category", e.target.value)}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ""}
            {c.name}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={current.month ?? ""}
        onChange={(e) => setParam("month", e.target.value)}
      >
        <option value="">All time</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </option>
        ))}
      </select>
      <span className="ml-auto text-[12.5px] text-muted">
        {total.toLocaleString()} transactions
      </span>
    </div>
  );
}

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
  const cat = categories.find((c) => c.id === localCat);
  const amount = Number(txn.amount);

  return (
    <div
      className={`group grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_130px] items-center gap-3 border-t border-line px-4 py-2 hover:bg-hover ${txn.hide_from_reports ? "opacity-45" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-active text-[13px]">
          {cat?.icon ?? "💸"}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium" dir="auto">
            {txn.name}
          </div>
          {txn.pending ? (
            <span className="text-[11px] font-medium text-accent">Pending</span>
          ) : null}
        </div>
      </div>
      <select
        value={localCat}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setLocalCat(v);
          startTransition(async () => {
            await setTransactionCategory(txn.id, v);
            router.refresh();
          });
        }}
        className="h-7 max-w-[220px] cursor-pointer truncate rounded-full border border-transparent bg-active px-2.5 text-[12.5px] font-medium outline-none hover:border-line-strong"
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ""}
            {c.name}
          </option>
        ))}
      </select>
      <span className="truncate text-[12.5px] text-muted">
        {account?.name ?? "—"}
      </span>
      <div className="flex items-center justify-end gap-1.5">
        <button
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
      </div>
    </div>
  );
}

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
