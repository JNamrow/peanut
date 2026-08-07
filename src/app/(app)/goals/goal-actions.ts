"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";

export interface GoalDraft {
  name: string;
  icon: string;
  kind: "save_up" | "pay_down";
  currency: string;
  target_amount: number | null;
  target_date: string | null;
  planned_monthly: number;
  account_id: string | null;
}

export interface GoalActionResult {
  error: string | null;
  created?: number;
}

/** Create one or more goals from the wizard. */
export async function createGoals(draftsJson: string): Promise<GoalActionResult> {
  const { supabase, space, rates } = await getContext();
  let drafts: GoalDraft[];
  try {
    drafts = JSON.parse(draftsJson) as GoalDraft[];
  } catch {
    return { error: "Bad goal data." };
  }
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { error: "Pick at least one goal." };
  }

  let created = 0;
  for (const d of drafts) {
    const currency = d.currency === "USD" ? "USD" : "ILS";
    let starting = 0;
    if (d.kind === "pay_down" && d.account_id) {
      const { data: acc } = await supabase
        .from("accounts")
        .select("current_balance, currency")
        .eq("id", d.account_id)
        .single();
      if (acc) {
        starting = Math.abs(
          rates.convert(Number(acc.current_balance ?? 0), acc.currency, currency),
        );
      }
    }
    const { data: goal, error } = await supabase
      .from("goals")
      .insert({
        space_id: space.id,
        name: d.name.trim() || "New goal",
        icon: d.icon || "🎯",
        kind: d.kind,
        target_amount: d.target_amount && d.target_amount > 0 ? d.target_amount : starting || 1,
        currency,
        target_date: d.target_date || null,
        starting_amount: starting,
        planned_monthly: Number(d.planned_monthly) || 0,
      })
      .select("id")
      .single();
    if (error) return { error: error.message, created };
    if (d.account_id) {
      await supabase
        .from("goal_accounts")
        .insert({ goal_id: goal.id, account_id: d.account_id });
    }
    created++;
  }
  revalidatePath("/goals");
  return { error: null, created };
}

export async function deleteGoal(goalId: string): Promise<GoalActionResult> {
  const { supabase } = await getContext();
  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  revalidatePath("/goals");
  return { error: error?.message ?? null };
}
