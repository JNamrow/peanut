import type { Category, Transaction } from "./types";
import { RateTable } from "./currency";

export interface CashflowTotals {
  income: number;
  expense: number; // positive number
  savings: number;
  savingsRate: number; // 0..1
  incomeByCategory: Map<string, number>;
  expenseByCategory: Map<string, number>;
}

/**
 * Monarch semantics: transfers (category kind) and hidden transactions are
 * excluded. Income = income-kind sums; refunds reduce expenses.
 * Amounts convert to the display currency at the transaction's date.
 */
export function computeCashflow(
  txns: Transaction[],
  categories: Category[],
  rates: RateTable,
  displayCurrency: string,
): CashflowTotals {
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
  let income = 0;
  let expense = 0;
  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();

  for (const t of txns) {
    if (t.hide_from_reports || t.is_transfer) continue;
    const kind = t.category_id
      ? (kindOf.get(t.category_id) ?? (t.amount > 0 ? "income" : "expense"))
      : t.amount > 0
        ? "income"
        : "expense";
    if (kind === "transfer") continue;
    const v = rates.convert(Number(t.amount), t.currency, displayCurrency, t.date);
    const key = t.category_id ?? "uncategorized";
    if (kind === "income") {
      income += v;
      incomeByCategory.set(key, (incomeByCategory.get(key) ?? 0) + v);
    } else {
      expense += -v;
      expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + -v);
    }
  }
  const savings = income - expense;
  return {
    income,
    expense,
    savings,
    savingsRate: income > 0 ? savings / income : 0,
    incomeByCategory,
    expenseByCategory,
  };
}
