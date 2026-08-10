"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { inputCls } from "@/components/ui";
import { fmtMoney, shortDate } from "@/lib/format";
import { linkTransactionToStream, searchTransactionsForMatch } from "../actions";

type MatchResult = Awaited<
  ReturnType<typeof searchTransactionsForMatch>
>["results"][number];

export function MatchTxnModal({
  streamId,
  defaultQuery,
  onClose,
}: {
  streamId: string;
  defaultQuery: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startSearch] = useTransition();
  const [linking, startLink] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search; the initial run (300ms after open) covers the default query.
  useEffect(() => {
    const t = setTimeout(() => {
      startSearch(async () => {
        const res = await searchTransactionsForMatch(
          JSON.stringify({ query: q.trim(), streamId }),
        );
        if (res.error) {
          setError(res.error);
          setResults([]);
        } else {
          setError(null);
          setResults(res.results);
        }
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function link(txnId: string) {
    startLink(async () => {
      const res = await linkTransactionToStream(streamId, txnId);
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
        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card shadow-pop"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold">Mark as paid</h2>
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
            placeholder="Search transactions..."
            dir="auto"
            className={inputCls}
          />
        </div>
        <div className="max-h-[320px] min-h-[220px] overflow-y-auto px-2 pb-3">
          {error ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-neg">{error}</div>
          ) : results === null ? (
            <div className="px-4 py-10 text-center text-[13.5px] font-semibold text-muted">
              Loading…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">
              No transactions match.
            </div>
          ) : (
            results.map((r) => (
              <button
                type="button"
                key={r.id}
                disabled={linking}
                onClick={() => link(r.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover disabled:opacity-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium" dir="auto">
                    {r.name}
                  </div>
                  <div className="text-[12px] text-faint">
                    {shortDate(r.date)}
                    {r.accountName ? ` · ${r.accountName}` : ""}
                  </div>
                </div>
                <span className="tnum shrink-0 text-[13.5px] font-medium">
                  {fmtMoney(r.amount, r.currency)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
