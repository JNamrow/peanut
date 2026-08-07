import type { Account, BalanceSnapshot } from "./types";
import { RateTable } from "./currency";
import { ymd } from "./format";

/**
 * Build a daily net-worth series in the display currency.
 * Each account carries its last known snapshot forward. FX is applied
 * at each day's rate, so USD/ILS moves show up in the curve.
 */
export function buildNetWorthSeries(
  accounts: Account[],
  snapshots: BalanceSnapshot[],
  rates: RateTable,
  displayCurrency: string,
  days: number,
): { date: string; value: number }[] {
  const included = accounts.filter(
    (a) => a.include_in_net_worth && !a.hidden && !a.deleted_at,
  );
  const byAccount = new Map<string, BalanceSnapshot[]>();
  for (const s of snapshots) {
    const arr = byAccount.get(s.account_id) ?? [];
    arr.push(s);
    byAccount.set(s.account_id, arr);
  }
  for (const arr of byAccount.values()) {
    arr.sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
  }

  const end = new Date();
  const out: { date: string; value: number }[] = [];
  const cursor = new Map<string, number>(); // account -> index into its snapshots
  const lastVal = new Map<string, { balance: number; currency: string }>();

  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);

  // Prime carry-forward with the last snapshot before the window.
  const startStr = ymd(start);
  for (const a of included) {
    const arr = byAccount.get(a.id) ?? [];
    let i = 0;
    while (i < arr.length && arr[i].as_of_date < startStr) i++;
    if (i > 0) {
      const s = arr[i - 1];
      lastVal.set(a.id, { balance: Number(s.balance), currency: s.currency });
    }
    cursor.set(a.id, i);
  }

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    for (const a of included) {
      const arr = byAccount.get(a.id) ?? [];
      let i = cursor.get(a.id) ?? 0;
      while (i < arr.length && arr[i].as_of_date <= date) {
        lastVal.set(a.id, {
          balance: Number(arr[i].balance),
          currency: arr[i].currency,
        });
        i++;
      }
      cursor.set(a.id, i);
    }
    let total = 0;
    let any = false;
    for (const a of included) {
      const v = lastVal.get(a.id);
      if (!v) continue;
      any = true;
      const signed = a.is_liability ? -Math.abs(v.balance) : v.balance;
      total += rates.convert(signed, v.currency, displayCurrency, date);
    }
    if (any) out.push({ date, value: Math.round(total * 100) / 100 });
  }
  return out;
}
