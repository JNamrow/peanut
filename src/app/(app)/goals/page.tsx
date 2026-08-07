import { getAccounts, getContext } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { Card, EmptyState, PageHeader, Segmented } from "@/components/ui";
import { AddGoalButton } from "./goal-ui";
import { Target } from "lucide-react";

interface GoalRow {
  id: string;
  name: string;
  icon: string | null;
  kind: "save_up" | "pay_down";
  target_amount: number;
  currency: string;
  target_date: string | null;
  starting_amount: number;
  planned_monthly: number;
  status: string;
  goal_accounts: { account_id: string }[];
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "save_up" } = await searchParams;
  const kind = tab === "pay_down" ? "pay_down" : "save_up";
  const { supabase, space, rates, displayCurrency } = await getContext();
  const accounts = await getAccounts();

  const { data: goals } = await supabase
    .from("goals")
    .select("*, goal_accounts(account_id)")
    .eq("space_id", space.id)
    .neq("status", "archived")
    .order("display_order")
    .order("created_at");

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const list = ((goals ?? []) as GoalRow[]).filter((g) => g.kind === kind);

  function progressOf(g: GoalRow): { current: number; pct: number; status: string } {
    const linked = g.goal_accounts
      .map((l) => accountById.get(l.account_id))
      .filter(Boolean);
    let current: number;
    if (g.kind === "save_up") {
      current =
        linked.length > 0
          ? linked.reduce(
              (s, a) =>
                s +
                rates.convert(Number(a!.current_balance ?? 0), a!.currency, g.currency),
              0,
            )
          : Number(g.starting_amount);
    } else {
      // pay_down: progress = starting debt − current debt
      const debtNow =
        linked.length > 0
          ? linked.reduce(
              (s, a) =>
                s +
                Math.abs(
                  rates.convert(Number(a!.current_balance ?? 0), a!.currency, g.currency),
                ),
              0,
            )
          : 0;
      current = Math.max(0, Number(g.starting_amount) - debtNow);
    }
    const pct = Math.max(0, Math.min(100, (current / Number(g.target_amount)) * 100));

    let status = "On track";
    if (pct >= 100) status = "Completed";
    else if (g.target_date && g.planned_monthly > 0) {
      const monthsLeft = Math.max(
        0,
        (new Date(g.target_date).getTime() - Date.now()) / (30.44 * 86400000),
      );
      const needed = Number(g.target_amount) - current;
      status = monthsLeft * Number(g.planned_monthly) >= needed ? "On track" : "At risk";
    }
    return { current, pct, status };
  }

  return (
    <>
      <PageHeader
        title="Goals"
        tabs={
          <Segmented
            options={[
              { value: "save_up", label: "Save up" },
              { value: "pay_down", label: "Pay down" },
            ]}
            value={kind}
            hrefBase="/goals"
            param="tab"
          />
        }
        right={<AddGoalButton accounts={accounts} />}
      />
      <div className="px-6 pt-2">
        {list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Target size={19} />}
              title="Plan for your future"
              sub={
                kind === "save_up"
                  ? "Save up for anything — link an account and watch the bar fill."
                  : "Pick a loan or card, set a payoff target, and track it down to zero."
              }
              action={<AddGoalButton accounts={accounts} primary />}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {list.map((g) => {
              const p = progressOf(g);
              return (
                <Card key={g.id} className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-[16px]">
                        {g.icon ?? "🎯"}
                      </span>
                      <span className="text-[14.5px] font-semibold">{g.name}</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                        p.status === "Completed"
                          ? "bg-pos-soft text-pos"
                          : p.status === "At risk"
                            ? "bg-[#fdf3d8] text-[#a07d1c]"
                            : "bg-pos-soft text-pos"
                      }`}
                    >
                      {p.status === "Completed" ? "✓ Completed" : p.status}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-active">
                    <div
                      className={`h-full rounded-full ${p.status === "At risk" ? "bg-chart-5" : "bg-pos"}`}
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12.5px]">
                    <span className="tnum text-ink-soft">
                      {fmtMoney(p.current, g.currency, { decimals: false })}
                      <span className="text-faint">
                        {" "}
                        of {fmtMoney(Number(g.target_amount), g.currency, { decimals: false })}
                      </span>
                    </span>
                    <span className="text-muted">
                      {g.target_date
                        ? `by ${new Date(`${g.target_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                        : `${Math.round(p.pct)}%`}
                    </span>
                  </div>
                  {g.goal_accounts.length > 0 ? (
                    <div className="mt-2 text-[12px] text-faint">
                      Linked:{" "}
                      {g.goal_accounts
                        .map((l) => accountById.get(l.account_id)?.name)
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11.5px] text-faint">
          Estimates only — projected dates depend on your assumptions.
        </p>
      </div>
    </>
  );
}
