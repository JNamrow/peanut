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
    futureValues?: "today" | "nominal";
    incomes: { id?: string; name: string; yearlyAmount: number; currency: string; memberUserId: string | null; excluded?: boolean }[];
    retirementYears: { userId: string; retirementYear: number }[];
    lifeExpectancies?: { userId: string; lifeExpectancy: number }[];
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
    ...(data.futureValues ? { future_values: data.futureValues } : {}),
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
      excluded: !!src.excluded,
    });
  }
  for (const m of data.retirementYears) {
    await supabase
      .from("space_members")
      .update({ retirement_year: m.retirementYear })
      .eq("space_id", space.id)
      .eq("user_id", m.userId);
  }
  for (const m of data.lifeExpectancies ?? []) {
    await supabase
      .from("space_members")
      .update({ life_expectancy: m.lifeExpectancy })
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

export async function updateForecastEvent(
  eventId: string,
  payload: string,
): Promise<ForecastActionResult> {
  const { supabase } = await getContext();
  let ev: {
    name: string;
    icon: string | null;
    kind: "one_time" | "yearly";
    affects: "income" | "expense";
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
  if (!ev.year || !Number.isFinite(ev.year) || !ev.amount || !Number.isFinite(ev.amount)) {
    return { error: "Year and amount are required." };
  }
  const { error } = await supabase
    .from("forecast_events")
    .update({
      name: ev.name.trim() || "Event",
      icon: ev.icon || "🎯",
      kind: ev.kind,
      affects: ev.affects,
      year: ev.year,
      end_year: ev.kind === "yearly" ? ev.endYear : null,
      amount: Math.abs(ev.amount),
      currency: ev.currency === "USD" ? "USD" : "ILS",
    })
    .eq("id", eventId);
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

/** Per-account forecast settings (the gear panel on an account row). */
export async function updateForecastAccount(
  accountId: string,
  payload: string,
): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let data: {
    include: boolean;
    growthMode: "default" | "fixed" | "none" | "variable";
    growthPct: number | null;
    growthPoints: { year: number; rate: number }[];
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad settings." };
  }
  const { error } = await supabase
    .from("accounts")
    .update({
      forecast_include: !!data.include,
      forecast_growth_mode: data.growthMode === "default" ? null : data.growthMode,
      forecast_growth_pct:
        data.growthPct == null || Number.isNaN(data.growthPct)
          ? null
          : data.growthPct,
      forecast_growth_points:
        data.growthMode === "variable" ? (data.growthPoints ?? []) : null,
    })
    .eq("id", accountId)
    .eq("space_id", space.id);
  if (error) return { error: error.message };
  revalidatePath("/forecasting");
  return { error: null };
}

/** Replace the extra-savings split rows (and the enabled flag) for the space. */
export async function saveSplits(payload: string): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let data: {
    enabled: boolean;
    rows: { accountId: string; mode: "percent" | "amount"; value: number }[];
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad split data." };
  }

  const { error: settingsError } = await supabase
    .from("forecast_settings")
    .update({ split_enabled: !!data.enabled, updated_at: new Date().toISOString() })
    .eq("space_id", space.id);
  if (settingsError) return { error: settingsError.message };

  const ids = data.rows.map((r) => r.accountId);
  if (ids.length) {
    const { data: owned, error: ownError } = await supabase
      .from("accounts")
      .select("id")
      .eq("space_id", space.id)
      .in("id", ids);
    if (ownError) return { error: ownError.message };
    if ((owned ?? []).length !== new Set(ids).size) {
      return { error: "Unknown account in split." };
    }
  }

  const { error: delError } = await supabase
    .from("forecast_splits")
    .delete()
    .eq("space_id", space.id);
  if (delError) return { error: delError.message };

  if (data.rows.length) {
    const { error } = await supabase.from("forecast_splits").insert(
      data.rows.map((r, i) => ({
        account_id: r.accountId,
        space_id: space.id,
        mode: r.mode === "amount" ? "amount" : "percent",
        value: Number(r.value) || 0,
        position: i,
      })),
    );
    if (error) return { error: error.message };
  }

  revalidatePath("/forecasting");
  return { error: null };
}

export async function saveWithdrawalOrder(payload: string): Promise<ForecastActionResult> {
  const { supabase, space } = await getContext();
  let data: { order: string[] };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad order." };
  }
  const { error } = await supabase
    .from("forecast_settings")
    .update({ withdrawal_order: data.order, updated_at: new Date().toISOString() })
    .eq("space_id", space.id);
  if (error) return { error: error.message };
  revalidatePath("/forecasting");
  return { error: null };
}
