import "server-only";

// Daily benchmark closes from stooq.com's free CSV endpoint (no API key).
// CSV shape: Date,Open,High,Low,Close,Volume — one row per trading day.

export type BenchmarkKey = "spy" | "qqq" | "vt";

export const BENCHMARKS: Record<
  BenchmarkKey,
  { stooq: string; label: string; color: string }
> = {
  spy: { stooq: "spy.us", label: "S&P 500", color: "#63b3d9" },
  qqq: { stooq: "qqq.us", label: "Nasdaq 100", color: "#8f7ad6" },
  vt: { stooq: "vt.us", label: "World", color: "#4f8f8b" },
};

export function isBenchmarkKey(v: string | undefined): v is BenchmarkKey {
  return v === "spy" || v === "qqq" || v === "vt";
}

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
}

// Benchmark prices move once a day — cache the full history per symbol
// for 12 hours and slice per request. Stale cache is served on fetch failure.
const TTL_MS = 12 * 60 * 60 * 1000;
const closeCache = new Map<string, { rows: DailyClose[]; at: number }>();

function parseCsv(text: string): DailyClose[] {
  const rows: DailyClose[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(",");
    if (parts.length < 5) continue;
    const date = parts[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // skips the header row
    const close = Number(parts[4]);
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push({ date, close });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchCloses(symbol: string, since: string): Promise<DailyClose[]> {
  const cached = closeCache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.rows.filter((r) => r.date >= since);
  }
  try {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${symbol}&i=d`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`stooq: HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    if (rows.length === 0) throw new Error("stooq: empty CSV");
    closeCache.set(symbol, { rows, at: Date.now() });
    return rows.filter((r) => r.date >= since);
  } catch {
    if (cached) return cached.rows.filter((r) => r.date >= since);
    return [];
  }
}

/** Daily closes for a benchmark since a date (inclusive). Errors -> []. */
export async function getBenchmarkCloses(
  key: BenchmarkKey,
  since: string,
): Promise<DailyClose[]> {
  return fetchCloses(BENCHMARKS[key].stooq, since);
}

/**
 * Monarch-style backtest: price TODAY'S holdings backwards with market
 * history. Returns a daily % -change series, or null when fewer than two
 * holdings' prices resolve.
 */
export async function backtestHoldings(
  holdings: { symbol: string; quantity: number }[],
  since: string,
): Promise<{ date: string; pct: number }[] | null> {
  const bySymbol = new Map<string, number>();
  for (const h of holdings) {
    if (!h.symbol || !h.quantity) continue;
    const s = h.symbol.trim().toLowerCase();
    if (!/^[a-z.]{1,6}$/.test(s)) continue;
    bySymbol.set(s, (bySymbol.get(s) ?? 0) + h.quantity);
  }
  const symbols = [...bySymbol.keys()].slice(0, 15);
  if (symbols.length === 0) return null;

  const seriesList = await Promise.all(
    symbols.map((s) => fetchCloses(`${s}.us`, since)),
  );
  const priced = symbols
    .map((s, i) => ({ symbol: s, qty: bySymbol.get(s)!, closes: seriesList[i] }))
    .filter((x) => x.closes.length > 1);
  if (priced.length === 0) return null;

  // Use the union of trading days; carry each symbol's last price forward.
  const days = [...new Set(priced.flatMap((p) => p.closes.map((c) => c.date)))].sort();
  const values: { date: string; value: number }[] = [];
  const cursors = priced.map(() => 0);
  const lastPrice = priced.map((p) => p.closes[0].close);
  for (const day of days) {
    let total = 0;
    priced.forEach((p, i) => {
      while (cursors[i] < p.closes.length && p.closes[cursors[i]].date <= day) {
        lastPrice[i] = p.closes[cursors[i]].close;
        cursors[i]++;
      }
      total += p.qty * lastPrice[i];
    });
    values.push({ date: day, value: total });
  }
  const base = values[0]?.value;
  if (!base || base <= 0) return null;
  return values.map((v) => ({ date: v.date, pct: ((v.value - base) / base) * 100 }));
}
