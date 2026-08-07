import type { Currency, FxRate } from "./types";

/**
 * Rate table for USD<->ILS (extensible to more pairs later).
 * Rates are stored as base USD -> quote ILS, one row per day.
 * Conversion for a date uses the nearest rate on or before that date.
 */
export class RateTable {
  private dates: string[] = [];
  private rates: number[] = [];

  constructor(rows: FxRate[]) {
    const sorted = rows
      .filter((r) => r.base === "USD" && r.quote === "ILS")
      .sort((a, b) => a.rate_date.localeCompare(b.rate_date));
    this.dates = sorted.map((r) => r.rate_date);
    this.rates = sorted.map((r) => Number(r.rate));
  }

  /** USD->ILS rate at or before `date` (falls back to earliest known). */
  usdIls(date?: string): number {
    if (this.rates.length === 0) return 3.7; // last-resort static fallback
    if (!date) return this.rates[this.rates.length - 1];
    let lo = 0,
      hi = this.dates.length - 1,
      ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return this.rates[ans];
  }

  convert(amount: number, from: Currency, to: Currency, date?: string): number {
    if (from === to) return amount;
    const r = this.usdIls(date);
    if (from === "USD" && to === "ILS") return amount * r;
    if (from === "ILS" && to === "USD") return amount / r;
    return amount; // unknown pair: pass through
  }
}
