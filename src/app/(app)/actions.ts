"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncRiseup, markRiseupError } from "@/lib/sync/riseup";
import { syncPlaid } from "@/lib/sync/plaid";
import { detectRecurring, writeDailySnapshots } from "@/lib/sync/housekeeping";
import { CADENCE_LABELS, occurrencesInMonth, type Cadence } from "@/lib/recurring";
import type { AccountType, TransactionEvent } from "@/lib/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Supa = Awaited<ReturnType<typeof getContext>>["supabase"];

function actorNameFrom(
  members: { user_id: string; display_name: string | null }[],
  userId: string,
): string | null {
  return members.find((m) => m.user_id === userId)?.display_name ?? null;
}

/** Append a transaction-timeline event. Best-effort: never throws, never blocks. */
async function logTxnEvent(
  supabase: Supa,
  spaceId: string,
  actorName: string | null,
  txnId: string,
  kind: string,
  summary: string,
): Promise<void> {
  try {
    await supabase.from("transaction_events").insert({
      space_id: spaceId,
      transaction_id: txnId,
      kind,
      summary,
      actor_name: actorName,
    });
  } catch {
    // swallow — logging must never break the primary action
  }
}

// ------------------------------------------------------------ transactions

export async function setTransactionCategory(txnId: string, categoryId: string) {
  const { supabase, space, members, userId } = await getContext();
  await supabase
    .from("transactions")
    .update({ category_id: categoryId || null, categorized_by: "user" })
    .eq("id", txnId);
  let summary = "Category cleared";
  if (categoryId) {
    const { data: cat } = await supabase
      .from("categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    summary = `Category set to ${cat?.name ?? "category"}`;
  }
  await logTxnEvent(supabase, space.id, actorNameFrom(members, userId), txnId, "category", summary);
  revalidatePath("/transactions");
}

export async function toggleTransactionHidden(txnId: string, hidden: boolean) {
  const { supabase, space, members, userId } = await getContext();
  await supabase
    .from("transactions")
    .update({ hide_from_reports: hidden })
    .eq("id", txnId);
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "hidden",
    hidden ? "Marked as hidden" : "Marked as visible",
  );
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

export async function updateTransactionNotes(txnId: string, notes: string) {
  const { supabase, space, members, userId } = await getContext();
  await supabase
    .from("transactions")
    .update({ notes: notes.trim() || null })
    .eq("id", txnId);
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "notes",
    "Description updated",
  );
  revalidatePath("/transactions");
}

/** Upload a receipt file to private storage and attach it. */
export async function uploadReceipt(
  txnId: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  const { supabase, space, members, userId } = await getContext();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file chosen." };
  if (file.size > 10 * 1024 * 1024) return { error: "Max 10MB." };

  // RLS check: the txn must be visible to this user.
  const { data: txn } = await supabase
    .from("transactions")
    .select("id, attachments")
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found." };

  const admin = createAdminClient();
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-60);
  const path = `${space.id}/${txnId}/${Date.now()}_${safe}`;
  const { error: upErr } = await admin.storage
    .from("receipts")
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) return { error: upErr.message };

  await supabase
    .from("transactions")
    .update({ attachments: [...(txn.attachments ?? []), path] })
    .eq("id", txnId);
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "receipt",
    "Receipt added",
  );
  revalidatePath("/transactions");
  return { error: null };
}

/** Signed URL for a private receipt (1 hour). */
export async function receiptUrl(path: string): Promise<string | null> {
  const { space } = await getContext();
  if (!path.startsWith(`${space.id}/`)) return null; // space isolation
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from("receipts")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function removeReceipt(txnId: string, path: string) {
  const { supabase, space, members, userId } = await getContext();
  if (!path.startsWith(`${space.id}/`)) return;
  const { data: txn } = await supabase
    .from("transactions")
    .select("attachments")
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) return;
  const admin = createAdminClient();
  await admin.storage.from("receipts").remove([path]);
  await supabase
    .from("transactions")
    .update({ attachments: (txn.attachments ?? []).filter((p: string) => p !== path) })
    .eq("id", txnId);
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "receipt",
    "Receipt removed",
  );
  revalidatePath("/transactions");
}

export async function renameMerchant(
  txnId: string,
  newName: string,
  applyAll: boolean,
): Promise<{ error: string | null }> {
  const { supabase, space, members, userId } = await getContext();
  const name = newName.trim();
  if (!name) return { error: "Name is required" };
  const { data: txn } = await supabase
    .from("transactions")
    .select("id, name")
    .eq("id", txnId)
    .single();
  if (!txn) return { error: "Transaction not found" };
  if (applyAll) {
    const { error } = await supabase
      .from("transactions")
      .update({ name })
      .eq("space_id", space.id)
      .eq("name", txn.name);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("transactions")
      .update({ name })
      .eq("id", txnId);
    if (error) return { error: error.message };
  }
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "rename",
    `Renamed to ${name}`,
  );
  revalidatePath("/transactions");
  return { error: null };
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
    .update({
      current_balance: balance,
      // Anchor for RiseUp roll-forward (harmless on other sources).
      balance_anchor: balance,
      balance_anchor_date: today(),
    })
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

export async function updateRecurringCategory(
  streamId: string,
  categoryId: string | null,
): Promise<{ error: string | null }> {
  const { supabase, space } = await getContext();
  const { data: existing } = await supabase
    .from("recurring_streams")
    .select("id")
    .eq("id", streamId)
    .eq("space_id", space.id)
    .maybeSingle();
  if (!existing) return { error: "Recurring item not found." };
  const { error } = await supabase
    .from("recurring_streams")
    .update({ category_id: categoryId })
    .eq("id", streamId);
  if (error) return { error: error.message };
  revalidatePath("/recurring");
  revalidatePath("/transactions");
  return { error: null };
}

/** Link a transaction to a recurring stream (both must be in the caller's space). */
export async function linkTransactionToStream(
  streamId: string,
  txnId: string,
): Promise<{ error: string | null }> {
  const { supabase, space, members, userId } = await getContext();
  const { data: stream } = await supabase
    .from("recurring_streams")
    .select("id")
    .eq("id", streamId)
    .eq("space_id", space.id)
    .maybeSingle();
  if (!stream) return { error: "Recurring item not found." };
  const { data: txn } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", txnId)
    .eq("space_id", space.id)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found." };
  const { error } = await supabase
    .from("transactions")
    .update({ recurring_stream_id: streamId })
    .eq("id", txnId);
  if (error) return { error: error.message };
  await logTxnEvent(
    supabase,
    space.id,
    actorNameFrom(members, userId),
    txnId,
    "recurring",
    "Marked as recurring",
  );
  revalidatePath("/recurring");
  revalidatePath("/transactions");
  return { error: null };
}

/** Transaction timeline: real events oldest-first, with a synthetic "created" head. */
export async function getTransactionEvents(
  txnId: string,
): Promise<{ error: string | null; events: TransactionEvent[] }> {
  const { supabase, space } = await getContext();
  const { data: txn } = await supabase
    .from("transactions")
    .select("created_at, source")
    .eq("id", txnId)
    .eq("space_id", space.id)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found.", events: [] };
  const { data: rows, error } = await supabase
    .from("transaction_events")
    .select("id, kind, summary, actor_name, created_at")
    .eq("transaction_id", txnId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message, events: [] };
  const events: TransactionEvent[] = [
    {
      id: `created-${txnId}`,
      kind: "created",
      summary: "Added to Peanut",
      actorName: null,
      createdAt: txn.created_at as string,
    },
    ...(rows ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      summary: r.summary as string,
      actorName: (r.actor_name as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  ];
  return { error: null, events };
}

/** Candidate transactions to link to a recurring stream: recent 60, unlinked first. */
export async function searchTransactionsForMatch(
  payload: string,
): Promise<{
  error: string | null;
  results: {
    id: string;
    name: string;
    date: string;
    amount: number;
    currency: string;
    accountName: string | null;
  }[];
}> {
  const { supabase, space } = await getContext();
  let data: { query?: string; streamId?: string };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad search data.", results: [] };
  }
  const query = (data.query ?? "").trim();

  let dbq = supabase
    .from("transactions")
    .select("id, name, date, amount, currency, recurring_stream_id, accounts(name)")
    .eq("space_id", space.id)
    .order("date", { ascending: false })
    .limit(60);
  if (query.length >= 2) {
    dbq = dbq.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const { data: rows, error } = await dbq;
  if (error) return { error: error.message, results: [] };

  const sorted = (rows ?? []).slice().sort((a, b) => {
    const an = (a.recurring_stream_id as string | null) == null;
    const bn = (b.recurring_stream_id as string | null) == null;
    if (an !== bn) return an ? -1 : 1;
    return (b.date as string).localeCompare(a.date as string);
  });

  return {
    error: null,
    results: sorted.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      date: r.date as string,
      amount: Number(r.amount),
      currency: r.currency as string,
      accountName: accountNameOf(r.accounts),
    })),
  };
}

/** Supabase embeds a to-one relation as an object at runtime but types it as an array. */
function accountNameOf(a: unknown): string | null {
  const one = Array.isArray(a) ? a[0] : a;
  return (one as { name?: string } | null)?.name ?? null;
}

/** First expected date on/after `from`, walking up to 24 months ahead. */
function firstOccurrenceOnOrAfter(
  cadence: Cadence,
  anchor: string,
  from: string,
): string | null {
  const [fy, fm] = from.split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    const total = fy * 12 + (fm - 1) + i;
    const month = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    const hit = occurrencesInMonth(cadence, anchor, month).find((d) => d >= from);
    if (hit) return hit;
  }
  return null;
}

export async function upsertRecurringStream(
  payload: string,
): Promise<{ error: string | null; id?: string }> {
  const { supabase, space } = await getContext();
  let data: {
    id?: string | null;
    merchantName: string;
    cadence: Cadence;
    kind: "expense" | "income";
    amount: number;
    currency: string;
    startDate: string;
    status?: "active" | "ended";
    accountId?: string | null;
    logoDomain?: string | null;
    logoUrl?: string | null;
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad recurring data." };
  }
  const merchantName = data.merchantName?.trim();
  if (!merchantName) return { error: "Merchant name is required." };
  if (!CADENCE_LABELS[data.cadence]) return { error: "Pick a frequency." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate ?? "")) {
    return { error: "Start date is required." };
  }
  const amount = Math.abs(Number(data.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be above zero." };

  // Category rides along from the merchant's most recent categorized txn.
  const { data: lastCat } = await supabase
    .from("transactions")
    .select("category_id")
    .eq("space_id", space.id)
    .eq("name", merchantName)
    .not("category_id", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Default the account to the merchant's most recent txn when not supplied.
  let accountId = data.accountId ?? null;
  if (!accountId) {
    const { data: lastTxn } = await supabase
      .from("transactions")
      .select("account_id")
      .eq("space_id", space.id)
      .eq("name", merchantName)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    accountId = (lastTxn?.account_id as string | null) ?? null;
  }

  const row = {
    merchant_name: merchantName,
    cadence: data.cadence,
    kind: data.kind === "income" ? "income" : "expense",
    typical_amount: amount,
    currency: data.currency,
    start_date: data.startDate,
    status: data.status === "ended" ? "ended" : "active",
    account_id: accountId,
    logo_domain: data.logoDomain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null,
    logo_url: data.logoUrl?.trim() || null,
    category_id: (lastCat?.category_id as string | null) ?? null,
    next_expected_date: firstOccurrenceOnOrAfter(data.cadence, data.startDate, today()),
  };

  let id: string;
  if (data.id) {
    const { data: existing } = await supabase
      .from("recurring_streams")
      .select("id")
      .eq("id", data.id)
      .eq("space_id", space.id)
      .maybeSingle();
    if (!existing) return { error: "Recurring item not found." };
    const { error } = await supabase
      .from("recurring_streams")
      .update(row)
      .eq("id", data.id);
    if (error) return { error: error.message };
    id = data.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("recurring_streams")
      .insert({ space_id: space.id, ...row })
      .select("id")
      .single();
    if (error) return { error: error.message };
    id = inserted.id as string;
  }

  // Claim this merchant's untagged transactions for the stream.
  await supabase
    .from("transactions")
    .update({ recurring_stream_id: id })
    .eq("space_id", space.id)
    .eq("name", merchantName)
    .is("recurring_stream_id", null);

  revalidatePath("/recurring");
  revalidatePath("/transactions");
  return { error: null, id };
}

export async function searchRecurringMerchants(q: string): Promise<{
  error: string | null;
  results: {
    name: string;
    count: number;
    lastDate: string;
    typicalAmount: number;
    currency: string;
    streamId: string | null;
    direction: "in" | "out";
  }[];
}> {
  // Empty q returns EVERY merchant — the modal loads the full list once
  // and filters it in memory, so search covers merchants not yet rendered.
  const { supabase, space } = await getContext();
  const query = q.trim();

  let dbq = supabase
    .from("transactions")
    .select("name, date, amount, currency")
    .eq("space_id", space.id)
    .order("date", { ascending: false })
    .limit(5000);
  if (query.length >= 2) {
    dbq = dbq.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const { data: txns, error } = await dbq;
  if (error) return { error: error.message, results: [] };

  const groups = new Map<
    string,
    {
      count: number;
      lastDate: string;
      typicalAmount: number;
      direction: "in" | "out";
      currencies: Map<string, number>;
    }
  >();
  for (const t of txns ?? []) {
    const name = (t.name as string).trim();
    if (!name) continue;
    // Rows arrive newest first, so the first row per name sets lastDate + amount + direction.
    const g = groups.get(name) ?? {
      count: 0,
      lastDate: t.date as string,
      typicalAmount: Math.abs(Number(t.amount)),
      direction: Number(t.amount) > 0 ? ("in" as const) : ("out" as const),
      currencies: new Map<string, number>(),
    };
    g.count++;
    g.currencies.set(t.currency as string, (g.currencies.get(t.currency as string) ?? 0) + 1);
    groups.set(name, g);
  }

  const top = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);

  const streamByName = new Map<string, string>();
  const { data: streams } = await supabase
    .from("recurring_streams")
    .select("id, merchant_name")
    .eq("space_id", space.id)
    .neq("status", "dismissed");
  for (const s of streams ?? []) {
    if (!streamByName.has(s.merchant_name as string)) {
      streamByName.set(s.merchant_name as string, s.id as string);
    }
  }

  return {
    error: null,
    results: top.map(([name, g]) => ({
      name,
      count: g.count,
      lastDate: g.lastDate,
      typicalAmount: g.typicalAmount,
      currency: [...g.currencies.entries()].sort((a, b) => b[1] - a[1])[0][0],
      streamId: streamByName.get(name) ?? null,
      direction: g.direction,
    })),
  };
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

// -------------------------------------------------------------- categories

export async function createCategory(payload: string): Promise<{
  error: string | null;
  id?: string;
}> {
  const { supabase, space } = await getContext();
  let data: {
    name: string;
    name_he: string | null;
    icon: string | null;
    color: string | null;
    group: string;
    kind: "income" | "expense";
    budget_bucket?: "fixed" | "flexible" | "non_monthly";
  };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "Bad category data." };
  }
  if (!data.name?.trim()) return { error: "Name is required." };
  const { data: row, error } = await supabase
    .from("categories")
    .insert({
      space_id: space.id,
      name: data.name.trim(),
      name_he: data.name_he?.trim() || null,
      icon: data.icon || "🏷️",
      color: data.color,
      group: data.group?.trim() || "Custom",
      kind: data.kind === "income" ? "income" : "expense",
      budget_bucket: data.kind === "income" ? null : (data.budget_bucket ?? "flexible"),
      display_order: 9000,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "A category with that name exists." };
    return { error: error.message };
  }
  revalidatePath("/transactions");
  revalidatePath("/budget");
  return { error: null, id: row.id as string };
}

/**
 * Scope a recategorization: optionally create a merchant rule for future
 * syncs and/or fix all historical transactions from this merchant.
 */
export async function applyCategoryScope(
  txnId: string,
  categoryId: string,
  scope: { future: boolean; historical: boolean; amountOnly?: boolean },
): Promise<{ error: string | null; updated?: number }> {
  const { supabase, space } = await getContext();
  const { data: txn } = await supabase
    .from("transactions")
    .select("id, name, amount")
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found." };

  const matchAmount = scope.amountOnly ? Math.abs(Number(txn.amount)) : null;

  if (scope.future) {
    const { error } = await supabase.from("category_rules").upsert(
      {
        space_id: space.id,
        match_type: "merchant",
        match_value: txn.name,
        match_amount: matchAmount,
        category_id: categoryId,
      },
      // Unique constraint is NULLS NOT DISTINCT over all four columns.
      { onConflict: "space_id,match_type,match_value,match_amount" },
    );
    if (error) return { error: error.message };
  }

  let updated = 0;
  if (scope.historical) {
    let query = supabase
      .from("transactions")
      .update({ category_id: categoryId, categorized_by: "user" })
      .eq("space_id", space.id)
      .eq("name", txn.name);
    if (matchAmount != null) {
      query = query.in("amount", [matchAmount, -matchAmount]);
    }
    const { data, error } = await query.select("id");
    if (error) return { error: error.message };
    updated = data?.length ?? 0;
  }
  revalidatePath("/transactions");
  return { error: null, updated };
}

export async function updateCategory(
  categoryId: string,
  patch: {
    name?: string;
    name_he?: string | null;
    icon?: string | null;
    color?: string | null;
  },
): Promise<ActionResult> {
  const { supabase } = await getContext();
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name.trim()) clean.name = patch.name.trim();
  if (patch.name_he !== undefined) clean.name_he = patch.name_he?.trim() || null;
  if (patch.icon !== undefined) clean.icon = patch.icon?.trim() || null;
  if (patch.color !== undefined) clean.color = patch.color;
  const { error } = await supabase
    .from("categories")
    .update(clean)
    .eq("id", categoryId);
  if (error) return { error: error.message };
  revalidatePath("/transactions");
  revalidatePath("/budget");
  return { error: null };
}

export async function setAccountLinkedBank(
  accountId: string,
  linkedAccountId: string | null,
) {
  const { supabase } = await getContext();
  await supabase
    .from("accounts")
    .update({ linked_account_id: linkedAccountId })
    .eq("id", accountId);
  revalidatePath("/accounts");
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
