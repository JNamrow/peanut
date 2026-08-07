"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { createGoal } from "./goal-actions";
import type { Account } from "@/lib/types";

export function AddGoalButton({
  accounts,
  primary = false,
}: {
  accounts: Account[];
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"save_up" | "pay_down">("save_up");

  const linkable = accounts.filter((a) =>
    kind === "save_up" ? !a.is_liability : a.is_liability,
  );

  return (
    <>
      <button className={buttonCls("primary")} onClick={() => setOpen(true)}>
        <Plus size={15} /> Add goal
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-[460px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Add goal</h2>
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
                  await createGoal(fd);
                  router.refresh();
                  setOpen(false);
                })
              }
              className="flex flex-col gap-2.5"
            >
              <div className="grid grid-cols-2 gap-2.5">
                <input name="name" className={inputCls} placeholder="Goal name" />
                <input name="icon" className={inputCls} placeholder="Emoji (🏖️)" maxLength={4} />
                <select
                  name="kind"
                  className={selectCls}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "save_up" | "pay_down")}
                >
                  <option value="save_up">Save up</option>
                  <option value="pay_down">Pay down debt</option>
                </select>
                <select name="currency" className={selectCls} defaultValue="ILS">
                  <option value="ILS">₪ ILS</option>
                  <option value="USD">$ USD</option>
                </select>
                <input
                  name="target_amount"
                  type="number"
                  step="1"
                  className={inputCls}
                  placeholder={kind === "save_up" ? "Target amount" : "Amount to pay off"}
                />
                <input name="target_date" type="date" className={inputCls} />
                <input
                  name="planned_monthly"
                  type="number"
                  step="1"
                  className={inputCls}
                  placeholder="Planned / month"
                />
                <select name="account_id" className={selectCls} defaultValue="">
                  <option value="">No linked account</option>
                  {linkable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[12px] text-faint">
                {kind === "save_up"
                  ? "Link a savings or investment account. Its balance becomes the goal's progress."
                  : "Link the loan or card. Progress = how much of the debt is gone."}
              </p>
              <button className={buttonCls("primary")} disabled={pending}>
                {pending ? "Adding…" : "Add goal"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
