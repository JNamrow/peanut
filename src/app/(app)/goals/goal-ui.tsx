"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronLeft } from "lucide-react";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createGoals, type GoalDraft } from "./goal-actions";
import type { Account } from "@/lib/types";

const TEMPLATES: { key: string; name: string; icon: string }[] = [
  { key: "emergency", name: "Emergency fund", icon: "🧯" },
  { key: "down_payment", name: "Down payment", icon: "🏠" },
  { key: "car", name: "Car", icon: "🚗" },
  { key: "vacation", name: "Vacation", icon: "🏝️" },
  { key: "wedding", name: "Wedding", icon: "💍" },
  { key: "education", name: "Education", icon: "🎓" },
  { key: "retirement", name: "Retirement", icon: "🌴" },
  { key: "savings", name: "Savings", icon: "🌱" },
  { key: "custom", name: "Custom goal", icon: "✏️" },
];

const STEPS = ["Select", "Targets", "Plan"] as const;

export function AddGoalButton({
  accounts,
  primary = false,
}: {
  accounts: Account[];
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={buttonCls(primary ? "primary" : "primary")}
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Add goal
      </button>
      {open ? <GoalWizard accounts={accounts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function GoalWizard({
  accounts,
  onClose,
}: {
  accounts: Account[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<GoalDraft[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleTemplate(t: (typeof TEMPLATES)[number]) {
    setDrafts((prev) => {
      const has = prev.find((d) => d.name === t.name || (t.key === "custom" && d.icon === "✏️"));
      if (has) return prev.filter((d) => d !== has);
      return [
        ...prev,
        {
          name: t.key === "custom" ? "" : t.name,
          icon: t.icon,
          kind: "save_up",
          currency: "ILS",
          target_amount: null,
          target_date: null,
          planned_monthly: 0,
          account_id: null,
        },
      ];
    });
  }

  function patch(i: number, p: Partial<GoalDraft>) {
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...p } : d)));
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      const result = await createGoals(JSON.stringify(drafts));
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const savings = accounts.filter((a) => !a.is_liability);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Monarch-style stepper header */}
        <div className="relative border-b border-line">
          <div className="flex items-center justify-between px-5 py-3.5">
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="cursor-pointer text-muted hover:text-ink"
              >
                <ChevronLeft size={17} />
              </button>
            ) : (
              <span className="w-[17px]" />
            )}
            <div className="flex items-center gap-4">
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "text-[13px] font-medium",
                    i === step
                      ? "rounded-full bg-active px-2.5 py-0.5 text-ink"
                      : "text-muted",
                  )}
                >
                  {s}
                </span>
              ))}
            </div>
            <button onClick={onClose} className="cursor-pointer text-muted hover:text-ink">
              <X size={17} />
            </button>
          </div>
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-accent transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 0 ? (
            <>
              <h2 className="mb-3 text-[16px] font-semibold">Select goals to add</h2>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => {
                  const selected = drafts.some(
                    (d) => d.icon === t.icon,
                  );
                  return (
                    <button
                      key={t.key}
                      onClick={() => toggleTemplate(t)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-accent bg-accent-soft/40"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-active text-[17px]">
                        {t.icon}
                      </span>
                      <span className="text-[13.5px] font-medium">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className="mb-3 text-[16px] font-semibold">Set your goal targets</h2>
              <p className="mb-3 text-[12.5px] text-muted">
                Targets are optional. You can always add them later.
              </p>
              <div className="flex flex-col gap-4">
                {drafts.map((d, i) => (
                  <div key={i} className="rounded-lg border border-line p-3.5">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="text-[16px]">{d.icon}</span>
                      <input
                        value={d.name}
                        onChange={(e) => patch(i, { name: e.target.value })}
                        placeholder="Goal name"
                        className={`${inputCls} h-8`}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={d.currency}
                        onChange={(e) => patch(i, { currency: e.target.value })}
                        className={selectCls}
                      >
                        <option value="ILS">₪ ILS</option>
                        <option value="USD">$ USD</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Target amount"
                        value={d.target_amount ?? ""}
                        onChange={(e) =>
                          patch(i, {
                            target_amount: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className={inputCls}
                      />
                      <input
                        type="date"
                        value={d.target_date ?? ""}
                        disabled={!d.target_amount}
                        title={!d.target_amount ? "Target amount required" : ""}
                        onChange={(e) => patch(i, { target_date: e.target.value || null })}
                        className={`${inputCls} disabled:opacity-40`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className="mb-3 text-[16px] font-semibold">Plan your saving</h2>
              <p className="mb-3 text-[12.5px] text-muted">
                Link an account to count its balance toward the goal, and set a
                monthly plan to track pace.
              </p>
              <div className="flex flex-col gap-3">
                {drafts.map((d, i) => {
                  const needed =
                    d.target_amount && d.target_date
                      ? Math.max(
                          0,
                          Math.ceil(
                            d.target_amount /
                              Math.max(
                                1,
                                (new Date(d.target_date).getTime() - Date.now()) /
                                  (30.44 * 86400000),
                              ),
                          ),
                        )
                      : null;
                  return (
                    <div key={i} className="rounded-lg border border-line p-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[13.5px] font-medium">
                          {d.icon} {d.name || "New goal"}
                        </span>
                        {needed ? (
                          <span className="text-[12px] text-muted">
                            ~{needed.toLocaleString()} {d.currency}/mo needed
                          </span>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder={`Planned / month (${d.currency})`}
                          value={d.planned_monthly || ""}
                          onChange={(e) =>
                            patch(i, { planned_monthly: Number(e.target.value) || 0 })
                          }
                          className={inputCls}
                        />
                        <select
                          value={d.account_id ?? ""}
                          onChange={(e) => patch(i, { account_id: e.target.value || null })}
                          className={selectCls}
                        >
                          <option value="">No linked account</option>
                          {savings.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {error ? <p className="mt-3 text-[13px] text-neg">{error}</p> : null}
        </div>

        <div className="border-t border-line p-4">
          <button
            className={`${buttonCls("primary")} w-full`}
            disabled={pending || drafts.length === 0 || (step === 1 && drafts.some((d) => !d.name.trim()))}
            onClick={() => {
              if (step < 2) setStep((s) => s + 1);
              else finish();
            }}
          >
            {pending
              ? "Creating…"
              : step < 2
                ? `Continue${drafts.length ? ` (${drafts.length})` : ""}`
                : `Add ${drafts.length} goal${drafts.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
