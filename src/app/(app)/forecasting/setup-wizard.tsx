"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import { InstitutionLogo } from "@/components/institution-logo";
import { saveForecastSetup } from "./forecast-actions";

interface WizMember {
  userId: string;
  name: string;
}
interface WizAccount {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  balance: number;
  type: string;
}
interface WizIncome {
  name: string;
  yearlyAmount: number;
  currency: string;
  memberUserId: string | null;
}

const STEPS = ["Review", "Income", "Accounts", "Retirement"];

export function SetupWizard({
  members,
  accounts,
  actualIncome,
  actualExpenses,
}: {
  members: WizMember[];
  accounts: WizAccount[];
  actualIncome: Record<string, number>;
  actualExpenses: Record<string, number>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [birthdays, setBirthdays] = useState<Record<string, string>>({});
  const [retireAges, setRetireAges] = useState<Record<string, number>>(
    Object.fromEntries(members.map((m) => [m.userId, 65])),
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // One row per person — each enters their own yearly TAKE-HOME.
  const [incomes, setIncomes] = useState<WizIncome[]>(() =>
    members.map((m) => ({
      name: `Income (${m.name})`,
      yearlyAmount: 0,
      currency: "ILS",
      memberUserId: m.userId,
    })),
  );

  function patchIncome(i: number, p: Partial<WizIncome>) {
    setIncomes((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }

  function retirementYear(userId: string): number {
    const b = birthdays[userId];
    const birthYear = b ? Number(b.slice(0, 4)) : new Date().getFullYear() - 30;
    return birthYear + (retireAges[userId] ?? 65);
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      const result = await saveForecastSetup(
        JSON.stringify({
          members: members.map((m) => ({
            userId: m.userId,
            birthday: birthdays[m.userId] ?? "",
            retirementYear: retirementYear(m.userId),
          })),
          incomes,
          excludedAccountIds: [...excluded],
          inflationPct: 3,
          returnPct: 7,
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const birthdaysOk = members.every((m) => !!birthdays[m.userId]);

  return (
    <div className="mx-auto w-full max-w-[620px] px-6 pt-4">
      {/* stepper dots */}
      <div className="mb-5 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={cn(
              "h-2 w-2 rounded-full",
              i === step ? "bg-accent" : "bg-line-strong",
            )}
            title={s}
          />
        ))}
      </div>

      <div className="card p-6">
        {step === 0 ? (
          <>
            <h2 className="text-center text-[20px] font-semibold">
              Review your household&apos;s forecast
            </h2>
            <p className="mt-1 text-center text-[13px] text-muted">
              The forecast starts from your real Peanut data. Enter birthdays
              so ages and retirement years work.
            </p>
            <div className="mt-5 flex flex-col gap-3">
              {members.map((m) => (
                <div key={m.userId} className="rounded-lg border border-line p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[14px] font-semibold">{m.name}</span>
                    {!birthdays[m.userId] ? (
                      <span className="text-[12px] font-medium text-accent">
                        Birthday required
                      </span>
                    ) : null}
                  </div>
                  <input
                    type="date"
                    value={birthdays[m.userId] ?? ""}
                    onChange={(e) =>
                      setBirthdays((prev) => ({ ...prev, [m.userId]: e.target.value }))
                    }
                    className={inputCls}
                  />
                </div>
              ))}
              <div className="rounded-lg border border-line p-3.5">
                <div className="mb-1.5 text-[13.5px] font-semibold">Assumptions</div>
                <AssumptionLine
                  icon="🤑"
                  main={joinMoney(actualIncome)}
                  sub="take-home income per year, from your last 12 months"
                />
                <AssumptionLine
                  icon="💳"
                  main={joinMoney(actualExpenses)}
                  sub="living expenses per year, from your last 12 months"
                />
                <p className="mt-2 rounded-md bg-[#eef4fb] p-2 text-[12px] text-ink-soft">
                  The forecast uses rounded numbers to avoid false precision.
                  You can edit everything later.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2 className="text-center text-[20px] font-semibold">
              Add take-home income
            </h2>
            <p className="mt-1 text-center text-[13px] text-muted">
              Yearly take-home per person — after taxes and deductions.
              A rough estimate is fine.
            </p>
            <div className="mt-4 rounded-md bg-[#eef4fb] p-2.5 text-center text-[12.5px] text-ink-soft">
              Last 12 months, your household take-home was ~{joinMoney(actualIncome)}.
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {incomes.map((src, i) => (
                <div key={i} className="grid grid-cols-2 gap-2.5 rounded-lg border border-line p-3.5">
                  <input
                    value={src.name}
                    onChange={(e) => patchIncome(i, { name: e.target.value })}
                    placeholder="Name"
                    className={`${inputCls} col-span-2`}
                  />
                  <input
                    type="number"
                    value={src.yearlyAmount || ""}
                    onChange={(e) =>
                      patchIncome(i, { yearlyAmount: Number(e.target.value) || 0 })
                    }
                    placeholder="Yearly take-home"
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <select
                      value={src.currency}
                      onChange={(e) => patchIncome(i, { currency: e.target.value })}
                      className={selectCls}
                    >
                      <option value="ILS">₪ ILS</option>
                      <option value="USD">$ USD</option>
                    </select>
                    <select
                      value={src.memberUserId ?? ""}
                      onChange={(e) =>
                        patchIncome(i, { memberUserId: e.target.value || null })
                      }
                      className={`${selectCls} flex-1`}
                    >
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                      <option value="">Household</option>
                    </select>
                  </div>
                </div>
              ))}
              <button
                className="cursor-pointer text-left text-[13px] font-medium text-accent"
                onClick={() =>
                  setIncomes((prev) => [
                    ...prev,
                    {
                      name: "Income",
                      yearlyAmount: 0,
                      currency: "ILS",
                      memberUserId: members[0]?.userId ?? null,
                    },
                  ])
                }
              >
                + Add another income source
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-center text-[20px] font-semibold">
              Choose your forecast accounts
            </h2>
            <p className="mt-1 text-center text-[13px] text-muted">
              Accounts you save into, pay down, and draw from.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {accounts.map((a) => {
                const on = !excluded.has(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      })
                    }
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-left hover:bg-hover"
                  >
                    <InstitutionLogo institution={a.institution} fallback={a.name} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium" dir="auto">
                        {a.name}
                      </span>
                      <span className="block text-[12px] text-muted">
                        Balance: {fmtMoney(a.balance, a.currency, { compact: true })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "relative h-5 w-9 rounded-full transition-colors",
                        on ? "bg-accent" : "bg-line-strong",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          on ? "left-4.5" : "left-0.5",
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-center text-[20px] font-semibold">
              Choose a retirement age
            </h2>
            <p className="mt-1 text-center text-[13px] text-muted">
              A best guess is fine — it is easy to adjust later.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {members.map((m) => (
                <div key={m.userId} className="rounded-lg border border-line p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[14px] font-semibold">{m.name}</span>
                    <span className="text-[13px] text-muted">
                      {retirementYear(m.userId)}{" "}
                      <span className="text-faint">
                        (age {retireAges[m.userId] ?? 65})
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={80}
                    value={retireAges[m.userId] ?? 65}
                    onChange={(e) =>
                      setRetireAges((prev) => ({
                        ...prev,
                        [m.userId]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-[#ee6a3c]"
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {error ? <p className="mt-3 text-[13px] text-neg">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <button className={buttonCls("secondary")} onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft size={14} /> Go back
            </button>
          ) : (
            <span />
          )}
          <button
            className={buttonCls("primary")}
            disabled={pending || (step === 0 && !birthdaysOk)}
            onClick={() => {
              if (step < 3) setStep((s) => s + 1);
              else finish();
            }}
          >
            {pending ? "Building…" : step < 3 ? "Continue" : "Build my forecast"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssumptionLine({
  icon,
  main,
  sub,
}: {
  icon: string;
  main: string;
  sub: string;
}) {
  return (
    <div className="py-1">
      <div className="text-[13.5px] font-medium">
        {icon} {main}
      </div>
      <div className="pl-6 text-[12px] text-muted">{sub}</div>
    </div>
  );
}

function joinMoney(map: Record<string, number>): string {
  const parts: string[] = [];
  if (map.ILS) parts.push(fmtMoney(map.ILS, "ILS", { decimals: false }));
  if (map.USD) parts.push(fmtMoney(map.USD, "USD", { decimals: false }));
  return parts.length ? parts.join(" + ") : "₪0";
}
