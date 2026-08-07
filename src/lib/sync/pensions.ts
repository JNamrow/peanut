import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// data.gov.il CKAN datastore resources (רשות שוק ההון), 2024->today.
const RESOURCES: Record<string, string> = {
  pensianet: "6d47d6b5-cb08-488b-b333-f1e717b1e1bd",
  gemelnet: "a30dcbea-a1d2-482c-ae29-8f781f5025fb",
};

interface YieldRow {
  REPORT_PERIOD: number; // YYYYMM
  MONTHLY_YIELD: number; // percent, gross of personal fees
  FUND_NAME?: string;
}

async function fetchYields(
  dataset: string,
  fundId: number,
  limit = 36,
): Promise<YieldRow[]> {
  const resource = RESOURCES[dataset];
  if (!resource) throw new Error(`Unknown dataset ${dataset}`);
  const url =
    `https://data.gov.il/api/3/action/datastore_search?resource_id=${resource}` +
    `&filters=${encodeURIComponent(JSON.stringify({ FUND_ID: fundId }))}` +
    `&sort=${encodeURIComponent("REPORT_PERIOD desc")}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`data.gov.il: HTTP ${res.status}`);
  const json = (await res.json()) as {
    success: boolean;
    result?: { records?: YieldRow[] };
  };
  if (!json.success) throw new Error("data.gov.il: success=false");
  return json.result?.records ?? [];
}

function periodToMonthEnd(period: number): string {
  const y = Math.floor(period / 100);
  const m = period % 100;
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/**
 * Anchor + drift: from the anchor balance, apply each published monthly
 * track yield (net of the personal management fee) plus the monthly
 * contribution. Writes a snapshot per applied month.
 */
export async function applyPensionDrift(): Promise<{
  accounts: number;
  applied: number;
}> {
  const admin = createAdminClient();
  const { data: configs, error } = await admin
    .from("pension_configs")
    .select("*, accounts!inner(id, space_id, currency, deleted_at)");
  if (error) throw new Error(error.message);

  let applied = 0;
  let touched = 0;
  for (const cfg of configs ?? []) {
    const account = cfg.accounts as {
      id: string;
      currency: string;
      deleted_at: string | null;
    };
    if (account.deleted_at) continue;
    if (cfg.anchor_balance == null || !cfg.anchor_date) continue;

    const anchorPeriod = Number(
      String(cfg.anchor_date).slice(0, 7).replace("-", ""),
    );
    const lastApplied = cfg.last_applied_period
      ? Number(cfg.last_applied_period)
      : anchorPeriod;

    const rows = await fetchYields(cfg.dataset as string, Number(cfg.fund_id));
    const pending = rows
      .filter((r) => Number(r.REPORT_PERIOD) > lastApplied)
      .sort((a, b) => Number(a.REPORT_PERIOD) - Number(b.REPORT_PERIOD));
    if (pending.length === 0) continue;

    // Rebuild from the last committed balance.
    let balance = Number(cfg.last_applied_period ? 0 : cfg.anchor_balance);
    if (cfg.last_applied_period) {
      const { data: snap } = await admin
        .from("account_balance_snapshots")
        .select("balance")
        .eq("account_id", account.id)
        .eq("as_of_date", periodToMonthEnd(lastApplied))
        .maybeSingle();
      balance = Number(snap?.balance ?? cfg.anchor_balance);
    }

    const feeMonthly = Number(cfg.annual_fee_pct ?? 0) / 12;
    const contribution = Number(cfg.monthly_contribution ?? 0);
    const depositFee = Number(cfg.deposit_fee_pct ?? 0) / 100;

    let lastPeriod = lastApplied;
    for (const r of pending) {
      const yieldNet = Number(r.MONTHLY_YIELD) - feeMonthly;
      balance = balance * (1 + yieldNet / 100) + contribution * (1 - depositFee);
      lastPeriod = Number(r.REPORT_PERIOD);
      await admin.from("account_balance_snapshots").upsert(
        {
          account_id: account.id,
          as_of_date: periodToMonthEnd(lastPeriod),
          balance: Math.round(balance * 100) / 100,
          currency: account.currency,
          source: "interpolated",
        },
        { onConflict: "account_id,as_of_date" },
      );
      applied++;
    }

    await admin
      .from("accounts")
      .update({ current_balance: Math.round(balance * 100) / 100 })
      .eq("id", account.id);
    await admin
      .from("pension_configs")
      .update({
        last_applied_period: String(lastPeriod),
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", account.id);
    touched++;
  }
  return { accounts: touched, applied };
}

export async function lookupFund(
  dataset: string,
  query: string,
): Promise<{ fundId: number; name: string; lastPeriod: number }[]> {
  const resource = RESOURCES[dataset];
  const url =
    `https://data.gov.il/api/3/action/datastore_search?resource_id=${resource}` +
    `&q=${encodeURIComponent(query)}&sort=${encodeURIComponent("REPORT_PERIOD desc")}&limit=40`;
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as {
    result?: { records?: (YieldRow & { FUND_ID: number })[] };
  };
  const seen = new Map<number, { fundId: number; name: string; lastPeriod: number }>();
  for (const r of json.result?.records ?? []) {
    if (!seen.has(r.FUND_ID)) {
      seen.set(r.FUND_ID, {
        fundId: r.FUND_ID,
        name: r.FUND_NAME ?? String(r.FUND_ID),
        lastPeriod: Number(r.REPORT_PERIOD),
      });
    }
  }
  return [...seen.values()];
}
