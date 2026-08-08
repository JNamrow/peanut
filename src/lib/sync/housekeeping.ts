import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

import { CARD_BILL_PATTERNS_BY_INSTITUTION } from "./riseup";

/**
 * RiseUp has no balances API. Two rules keep balances honest anyway:
 * - Bank accounts: user sets an anchor once; balance = anchor + txns
 *   since. On first anchor we also BACKFILL daily history from the
 *   12 months of transactions, so net-worth charts light up instantly.
 * - Credit cards: balance = the charges accumulated since the last
 *   bill debit hit the linked bank account (shown as negative,
 *   "pending" — it has not left the bank yet).
 */
export async function rollForwardRiseupBalances(): Promise<number> {
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, type, institution_name, linked_account_id, balance_anchor, balance_anchor_date, currency")
    .eq("source", "riseup")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  let updated = 0;

  for (const a of accounts ?? []) {
    if (a.type === "credit") {
      // ---- card cycle balance
      const patterns =
        CARD_BILL_PATTERNS_BY_INSTITUTION[a.institution_name ?? ""] ?? [];
      let lastBill: string | null = null;
      if (patterns.length && a.linked_account_id) {
        const ors = patterns.map((p) => `name.ilike.%${p}%`).join(",");
        const { data: bill } = await admin
          .from("transactions")
          .select("date")
          .eq("account_id", a.linked_account_id)
          .eq("is_transfer", true)
          .or(ors)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        lastBill = (bill?.date as string) ?? null;
      }
      const since =
        lastBill ?? new Date().toISOString().slice(0, 8) + "01";
      const { data: charges } = await admin
        .from("transactions")
        .select("amount")
        .eq("account_id", a.id)
        .gt("date", since);
      const cycle = (charges ?? []).reduce((s, t) => s + Number(t.amount), 0);
      const balance = Math.round(cycle * 100) / 100; // negative = owed
      await admin
        .from("accounts")
        .update({ current_balance: balance })
        .eq("id", a.id);
      updated++;
      continue;
    }

    // ---- bank accounts need an anchor
    if (a.balance_anchor == null || !a.balance_anchor_date) continue;
    const anchorDate = a.balance_anchor_date as string;
    const anchor = Number(a.balance_anchor);

    const { data: txns } = await admin
      .from("transactions")
      .select("date, amount")
      .eq("account_id", a.id)
      .order("date");
    const list = (txns ?? []) as { date: string; amount: number }[];

    // Current balance = anchor + txns after the anchor date.
    const delta = list
      .filter((t) => t.date > anchorDate)
      .reduce((s, t) => s + Number(t.amount), 0);
    const balance = Math.round((anchor + delta) * 100) / 100;
    await admin.from("accounts").update({ current_balance: balance }).eq("id", a.id);
    updated++;

    // One-time history backfill: if nothing exists before the anchor date,
    // reconstruct daily balances from the transaction stream.
    if (list.length === 0) continue;
    const { count } = await admin
      .from("account_balance_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("account_id", a.id)
      .lt("as_of_date", anchorDate);
    if ((count ?? 0) > 0) continue;

    const start = list[0].date < anchorDate ? list[0].date : anchorDate;
    // F(D) = sum of txns with date <= D; balance(D) = anchor + F(D) - F(anchorDate)
    const fAnchor = list
      .filter((t) => t.date <= anchorDate)
      .reduce((s, t) => s + Number(t.amount), 0);
    const rows: {
      account_id: string;
      as_of_date: string;
      balance: number;
      currency: string;
      source: string;
    }[] = [];
    let f = 0;
    let i = 0;
    const end = new Date();
    for (
      let d = new Date(`${start}T00:00:00`);
      d <= end;
      d.setDate(d.getDate() + 1)
    ) {
      const ds = d.toISOString().slice(0, 10);
      while (i < list.length && list[i].date <= ds) {
        f += Number(list[i].amount);
        i++;
      }
      rows.push({
        account_id: a.id as string,
        as_of_date: ds,
        balance: Math.round((anchor + f - fAnchor) * 100) / 100,
        currency: a.currency as string,
        source: "interpolated",
      });
    }
    for (let j = 0; j < rows.length; j += 200) {
      await admin
        .from("account_balance_snapshots")
        .upsert(rows.slice(j, j + 200), { onConflict: "account_id,as_of_date" });
    }
  }
  return updated;
}

/** Snapshot today's balance for every live account that has one. */
export async function writeDailySnapshots(): Promise<number> {
  await rollForwardRiseupBalances();
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, current_balance, currency")
    .is("deleted_at", null)
    .not("current_balance", "is", null);
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (accounts ?? []).map((a) => ({
    account_id: a.id,
    as_of_date: today,
    balance: a.current_balance,
    currency: a.currency,
    source: "sync",
  }));
  if (rows.length) {
    const { error: upErr } = await admin
      .from("account_balance_snapshots")
      .upsert(rows, { onConflict: "account_id,as_of_date" });
    if (upErr) throw new Error(upErr.message);
  }
  return rows.length;
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  semiyearly: 182,
  yearly: 365,
};

/**
 * Simple recurring detection: same merchant, >=3 charges, near-regular
 * spacing, similar amounts. New candidates land as 'suggested'.
 */
export async function detectRecurring(spaceId: string): Promise<number> {
  const admin = createAdminClient();
  const since = new Date();
  since.setMonth(since.getMonth() - 13);
  const { data: txns, error } = await admin
    .from("transactions")
    .select("name, account_id, date, amount, currency")
    .eq("space_id", spaceId)
    .eq("is_transfer", false)
    .eq("hide_from_reports", false)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date");
  if (error) throw new Error(error.message);

  const { data: existing } = await admin
    .from("recurring_streams")
    .select("merchant_name")
    .eq("space_id", spaceId);
  const known = new Set((existing ?? []).map((r) => r.merchant_name as string));

  const groups = new Map<string, { date: string; amount: number; currency: string; account_id: string }[]>();
  for (const t of txns ?? []) {
    const key = (t.name as string).trim();
    if (!key || known.has(key)) continue;
    const arr = groups.get(key) ?? [];
    arr.push(t as { date: string; amount: number; currency: string; account_id: string });
    groups.set(key, arr);
  }

  let created = 0;
  for (const [merchant, list] of groups) {
    if (list.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push(
        (new Date(list[i].date).getTime() - new Date(list[i - 1].date).getTime()) /
          86400000,
      );
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const cadence = Object.entries(CADENCE_DAYS).find(
      ([, d]) => Math.abs(avgGap - d) <= d * 0.2,
    )?.[0];
    if (!cadence) continue;
    const regular = gaps.every(
      (g) => Math.abs(g - avgGap) <= Math.max(4, avgGap * 0.25),
    );
    if (!regular) continue;
    const amounts = list.map((t) => Math.abs(Number(t.amount)));
    const avgAmt = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const similar = amounts.every((a) => Math.abs(a - avgAmt) <= avgAmt * 0.3);
    if (!similar || avgAmt < 1) continue;

    const last = list[list.length - 1];
    const next = new Date(last.date);
    next.setDate(next.getDate() + Math.round(avgGap));
    await admin.from("recurring_streams").insert({
      space_id: spaceId,
      merchant_name: merchant,
      account_id: last.account_id,
      cadence,
      typical_amount: Math.round(avgAmt * 100) / 100,
      currency: last.currency,
      next_expected_date: next.toISOString().slice(0, 10),
      kind: Number(last.amount) > 0 ? "income" : "expense",
      status: "suggested",
    });
    created++;
  }
  return created;
}
