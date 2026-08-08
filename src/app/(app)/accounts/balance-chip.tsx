"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { fmtMoney, shortDate } from "@/lib/format";
import { buttonCls, inputCls } from "@/components/ui";
import { updateAccountBalance } from "../actions";

/**
 * The right side of an account row.
 * - Credit cards: computed cycle balance, negative, with a "pending" clock.
 * - Bank/manual accounts: click to set or correct the balance inline.
 */
export function BalanceChip({
  accountId,
  balance,
  currency,
  type,
  anchorDate,
}: {
  accountId: string;
  balance: number | null;
  currency: string;
  type: string;
  anchorDate?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (type === "credit") {
    if (balance == null) {
      return <span className="tnum text-[13.5px] text-faint">—</span>;
    }
    const v = -Math.abs(Number(balance));
    return (
      <span
        className="flex items-center gap-1.5"
        title="This cycle's charges — not billed to the bank yet"
      >
        <Clock size={12.5} className="text-faint" />
        <span className="tnum text-[13.5px] font-medium text-ink-soft">
          {fmtMoney(v, currency)}
        </span>
      </span>
    );
  }

  function stop(e: React.SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function save(e: React.SyntheticEvent) {
    stop(e);
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    startTransition(async () => {
      await updateAccountBalance(accountId, n);
      setOpen(false);
      router.refresh();
    });
  }

  const lastSet = anchorDate ? `Set ${shortDate(anchorDate)}` : null;

  return (
    <span ref={anchorRef} className="relative" onClick={stop}>
      {balance == null ? (
        <button
          className="cursor-pointer rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent hover:text-white"
          onClick={(e) => {
            stop(e);
            setValue("");
            setOpen((v) => !v);
          }}
        >
          Set balance
        </button>
      ) : (
        <span className="flex flex-col items-end">
          <button
            className="tnum cursor-pointer rounded-md px-1 text-[13.5px] font-medium hover:bg-active"
            title={`Click to correct the balance${lastSet ? ` — ${lastSet.toLowerCase()}` : ""}`}
            onClick={(e) => {
              stop(e);
              setValue(String(balance));
              setOpen((v) => !v);
            }}
          >
            {fmtMoney(Number(balance), currency)}
          </button>
          {lastSet ? (
            <span className="text-[10.5px] text-faint">{lastSet}</span>
          ) : null}
        </span>
      )}
      {open ? (
        <span
          className="absolute right-0 top-full z-50 mt-1 flex w-[230px] flex-col gap-1.5 rounded-card border border-line bg-card p-2 shadow-pop"
          onClick={stop}
        >
          <span className="flex gap-1.5">
            <input
              autoFocus
              type="number"
              step="0.01"
              value={value}
              placeholder={`Balance (${currency})`}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(e);
                if (e.key === "Escape") setOpen(false);
              }}
              className={`${inputCls} h-8`}
            />
            <button
              className={buttonCls("primary", "sm")}
              disabled={pending}
              onClick={save}
            >
              {pending ? "…" : "Save"}
            </button>
          </span>
          {lastSet ? (
            <span className="px-0.5 text-[11px] text-faint">
              {lastSet}. Saving re-anchors from today.
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
