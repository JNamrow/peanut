import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * RiseUp has no balances API. If the user set a balance once (the anchor),
 * roll it forward: balance = anchor + sum of transactions since anchor date.
 */
export async function rollForwardRiseupBalances(): Promise<number> {
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, balance_anchor, balance_anchor_date")
    .eq("source", "riseup")
    .not("balance_anchor", "is", null)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  let updated = 0;
  for (const a of accounts ?? []) {
    const { data: sums } = await admin
      .from("transactions")
      .select("amount")
      .eq("account_id", a.id)
      .gt("date", a.balance_anchor_date as string);
    const delta = (sums ?? []).reduce((s, t) => s + Number(t.amount), 0);
    const balance = Math.round((Number(a.balance_anchor) + delta) * 100) / 100;
    await admin.from("accounts").update({ current_balance: balance }).eq("id", a.id);
    updated++;
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
