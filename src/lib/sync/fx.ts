import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Daily USD->ILS closes from frankfurter.dev (ECB, free, no key). */
export async function syncFxLatest(): Promise<number> {
  const res = await fetch(
    "https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`frankfurter: HTTP ${res.status}`);
  const json = (await res.json()) as { date: string; rates: { ILS: number } };
  const admin = createAdminClient();
  await admin.from("fx_rates").upsert(
    {
      rate_date: json.date,
      base: "USD",
      quote: "ILS",
      rate: json.rates.ILS,
    },
    { onConflict: "rate_date,base,quote" },
  );
  return json.rates.ILS;
}

/** One-time backfill of the daily series. */
export async function backfillFx(fromYear = 2019): Promise<number> {
  const admin = createAdminClient();
  let total = 0;
  const thisYear = new Date().getFullYear();
  for (let y = fromYear; y <= thisYear; y++) {
    const from = `${y}-01-01`;
    const to = y === thisYear ? new Date().toISOString().slice(0, 10) : `${y}-12-31`;
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=ILS`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`frankfurter ${y}: HTTP ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, { ILS: number }> };
    const rows = Object.entries(json.rates).map(([date, r]) => ({
      rate_date: date,
      base: "USD",
      quote: "ILS",
      rate: r.ILS,
    }));
    if (rows.length) {
      const { error } = await admin
        .from("fx_rates")
        .upsert(rows, { onConflict: "rate_date,base,quote" });
      if (error) throw new Error(error.message);
      total += rows.length;
    }
  }
  return total;
}
