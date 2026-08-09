"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonCls } from "@/components/ui";
import { CategoryPicker } from "@/components/category-picker";
import { fmtMoney, longDate } from "@/lib/format";
import type { Category, Transaction } from "@/lib/types";
import {
  receiptUrl,
  removeReceipt,
  toggleTransactionHidden,
  updateTransactionNotes,
  uploadReceipt,
} from "../actions";

const sectionHeaderCls =
  "mb-2 text-[11px] font-medium uppercase tracking-wide text-faint";

/** "1733_invoice.pdf" from ".../space/txn/1733_invoice.pdf". */
function baseName(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/^\d+_/, "");
}

const CATEGORIZED_BY_LABEL: Record<Transaction["categorized_by"], string> = {
  none: "Not categorized",
  provider: "Provider",
  rule: "Rule",
  user: "User",
};

const METHOD_LABELS: Record<NonNullable<Transaction["payment_method"]>, string> = {
  card: "Credit card",
  transfer: "Bank transfer",
  bank: "Bank",
};

function ActivityRow({
  label,
  value,
  dirAuto = false,
}: {
  label: string;
  value: string | null;
  dirAuto?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="truncate text-right" dir={dirAuto ? "auto" : undefined}>
        {value}
      </span>
    </div>
  );
}

export function TxnPeek({
  txn,
  categories,
  accountName,
  merchantName,
  categoryId,
  onSelectCategory,
  onClose,
}: {
  txn: Transaction;
  categories: Category[];
  accountName: string;
  merchantName: string;
  categoryId: string;
  onSelectCategory: (id: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const amount = Number(txn.amount);

  const [notes, setNotes] = useState(txn.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notesPending, startNotes] = useTransition();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [filesPending, startFiles] = useTransition();

  const [hidden, setHidden] = useState(txn.hide_from_reports);
  const [, startMisc] = useTransition();

  // Track external changes (e.g. the row's eye toggle) after a refresh.
  useEffect(() => setHidden(txn.hide_from_reports), [txn.hide_from_reports]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const attachments = (txn.attachments ?? []).filter(
    (p) => !removedPaths.includes(p),
  );

  function saveNotes() {
    startNotes(async () => {
      await updateTransactionNotes(txn.id, notes);
      setNotesSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setNotesSaved(false), 1800);
      router.refresh();
    });
  }

  function openReceipt(path: string) {
    // Open the window synchronously so popup blockers allow it, then point it
    // at the signed URL once the server action resolves.
    const win = window.open("", "_blank");
    receiptUrl(path).then((url) => {
      if (url) {
        if (win) win.location.href = url;
        else window.open(url, "_blank");
      } else {
        win?.close();
      }
    });
  }

  function deleteReceipt(path: string) {
    setRemovedPaths((p) => [...p, path]);
    startFiles(async () => {
      await removeReceipt(txn.id, path);
      router.refresh();
    });
  }

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("No file chosen.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    startFiles(async () => {
      const res = await uploadReceipt(txn.id, fd);
      if (res.error) {
        setUploadError(res.error);
        return;
      }
      setUploadError(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function toggleHidden() {
    const next = !hidden;
    setHidden(next);
    startMisc(async () => {
      await toggleTransactionHidden(txn.id, next);
      router.refresh();
    });
  }

  const raw = (txn as unknown as { raw?: unknown }).raw;
  const rawObj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  function rawField(key: string): string | null {
    const v = rawObj?.[key];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-ink/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        data-pop
        className="fixed inset-y-0 right-0 z-50 w-[400px] max-w-[92vw] overflow-y-auto border-l border-line bg-card shadow-pop"
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "tnum text-[22px] font-semibold",
                amount > 0 && "text-pos",
              )}
            >
              {fmtMoney(amount, txn.currency, { sign: amount > 0 })}
            </span>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="mt-1 cursor-pointer text-muted hover:text-ink"
            >
              <X size={17} />
            </button>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">{accountName}</div>
          <h2 className="mt-3 text-[16px] font-semibold" dir="auto">
            {merchantName}
          </h2>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {longDate(txn.date)}
            {txn.pending ? (
              <span className="ml-2 font-medium text-accent">Pending</span>
            ) : null}
          </div>
        </div>

        <section className="border-b border-line px-5 py-4">
          <div className={sectionHeaderCls}>Category</div>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onSelect={onSelectCategory}
          />
        </section>

        <section className="border-b border-line px-5 py-4">
          <div className={sectionHeaderCls}>Description</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Add the recipient, sender, or a reason"
            dir="auto"
            className="w-full resize-y rounded-lg border border-line-strong bg-card px-3 py-2 text-[13.5px] outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          {txn.is_transfer || txn.payment_method === "transfer" ? (
            <p className="mt-1 text-[11.5px] text-faint">
              The bank doesn&rsquo;t send the other side of a transfer — note who
              and why here.
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center justify-end gap-2">
            {notesSaved ? (
              <span className="text-[12px] font-medium text-pos">Saved</span>
            ) : null}
            <button
              type="button"
              className={buttonCls("secondary", "sm")}
              disabled={notesPending}
              onClick={saveNotes}
            >
              {notesPending ? "Saving…" : "Save"}
            </button>
          </div>
        </section>

        <section className="border-b border-line px-5 py-4">
          <div className={sectionHeaderCls}>Receipts</div>
          {attachments.length === 0 ? (
            <p className="text-[12.5px] text-muted">No receipts.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {attachments.map((path) => (
                <div key={path} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title="Open receipt"
                    onClick={() => openReceipt(path)}
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] hover:underline"
                    dir="auto"
                  >
                    {baseName(path)}
                  </button>
                  <button
                    type="button"
                    title="Remove receipt"
                    disabled={filesPending}
                    onClick={() => deleteReceipt(path)}
                    className="shrink-0 cursor-pointer rounded p-0.5 text-faint hover:text-ink disabled:opacity-50"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.pdf"
              className="min-w-0 flex-1 text-[12.5px] text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-active file:px-2 file:py-1 file:text-[12px] file:font-medium file:text-ink-soft"
            />
            <button
              type="button"
              className={buttonCls("secondary", "sm")}
              disabled={filesPending}
              onClick={upload}
            >
              {filesPending ? "Uploading…" : "Upload"}
            </button>
          </div>
          {uploadError ? (
            <p className="mt-1.5 text-[12px] text-neg">{uploadError}</p>
          ) : null}
        </section>

        <section className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="text-[13px] font-medium">Hide from reports</span>
          <button
            type="button"
            role="switch"
            aria-checked={hidden}
            onClick={toggleHidden}
            className={cn(
              "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
              hidden ? "bg-accent" : "bg-active",
            )}
          >
            <span
              className={cn(
                "absolute left-0 top-0.5 h-4 w-4 rounded-full bg-card shadow-card transition-transform",
                hidden ? "translate-x-[18px]" : "translate-x-0.5",
              )}
            />
          </button>
        </section>

        <section className="px-5 py-4">
          <div className={sectionHeaderCls}>Activity</div>
          <div className="flex flex-col gap-1.5 text-[12px] text-muted">
            <ActivityRow label="Source" value={txn.source} />
            <ActivityRow
              label="Original statement"
              value={txn.original_name}
              dirAuto
            />
            <ActivityRow
              label="Categorized by"
              value={CATEGORIZED_BY_LABEL[txn.categorized_by]}
            />
            <ActivityRow
              label="Method"
              value={txn.payment_method ? METHOD_LABELS[txn.payment_method] : null}
            />
            <ActivityRow label="Currency" value={txn.currency} />
            <ActivityRow label="Billing date" value={rawField("billingDate")} />
            <ActivityRow
              label="Cashflow date"
              value={rawField("cashflowDate")}
            />
            <ActivityRow
              label="Fixed/Variable"
              value={rawField("actualType")}
            />
            <ActivityRow
              label="Account nickname"
              value={rawField("accountNickname")}
              dirAuto
            />
          </div>
        </section>
      </aside>
    </>
  );
}
