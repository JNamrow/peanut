"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonCls, inputCls } from "@/components/ui";
import { deleteAccount, updateAccountBalance } from "../../actions";
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

export function DeleteAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={buttonCls("ghost", "sm")}
      disabled={pending}
      onClick={() => {
        if (!confirm("Remove this account? Its history stays in the database.")) return;
        startTransition(async () => {
          await deleteAccount(accountId);
          router.push("/accounts");
          router.refresh();
        });
      }}
    >
      <Trash2 size={14} /> Remove
    </button>
  );
}
