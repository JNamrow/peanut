"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { CADENCE_LABELS, type Cadence } from "@/lib/recurring";
import { upsertRecurringStream } from "../actions";

export interface RecurringDraft {
  streamId?: string | null;
  merchantName: string;
  cadence?: Cadence;
  kind: "expense" | "income";
  amount: number;
  currency: string;
  startDate: string;
  status?: "active" | "ended";
  logoDomain?: string | null;
}

/** Merchant avatar: favicon from the stream's website, else a letter. */
export function MerchantLogo({
  name,
  domain,
  size = 34,
}: {
  name: string;
  domain: string | null | undefined;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  if (!domain || failed) {
    return (
      <span
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-full bg-active text-[13px] font-semibold text-ink-soft"
      >
        {letter}
      </span>
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-active"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
        alt=""
        width={size - 10}
        height={size - 10}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

const labelCls = "mb-1 block text-[12px] font-medium text-muted";
const hintCls = "mt-1 text-[11.5px] text-faint";

function currencySymbol(ccy: string): string {
  return ccy === "ILS" ? "₪" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : ccy === "GBP" ? "£" : ccy;
}

export function RecurringModal({
  initial,
  onClose,
}: {
  initial: RecurringDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.merchantName);
  const [isRecurring, setIsRecurring] = useState(true);
  const [cadence, setCadence] = useState<Cadence>(initial.cadence ?? "monthly");
  const [kind, setKind] = useState<"expense" | "income">(initial.kind);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : "");
  const [status, setStatus] = useState<"active" | "ended">(initial.status ?? "active");
  const [logoDomain, setLogoDomain] = useState(initial.logoDomain ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const amt = Number(amount);
    if (!name.trim()) {
      setError("Merchant name is required.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter an amount above zero.");
      return;
    }
    if (!startDate) {
      setError("Pick a starting date.");
      return;
    }
    startTransition(async () => {
      const res = await upsertRecurringStream(
        JSON.stringify({
          id: initial.streamId ?? null,
          merchantName: name.trim(),
          cadence,
          kind,
          amount: amt,
          currency: initial.currency,
          startDate,
          status: isRecurring ? status : "ended",
          logoDomain: logoDomain.trim() || null,
        }),
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        data-pop
        className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-card shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold">Recurring merchant</h2>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="cursor-pointer text-muted hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <MerchantLogo name={name} domain={logoDomain.trim() || null} size={40} />
            <div className="min-w-0 flex-1">
              <label className={labelCls}>Merchant name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!initial.streamId}
                dir="auto"
                className={cn(inputCls, initial.streamId && "opacity-60")}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Merchant website</label>
            <input
              value={logoDomain}
              onChange={(e) => setLogoDomain(e.target.value)}
              placeholder="spotify.com"
              className={inputCls}
            />
            <p className={hintCls}>
              Used to pull the logo automatically. Banks don&rsquo;t send logos,
              so this is the one field to fill by hand.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium">Mark this merchant as recurring</span>
            <button
              type="button"
              role="switch"
              aria-checked={isRecurring}
              onClick={() => setIsRecurring((v) => !v)}
              className={cn(
                "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
                isRecurring ? "bg-accent" : "bg-active",
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-0.5 h-4 w-4 rounded-full bg-card shadow-card transition-transform",
                  isRecurring ? "translate-x-[18px]" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {isRecurring ? (
            <>
              <div>
                <label className={labelCls}>Recurring frequency</label>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Cadence)}
                  className={cn(selectCls, "w-full")}
                >
                  {(Object.entries(CADENCE_LABELS) as [Cadence, string][]).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Recurring type</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "expense" | "income")}
                  className={cn(selectCls, "w-full")}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Starting date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  This date is used to forecast future transactions at this merchant.
                </p>
              </div>

              <div>
                <label className={labelCls}>Amount</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] text-muted">
                    {currencySymbol(initial.currency)}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={cn(inputCls, "pl-8")}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Recurring status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "ended")}
                  className={cn(selectCls, "w-full")}
                >
                  <option value="active">Active</option>
                  <option value="ended">Canceled</option>
                </select>
                <p className={hintCls}>
                  If you set the status to Canceled, past transactions stay on the list but no
                  future ones are forecast.
                </p>
              </div>
            </>
          ) : null}

          {error ? <p className="text-[12.5px] text-neg">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className={buttonCls("secondary")} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={buttonCls("primary")} disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
