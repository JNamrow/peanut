import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncFxLatest } from "@/lib/sync/fx";
import { syncRiseup, markRiseupError } from "@/lib/sync/riseup";
import { syncPlaid } from "@/lib/sync/plaid";
import { syncFinancy, markFinancyError, describeFinancyError } from "@/lib/sync/financy";
import { applyPensionDrift } from "@/lib/sync/pensions";
import { writeDailySnapshots } from "@/lib/sync/housekeeping";

export const maxDuration = 300;

/** Daily sync. Vercel Cron calls GET with Authorization: Bearer CRON_SECRET. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report: Record<string, unknown> = {};
  try {
    report.fx = await syncFxLatest();
  } catch (e) {
    report.fx_error = String(e);
  }

  const admin = createAdminClient();
  const { data: conns } = await admin
    .from("connections")
    .select("id, provider, status")
    .in("provider", ["riseup", "plaid", "financy"])
    .neq("status", "disconnected");

  for (const c of conns ?? []) {
    try {
      if (c.provider === "riseup") await syncRiseup(c.id);
      else if (c.provider === "financy") await syncFinancy(c.id);
      else await syncPlaid(c.id);
      report[c.id] = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (c.provider === "riseup") await markRiseupError(c.id, msg);
      if (c.provider === "financy") await markFinancyError(c.id, describeFinancyError(e));
      report[c.id] = msg;
    }
  }

  try {
    report.pensions = await applyPensionDrift();
  } catch (e) {
    report.pensions_error = String(e);
  }
  report.snapshots = await writeDailySnapshots();

  return NextResponse.json(report);
}
