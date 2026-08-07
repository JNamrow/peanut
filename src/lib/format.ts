import type { Currency } from "./types";

export function fmtMoney(
  amount: number,
  currency: Currency,
  opts: { decimals?: boolean; sign?: boolean; compact?: boolean } = {},
): string {
  const { decimals = true, sign = false, compact = false } = opts;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals && !compact ? 2 : 0,
    maximumFractionDigits: decimals && !compact ? 2 : compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(Math.abs(amount));
  const neg = amount < 0;
  if (sign) return `${neg ? "-" : "+"}${formatted}`;
  return neg ? `-${formatted}` : formatted;
}

export function fmtPct(v: number, decimals = 1): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(decimals)}%`;
}

export function monthLabel(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthStart(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function addMonths(month: string, n: number): string {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return monthStart(d);
}
