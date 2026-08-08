"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";

export interface ForecastActionResult {
  error: string | null;
}

/** Wizard finish: birthdays, retirement years, incomes, account toggles. */
export async function saveForecastSetup(payload: string): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let data: {
    members: { userId: string; birthday: string; retirementYear: number }[];
    incomes: { name: string; yearlyAmount: number; currency: string; memberUserId: string | null }[];
    excludedAccountIds: string[];
    inflationPct: number;
    returnPct: number;
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad setup data." };
  }

  for (const m of data.members) {
    if (!m.birthday) return { error: "Every member needs a birthday." };
    const { error } = await supabase
      .from("space_members")
      .update({ birthday: m.birthday, retirement_year: m.retirementYear })
      .eq("space_id", space.id)
      .eq("user_id", m.userId);
    if (error) return { error: error.message };
  }

  // Replace income sources.
  await supabase.from("forecast_incomes").delete().eq("space_id", space.id);
  for (const src of data.incomes) {
    if (!src.yearlyAmount) continue;
    const { error } = await supabase.from("forecast_incomes").insert({
      space_id: space.id,
      member_user_id: src.memberUserId,
      name: src.name.trim() || "Income",
      yearly_amount: src.yearlyAmount,
      currency: src.currency === "USD" ? "USD" : "ILS",
    });
    if (error) return { error: error.message };
  }

  // Account inclusion toggles.
  await supabase
    .from("accounts")
    .update({ forecast_include: true })
    .eq("space_id", space.id);
  if (data.excludedAccountIds.length) {
    await supabase
      .from("accounts")
      .update({ forecast_include: false })
      .in("id", data.excludedAccountIds);
  }

  const { error } = await supabase.from("forecast_settings").upsert({
    space_id: space.id,
    inflation_pct: data.inflationPct || 3,
    return_pct: data.returnPct || 7,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath("/forecasting");
  return { error: null };
}

export async function updateAssumptions(payload: string): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let data: {
    inflationPct: number;
    returnPct: number;
    useActualExpenses: boolean;
    expensesOverride: Record<string, number | null>;
    incomes: { id?: string; name: string; yearlyAmount: number; currency: string; memberUserId: string | null }[];
    retirementYears: { userId: string; retirementYear: number }[];
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad data." };
  }
  const { error } = await supabase.from("forecast_settings").upsert({
    space_id: space.id,
    inflation_pct: data.inflationPct,
    return_pct: data.returnPct,
    use_actual_expenses: data.useActualExpenses,
    expenses_override: data.expensesOverride,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  await supabase.from("forecast_incomes").delete().eq("space_id", space.id);
  for (const src of data.incomes) {
    if (!src.yearlyAmount) continue;
    await supabase.from("forecast_incomes").insert({
      space_id: space.id,
      member_user_id: src.memberUserId,
      name: src.name.trim() || "Income",
      yearly_amount: src.yearlyAmount,
      currency: src.currency === "USD" ? "USD" : "ILS",
    });
  }
  for (const m of data.retirementYears) {
    await supabase
      .from("space_members")
      .update({ retirement_year: m.retirementYear })
      .eq("space_id", space.id)
      .eq("user_id", m.userId);
  }
  revalidatePath("/forecasting");
  return { error: null };
}

export async function addForecastEvent(payload: string): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let ev: {
    name: string;
    icon: string;
    kind: "one_time" | "yearly";
    affects: "expense" | "income";
    year: number;
    endYear: number | null;
    amount: number;
    currency: string;
  };
  try {
    ev = JSON.parse(payload);
  } catch {
    return { error: "Bad event." };
  }
  if (!ev.year || !ev.amount) return { error: "Year and amount are required." };
  const { error } = await supabase.from("forecast_events").insert({
    space_id: space.id,
    name: ev.name.trim() || "Event",
    icon: ev.icon || "🎯",
    kind: ev.kind,
    affects: ev.affects,
    year: ev.year,
    end_year: ev.kind === "yearly" ? ev.endYear : null,
    amount: Math.abs(ev.amount),
    currency: ev.currency === "USD" ? "USD" : "ILS",
  });
  if (error) return { error: error.message };
  revalidatePath("/forecasting");
  return { error: null };
}

export async function deleteForecastEvent(eventId: string): Promise<ForecastActionResult> {
  const { supabase } = await getContext();
  const { error } = await supabase.from("forecast_events").delete().eq("id", eventId);
  revalidatePath("/forecasting");
  return { error: error?.message ?? null };
}
