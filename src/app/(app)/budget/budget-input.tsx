"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertBudget } from "../actions";

export function BudgetInput({
  month,
  categoryId,
  currency,
  value,
}: {
  month: string;
  categoryId: string;
  currency: string;
  value: number;
}) {
  const router = useRouter();
  const [local, setLocal] = useState(value === 0 ? "" : String(value));
  const [pending, startTransition] = useTransition();

  function commit() {
    const n = Number(local || 0);
    if (n === value) return;
    startTransition(async () => {
      await upsertBudget(month, categoryId, currency, n);
      router.refresh();
    });
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      step="1"
      placeholder="0"
      value={local}
      disabled={pending}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="tnum h-7 w-[96px] rounded-md border border-transparent bg-transparent px-2 text-right text-[13px] outline-none transition-colors hover:border-line-strong focus:border-accent focus:bg-card"
    />
  );
}
