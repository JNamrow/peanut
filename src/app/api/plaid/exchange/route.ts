import { NextResponse } from "next/server";
import { getContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { plaidPost, syncPlaid } from "@/lib/sync/plaid";
import { writeDailySnapshots } from "@/lib/sync/housekeeping";

export async function POST(request: Request) {
  if (process.env.DEMO_MODE === "1") {
    return NextResponse.json({ error: "Not available in the demo." }, { status: 404 });
  }
  const { space, userId } = await getContext();
  const { public_token, institution_name } = (await request.json()) as {
    public_token: string;
    institution_name?: string;
  };
  if (!public_token) {
    return NextResponse.json({ error: "missing public_token" }, { status: 400 });
  }

  const exchange = await plaidPost<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token },
  );

  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("connections")
    .upsert(
      {
        space_id: space.id,
        provider: "plaid",
        label: institution_name ?? "Plaid",
        institution_name: institution_name ?? null,
        environment: process.env.PLAID_ENV ?? "production",
        external_item_id: exchange.item_id,
        status: "pending",
        created_by: userId,
      },
      { onConflict: "provider,external_item_id" },
    )
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: vaultErr } = await admin.rpc("peanut_vault_set_secret", {
    p_name: `conn_${conn.id}`,
    p_secret: exchange.access_token,
  });
  if (vaultErr) {
    return NextResponse.json({ error: vaultErr.message }, { status: 500 });
  }

  const result = await syncPlaid(conn.id);
  await writeDailySnapshots();
  return NextResponse.json({ connection_id: conn.id, ...result });
}
