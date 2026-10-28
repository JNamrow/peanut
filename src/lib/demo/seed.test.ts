import { describe, expect, it } from "vitest";
import { RateTable } from "../currency";
import {
  DEMO_PARTNER_ID,
  DEMO_SPACE_ID,
  DEMO_TAXONOMY,
  DEMO_USER_ID,
  buildDemoData,
  type DemoData,
} from "./seed";

// A fixed "now" (local noon) so the suite is stable on any day it runs.
const NOW = new Date(2026, 9, 28, 12, 0, 0);
const TODAY = "2026-10-28";
const data: DemoData = buildDemoData(NOW);

const accountIds = new Set(data.accounts.map((a) => a.id));
const categoryIds = new Set(data.categories.map((c) => c.id));
const streamIds = new Set(data.recurring_streams.map((s) => s.id));
const connectionIds = new Set(data.connections.map((c) => c.id));
const txnById = new Map(data.transactions.map((t) => [t.id, t]));

function findBadNumbers(value: unknown, path: string, out: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findBadNumbers(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) findBadNumbers(v, `${path}.${k}`, out);
  }
}

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("buildDemoData", () => {
  it("is deterministic for a given now", () => {
    expect(buildDemoData(NOW)).toStrictEqual(data);
  });

  it("has the expected shape and row counts", () => {
    expect(data.transactions.length).toBeGreaterThanOrEqual(2000);
    expect(data.transactions.length).toBeLessThanOrEqual(3500);
    expect(data.accounts).toHaveLength(11);
    expect(data.categories).toHaveLength(DEMO_TAXONOMY.length);
    expect(data.recurring_streams.filter((s) => s.status === "active").length).toBeGreaterThanOrEqual(14);
    expect(data.spaces).toHaveLength(1);
    expect(data.space_members.map((m) => m.user_id).sort()).toEqual([DEMO_USER_ID, DEMO_PARTNER_ID].sort());
    expect(data.goals).toHaveLength(3);
    expect(data.forecast_settings).toHaveLength(1);
    expect(data.forecast_splits).toEqual([]);
  });

  it("references only rows that exist", () => {
    for (const a of data.accounts) {
      expect(a.space_id).toBe(DEMO_SPACE_ID);
      if (a.connection_id) expect(connectionIds.has(a.connection_id)).toBe(true);
      if (a.linked_account_id) expect(accountIds.has(a.linked_account_id)).toBe(true);
    }
    for (const t of data.transactions) {
      expect(t.space_id).toBe(DEMO_SPACE_ID);
      expect(accountIds.has(t.account_id)).toBe(true);
      if (t.category_id) expect(categoryIds.has(t.category_id)).toBe(true);
      if (t.recurring_stream_id) expect(streamIds.has(t.recurring_stream_id)).toBe(true);
      if (t.connection_id) expect(connectionIds.has(t.connection_id)).toBe(true);
    }
    for (const s of data.account_balance_snapshots) expect(accountIds.has(s.account_id)).toBe(true);
    for (const s of data.recurring_streams) {
      if (s.account_id) expect(accountIds.has(s.account_id)).toBe(true);
      if (s.category_id) expect(categoryIds.has(s.category_id)).toBe(true);
    }
    for (const b of data.budgets) expect(categoryIds.has(b.category_id)).toBe(true);
    for (const a of data.category_aliases) expect(categoryIds.has(a.category_id)).toBe(true);
    for (const r of data.category_rules) expect(categoryIds.has(r.category_id)).toBe(true);
    for (const e of data.transaction_events) expect(txnById.has(e.transaction_id)).toBe(true);
    for (const h of data.holdings) expect(accountIds.has(h.account_id)).toBe(true);
    for (const p of data.pension_configs) expect(accountIds.has(p.account_id)).toBe(true);
    const goalIds = new Set(data.goals.map((g) => g.id));
    for (const l of data.goal_accounts) {
      expect(goalIds.has(l.goal_id)).toBe(true);
      expect(accountIds.has(l.account_id)).toBe(true);
    }
    const memberIds = new Set(data.space_members.map((m) => m.user_id));
    for (const i of data.forecast_incomes) {
      if (i.member_user_id) expect(memberIds.has(i.member_user_id)).toBe(true);
    }
  });

  it("has unique ids where ids exist", () => {
    const uniq = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);
    uniq(data.transactions.map((t) => t.id));
    uniq(data.transactions.map((t) => `${t.connection_id ?? "manual"}|${t.external_id}`));
    uniq(data.accounts.map((a) => a.id));
    uniq(data.categories.map((c) => c.id));
    uniq(data.recurring_streams.map((s) => s.id));
    uniq(data.transaction_events.map((e) => e.id));
    uniq(data.account_balance_snapshots.map((s) => `${s.account_id}|${s.as_of_date}`));
    uniq(data.fx_rates.map((r) => `${r.base}${r.quote}${r.rate_date}`));
    for (const id of [...accountIds, ...categoryIds, ...streamIds]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("has no NaN or non-finite numbers, and money is numeric", () => {
    const bad: string[] = [];
    findBadNumbers(data, "data", bad);
    expect(bad).toEqual([]);
    for (const t of data.transactions) expect(typeof t.amount).toBe("number");
    for (const s of data.account_balance_snapshots) expect(typeof s.balance).toBe("number");
    for (const r of data.fx_rates) expect(typeof r.rate).toBe("number");
    for (const b of data.budgets) expect(typeof b.amount).toBe("number");
    for (const a of data.accounts) expect(typeof a.current_balance).toBe("number");
  });

  it("never dates history after now", () => {
    for (const t of data.transactions) expect(t.date <= TODAY).toBe(true);
    for (const s of data.account_balance_snapshots) expect(s.as_of_date <= TODAY).toBe(true);
    for (const s of data.recurring_streams) expect((s.start_date ?? "") <= TODAY).toBe(true);
    for (const e of data.transaction_events) expect(e.created_at.slice(0, 10) <= TODAY).toBe(true);
    for (const b of data.budgets) expect(b.month <= TODAY).toBe(true);
    for (const c of data.connections) expect((c.last_synced_at ?? "") <= NOW.toISOString()).toBe(true);
    // FX runs a couple of weeks ahead on purpose, and no further.
    const lastFx = data.fx_rates[data.fx_rates.length - 1].rate_date;
    expect(lastFx > TODAY).toBe(true);
    expect(lastFx <= daysAgo(-14)).toBe(true);
  });

  it("ends every account's snapshots on its current balance", () => {
    for (const a of data.accounts) {
      const mine = data.account_balance_snapshots.filter((s) => s.account_id === a.id);
      expect(mine.length).toBeGreaterThan(0);
      const last = mine.reduce((best, s) => (s.as_of_date > best.as_of_date ? s : best), mine[0]);
      expect(Math.abs(last.balance - Number(a.current_balance))).toBeLessThan(0.01);
      expect(last.as_of_date).toBe(TODAY);
    }
    // Bank, card and loan accounts get one row per day of the window.
    const daily = data.accounts.filter((a) => ["checking", "savings", "credit", "loan"].includes(a.type));
    for (const a of daily) {
      const n = data.account_balance_snapshots.filter((s) => s.account_id === a.id).length;
      expect(n).toBeGreaterThan(700);
    }
  });

  it("pairs transfers so each side points at the other", () => {
    let pairs = 0;
    for (const t of data.transactions) {
      if (!t.transfer_pair_id) continue;
      const other = txnById.get(t.transfer_pair_id);
      expect(other).toBeDefined();
      if (!other) continue;
      expect(other.transfer_pair_id).toBe(t.id);
      expect(t.is_transfer && other.is_transfer).toBe(true);
      if (t.currency === other.currency) expect(Math.abs(t.amount + other.amount)).toBeLessThan(0.005);
      else expect(Math.sign(t.amount)).toBe(-Math.sign(other.amount)); // the Wise leg crosses currencies
      pairs++;
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it("stores card balances as negative outstanding amounts", () => {
    const cards = data.accounts.filter((a) => a.type === "credit");
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(Number(c.current_balance)).toBeLessThan(0);
      expect(c.is_liability).toBe(true);
      expect(c.linked_account_id).not.toBeNull();
    }
    const loan = data.accounts.find((a) => a.type === "loan");
    expect(Number(loan?.current_balance)).toBeLessThan(0);
  });

  it("expects every recurring stream after today and matches its rows by name", () => {
    for (const s of data.recurring_streams) {
      expect((s.next_expected_date ?? "") > TODAY).toBe(true);
      if (s.status !== "active") continue;
      const linked = data.transactions.filter((t) => t.recurring_stream_id === s.id);
      expect(linked.length).toBeGreaterThan(0);
      for (const t of linked) {
        expect(t.name).toBe(s.merchant_name);
        expect(t.currency).toBe(s.currency);
        expect(s.kind === "income" ? t.amount > 0 : t.amount < 0).toBe(true);
      }
    }
  });

  it("flags a few pending rows in the last week and reviews most of the rest", () => {
    const pending = data.transactions.filter((t) => t.pending);
    expect(pending.length).toBeGreaterThanOrEqual(3);
    expect(pending.length).toBeLessThanOrEqual(5);
    for (const t of pending) {
      expect(t.date >= daysAgo(6)).toBe(true);
      expect(t.reviewed).toBe(false);
    }
    const reviewedShare = data.transactions.filter((t) => t.reviewed).length / data.transactions.length;
    expect(reviewedShare).toBeGreaterThan(0.75);
    expect(reviewedShare).toBeLessThan(0.95);
  });

  it("marks card bills and inter-account moves as transfers", () => {
    const ccp = data.categories.find((c) => c.name === "Credit Card Payment");
    const bills = data.transactions.filter((t) => t.category_id === ccp?.id);
    expect(bills.length).toBeGreaterThan(60);
    for (const b of bills) {
      expect(b.is_transfer).toBe(true);
      expect(b.payment_method).toBe("transfer");
      expect(b.transfer_pair_id).not.toBeNull();
    }
    for (const t of data.transactions) {
      const acc = data.accounts.find((a) => a.id === t.account_id);
      expect(t.source).toBe(acc?.source);
      if (t.is_transfer) expect(t.payment_method).toBe("transfer");
      else expect(t.payment_method).toBe(acc?.type === "credit" ? "card" : "bank");
    }
  });

  it("feeds RateTable for any date in the window", () => {
    const rates = new RateTable(data.fx_rates);
    const now = rates.convert(100, "USD", "ILS", TODAY);
    expect(now).toBeGreaterThanOrEqual(335);
    expect(now).toBeLessThanOrEqual(385);
    const earlier = rates.convert(100, "USD", "ILS", "2025-02-15");
    expect(earlier).toBeGreaterThanOrEqual(335);
    expect(earlier).toBeLessThanOrEqual(385);
    expect(rates.convert(370, "ILS", "USD")).toBeGreaterThan(90);
    for (const r of data.fx_rates) {
      expect(r.base).toBe("USD");
      expect(r.quote).toBe("ILS");
      expect(String(r.rate).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
    }
  });
});

describe("member id remap", () => {
  it("points every member reference at the given auth ids", () => {
    const ids = { userId: "11111111-1111-4111-8111-111111111111", partnerId: "22222222-2222-4222-8222-222222222222" };
    const data = buildDemoData(new Date("2026-10-28T12:00:00"), ids);
    expect(data.space_members.map((m) => m.user_id).sort()).toEqual([ids.userId, ids.partnerId].sort());
    expect(data.accounts.every((a) => a.owner_user_id === ids.userId || a.owner_user_id === ids.partnerId)).toBe(true);
    expect(data.forecast_incomes.map((i) => i.member_user_id).sort()).toEqual([ids.userId, ids.partnerId].sort());
    expect(JSON.stringify(data)).not.toContain(DEMO_USER_ID);
  });
});
