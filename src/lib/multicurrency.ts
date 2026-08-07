import type { Account, BalanceSnapshot, Category, Transaction } from "./types";
import { ymd } from "./format";

/** Fixed display order: shekels first, then dollars, then anything else. */
export function currencyOrder(currencies: Iterable<string>): string[] {
  const set = new Set(currencies);
  const known = ["ILS", "USD"].filter((c) => set.has(c));
  const rest = [...set].filter((c) => c !== "ILS" && c !== "USD").sort();
  return [...known, ...rest];
}

export interface CurrencyTotals {
  assets: number;
  liabilities: number;
  net: number;
}

/** Net worth per currency — no conversion, shekels stay shekels. */
export function sumBalancesByCurrency(
  accounts: Account[],
): Map<string, CurrencyTotals> {
  const out = new Map<string, CurrencyTotals>();
  for (const a of accounts) {
    if (!a.include_in_net_worth || a.hidden || a.deleted_at) continue;
    if (a.current_balance == null) continue;
    const t = out.get(a.currency) ?? { assets: 0, liabilities: 0, net: 0 };
    const v = Number(a.current_balance);
    if (a.is_liability) t.liabilities += Math.abs(v);
    else t.assets += v;
    t.net = t.assets - t.liabilities;
    out.set(a.currency, t);
  }
  return out;
}

/** Daily net-worth series per currency (carry-forward, no FX). */
export function buildSeriesPerCurrency(
  accounts: Account[],
  snapshots: BalanceSnapshot[],
  days: number,
): Map<string, { date: string; value: number }[]> {
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
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const startStr = ymd(start);

  const cursor = new Map<string, number>();
  const lastVal = new Map<string, number>();
  for (const a of included) {
    const arr = byAccount.get(a.id) ?? [];
    let i = 0;
    while (i < arr.length && arr[i].as_of_date < startStr) i++;
    if (i > 0) lastVal.set(a.id, Number(arr[i - 1].balance));
    cursor.set(a.id, i);
  }

  const out = new Map<string, { date: string; value: number }[]>();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    for (const a of included) {
      const arr = byAccount.get(a.id) ?? [];
      let i = cursor.get(a.id) ?? 0;
      while (i < arr.length && arr[i].as_of_date <= date) {
        lastVal.set(a.id, Number(arr[i].balance));
        i++;
      }
      cursor.set(a.id, i);
    }
    const perCcy = new Map<string, { total: number; any: boolean }>();
    for (const a of included) {
      const v = lastVal.get(a.id);
      if (v == null) continue;
      const e = perCcy.get(a.currency) ?? { total: 0, any: false };
      e.total += a.is_liability ? -Math.abs(v) : v;
      e.any = true;
      perCcy.set(a.currency, e);
    }
    for (const [ccy, e] of perCcy) {
      if (!e.any) continue;
      const arr = out.get(ccy) ?? [];
      arr.push({ date, value: Math.round(e.total * 100) / 100 });
      out.set(ccy, arr);
    }
  }
  return out;
}

export interface CcyCashflow {
  income: number;
  expense: number; // positive
  savings: number;
  savingsRate: number;
  incomeByCategory: Map<string, number>;
  expenseByCategory: Map<string, number>;
}

/**
 * Cash flow per currency — native sums, zero conversion.
 * Monarch semantics: transfer-kind categories and hidden txns excluded.
 */
export function computeCashflowPerCurrency(
  txns: Transaction[],
  categories: Category[],
): Map<string, CcyCashflow> {
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
  const out = new Map<string, CcyCashflow>();
  for (const t of txns) {
    if (t.hide_from_reports || t.is_transfer) continue;
    const kind = t.category_id
      ? (kindOf.get(t.category_id) ?? (Number(t.amount) > 0 ? "income" : "expense"))
      : Number(t.amount) > 0
        ? "income"
        : "expense";
    if (kind === "transfer") continue;
    const cf =
      out.get(t.currency) ??
      ({
        income: 0,
        expense: 0,
        savings: 0,
        savingsRate: 0,
        incomeByCategory: new Map(),
        expenseByCategory: new Map(),
      } as CcyCashflow);
    const v = Number(t.amount);
    const key = t.category_id ?? "uncategorized";
    if (kind === "income") {
      cf.income += v;
      cf.incomeByCategory.set(key, (cf.incomeByCategory.get(key) ?? 0) + v);
    } else {
      cf.expense += -v;
      cf.expenseByCategory.set(key, (cf.expenseByCategory.get(key) ?? 0) + -v);
    }
    out.set(t.currency, cf);
  }
  for (const cf of out.values()) {
    cf.savings = cf.income - cf.expense;
    cf.savingsRate = cf.income > 0 ? cf.savings / cf.income : 0;
  }
  return out;
}

/** Currencies that actually exist in a set of accounts. */
export function activeCurrencies(accounts: Account[]): string[] {
  return currencyOrder(
    accounts.filter((a) => !a.hidden && !a.deleted_at).map((a) => a.currency),
  );
}
