"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";

export async function createGoal(formData: FormData) {
  const { supabase, space, rates } = await getContext();
  const kind = String(formData.get("kind") ?? "save_up");
  const currency = String(formData.get("currency") ?? "ILS");
  const accountId = String(formData.get("account_id") || "");

  // For pay-down goals the starting amount is today's debt.
  let starting = 0;
  if (kind === "pay_down" && accountId) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("current_balance, currency")
      .eq("id", accountId)
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
      name: String(formData.get("name") ?? "").trim() || "New goal",
      icon: String(formData.get("icon") || "") || null,
      kind,
      target_amount: Number(formData.get("target_amount") ?? 0) || starting || 1,
      currency,
      target_date: String(formData.get("target_date") || "") || null,
      starting_amount: starting,
      planned_monthly: Number(formData.get("planned_monthly") ?? 0),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (accountId) {
    await supabase
      .from("goal_accounts")
      .insert({ goal_id: goal.id, account_id: accountId });
  }
  revalidatePath("/goals");
}
