"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncRiseup, markRiseupError } from "@/lib/sync/riseup";
import { syncPlaid } from "@/lib/sync/plaid";
import { detectRecurring, writeDailySnapshots } from "@/lib/sync/housekeeping";
import type { AccountType } from "@/lib/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ------------------------------------------------------------ transactions

export async function setTransactionCategory(txnId: string, categoryId: string) {
  const { supabase } = await getContext();
  await supabase
    .from("transactions")
    .update({ category_id: categoryId || null, categorized_by: "user" })
    .eq("id", txnId);
  revalidatePath("/transactions");
}

export async function toggleTransactionHidden(txnId: string, hidden: boolean) {
  const { supabase } = await getContext();
  await supabase
    .from("transactions")
    .update({ hide_from_reports: hidden })
    .eq("id", txnId);
  revalidatePath("/transactions");
}

export async function addManualTransaction(formData: FormData) {
  const { supabase, space } = await getContext();
  const accountId = String(formData.get("account_id"));
  const { data: account } = await supabase
    .from("accounts")
    .select("currency")
    .eq("id", accountId)
    .single();
  const kind = String(formData.get("kind") ?? "expense");
  const raw = Math.abs(Number(formData.get("amount") ?? 0));
  await supabase.from("transactions").insert({
    space_id: space.id,
    account_id: accountId,
    source: "manual",
    date: String(formData.get("date") ?? today()),
    name: String(formData.get("name") ?? "").trim() || "Manual entry",
    amount: kind === "income" ? raw : -raw,
    currency: account?.currency ?? space.primary_currency,
    category_id: String(formData.get("category_id") || "") || null,
    categorized_by: formData.get("category_id") ? "user" : "none",
  });
  revalidatePath("/transactions");
}

// ---------------------------------------------------------------- accounts

export async function addManualAccount(formData: FormData) {
  const { supabase, space } = await getContext();
  const balance = Number(formData.get("balance") ?? 0);
  const type = String(formData.get("type") ?? "checking") as AccountType;
  const isLiability = ["credit", "loan", "other_liability"].includes(type);
  const { data: account, error } = await supabase
    .from("accounts")
    .insert({
      space_id: space.id,
      source: "manual",
      name: String(formData.get("name") ?? "").trim() || "New account",
      institution_name: String(formData.get("institution") || "") || null,
      type,
      currency: String(formData.get("currency") ?? space.primary_currency),
      current_balance: balance,
      is_liability: isLiability,
    })
    .select("id, currency")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("account_balance_snapshots").upsert(
    {
      account_id: account.id,
      as_of_date: today(),
      balance,
      currency: account.currency,
      source: "manual",
    },
    { onConflict: "account_id,as_of_date" },
  );
  revalidatePath("/accounts");
}

export async function addPensionAccount(formData: FormData) {
  const { supabase, space } = await getContext();
  const balance = Number(formData.get("balance") ?? 0);
  const { data: account, error } = await supabase
    .from("accounts")
    .insert({
      space_id: space.id,
      source: "manual",
      name: String(formData.get("name") ?? "").trim() || "Pension",
      institution_name: String(formData.get("provider") || "") || null,
      type: "pension",
      currency: "ILS",
      current_balance: balance,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const fundId = Number(formData.get("fund_id") ?? 0);
  if (fundId > 0) {
    await supabase.from("pension_configs").insert({
      account_id: account.id,
      provider: String(formData.get("provider") || "") || null,
      dataset: String(formData.get("dataset") ?? "gemelnet"),
      fund_id: fundId,
      annual_fee_pct: Number(formData.get("annual_fee_pct") ?? 0),
      deposit_fee_pct: Number(formData.get("deposit_fee_pct") ?? 0),
      monthly_contribution: Number(formData.get("monthly_contribution") ?? 0),
      anchor_date: String(formData.get("anchor_date") ?? today()),
      anchor_balance: balance,
    });
  }
  await supabase.from("account_balance_snapshots").upsert(
    {
      account_id: account.id,
      as_of_date: today(),
      balance,
      currency: "ILS",
      source: "manual",
    },
    { onConflict: "account_id,as_of_date" },
  );
  revalidatePath("/accounts");
  revalidatePath("/investments");
}

export async function updateAccountBalance(accountId: string, balance: number) {
  const { supabase } = await getContext();
  const { data: account } = await supabase
    .from("accounts")
    .update({ current_balance: balance })
    .eq("id", accountId)
    .select("currency")
    .single();
  if (account) {
    await supabase.from("account_balance_snapshots").upsert(
      {
        account_id: accountId,
        as_of_date: today(),
        balance,
        currency: account.currency,
        source: "manual",
      },
      { onConflict: "account_id,as_of_date" },
    );
  }
  revalidatePath("/accounts");
}

export async function deleteAccount(accountId: string) {
  const { supabase } = await getContext();
  await supabase
    .from("accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", accountId);
  revalidatePath("/accounts");
}

// ------------------------------------------------------------------ riseup

export interface ActionResult {
  error: string | null;
  detail?: string;
}

function describeRiseupError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "RISEUP_TOKEN_EXPIRED") {
    return "RiseUp said this token is not valid (401). Make sure you copied the full token, or create a fresh one — they expire after 30 days.";
  }
  if (msg.startsWith("RISEUP_RATE_LIMITED")) {
    return "RiseUp rate limit hit. Wait a minute and try again.";
  }
  return `RiseUp sync failed: ${msg}`;
}

export async function connectRiseup(formData: FormData): Promise<ActionResult> {
  const { supabase, space, userId } = await getContext();
  const token = String(formData.get("token") ?? "").trim();
  if (!token.startsWith("riseup_pat_")) {
    return { error: "That is not a RiseUp token. It starts with riseup_pat_" };
  }
  const { data: conn, error } = await supabase
    .from("connections")
    .insert({
      space_id: space.id,
      provider: "riseup",
      label: String(formData.get("label") || "RiseUp") || "RiseUp",
      institution_name: "RiseUp",
      status: "pending",
      created_by: userId,
      config: { token_created_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (error) return { error: `Could not save the connection: ${error.message}` };

  const admin = createAdminClient();
  const { error: vaultErr } = await admin.rpc("peanut_vault_set_secret", {
    p_name: `conn_${conn.id}`,
    p_secret: token,
  });
  if (vaultErr) {
    await supabase.from("connections").delete().eq("id", conn.id);
    return { error: `Could not store the token: ${vaultErr.message}` };
  }

  try {
    await syncRiseup(conn.id, { backfillMonths: 12 });
  } catch (e) {
    const friendly = describeRiseupError(e);
    await markRiseupError(conn.id, friendly);
    // Keep the connection so a token renew can fix it without re-adding.
    return { error: friendly };
  }
  await writeDailySnapshots();
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  return { error: null };
}

export async function renewRiseupToken(
  connectionId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await getContext();
  const token = String(formData.get("token") ?? "").trim();
  if (!token.startsWith("riseup_pat_")) {
    return { error: "That is not a RiseUp token. It starts with riseup_pat_" };
  }
  // RLS check: the user must be able to see this connection.
  const { data: conn } = await supabase
    .from("connections")
    .select("id, config")
    .eq("id", connectionId)
    .single();
  if (!conn) return { error: "Connection not found" };
  const admin = createAdminClient();
  await admin.rpc("peanut_vault_set_secret", {
    p_name: `conn_${connectionId}`,
    p_secret: token,
  });
  await admin
    .from("connections")
    .update({
      status: "active",
      error: null,
      config: {
        ...(conn.config as Record<string, unknown>),
        token_created_at: new Date().toISOString(),
      },
    })
    .eq("id", connectionId);
  try {
    await syncRiseup(connectionId);
  } catch (e) {
    const friendly = describeRiseupError(e);
    await markRiseupError(connectionId, friendly);
    return { error: friendly };
  }
  revalidatePath("/settings");
  return { error: null };
}

// -------------------------------------------------------------------- sync

export async function syncConnectionNow(connectionId: string) {
  const { supabase } = await getContext();
  const { data: conn } = await supabase
    .from("connections")
    .select("id, provider")
    .eq("id", connectionId)
    .single();
  if (!conn) throw new Error("Connection not found");
  try {
    if (conn.provider === "riseup") await syncRiseup(connectionId);
    if (conn.provider === "plaid") await syncPlaid(connectionId);
  } catch (e) {
    if (conn.provider === "riseup") {
      await markRiseupError(connectionId, e instanceof Error ? e.message : "failed");
    }
    throw e;
  }
  await writeDailySnapshots();
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/settings");
}

export async function deleteConnection(connectionId: string) {
  const { supabase } = await getContext();
  await supabase.from("connections").delete().eq("id", connectionId);
  revalidatePath("/settings");
  revalidatePath("/accounts");
}

// --------------------------------------------------------------- recurring

export async function runRecurringDetection() {
  const { space } = await getContext();
  await detectRecurring(space.id);
  revalidatePath("/recurring");
}

export async function setRecurringStatus(
  streamId: string,
  status: "active" | "dismissed" | "ended",
) {
  const { supabase } = await getContext();
  await supabase.from("recurring_streams").update({ status }).eq("id", streamId);
  revalidatePath("/recurring");
}

// ------------------------------------------------------------------ budget

export async function upsertBudget(
  month: string,
  categoryId: string,
  currency: string,
  amount: number,
) {
  const { supabase, space } = await getContext();
  if (amount === 0) {
    await supabase
      .from("budgets")
      .delete()
      .eq("space_id", space.id)
      .eq("month", month)
      .eq("category_id", categoryId)
      .eq("currency", currency);
  } else {
    await supabase.from("budgets").upsert(
      { space_id: space.id, month, category_id: categoryId, currency, amount },
      { onConflict: "space_id,month,category_id,currency" },
    );
  }
  revalidatePath("/budget");
}

// ---------------------------------------------------------------- settings

export async function updateSpace(formData: FormData) {
  const { supabase, space } = await getContext();
  await supabase
    .from("spaces")
    .update({
      name: String(formData.get("name") ?? space.name),
      primary_currency: String(
        formData.get("primary_currency") ?? space.primary_currency,
      ),
    })
    .eq("id", space.id);
  revalidatePath("/settings");
}
