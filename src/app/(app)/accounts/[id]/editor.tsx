"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import {
  deleteAccount,
  setAccountLinkedBank,
  updateAccountBalance,
} from "@/app/(app)/actions";
import { Trash2 } from "lucide-react";

export function BalanceEditor({
  accountId,
  current,
}: {
  accountId: string;
  current: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputCls}
      />
      <button
        className={buttonCls("secondary")}
        disabled={pending || Number(value) === current}
        onClick={() =>
          startTransition(async () => {
            await updateAccountBalance(accountId, Number(value));
            router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function LinkedBankSelect({
  accountId,
  current,
  banks,
}: {
  accountId: string;
  current: string | null;
  banks: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      className={`${selectCls} h-8 max-w-[180px] text-[13px]`}
      defaultValue={current ?? ""}
      disabled={pending}
      onChange={(e) => {
        const value = e.target.value;
        startTransition(async () => {
          await setAccountLinkedBank(accountId, value || null);
          router.refresh();
        });
      }}
    >
      <option value="">None</option>
      {banks.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

export function DeleteAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={buttonCls("ghost", "sm")}
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={14} /> Remove
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-[400px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[16px] font-semibold">Remove this account?</h2>
            <p className="mt-2 text-[13px] text-muted">
              It disappears from every list and total. Its transactions and
              balance history stay in the database, and syncing stops.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className={buttonCls("secondary")}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-neg px-3.5 text-[13.5px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteAccount(accountId);
                    router.push("/accounts");
                    router.refresh();
                  })
                }
              >
                {pending ? "Removing…" : "Remove account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
