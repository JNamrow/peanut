import { NextResponse } from "next/server";
import { getContext } from "@/lib/data";
import { plaidPost } from "@/lib/sync/plaid";

export async function POST() {
  if (process.env.DEMO_MODE === "1") {
    return NextResponse.json({ error: "Not available in the demo." }, { status: 404 });
  }
  try {
    const { userId } = await getContext();
    // Note: no optional_products — this Plaid account has transactions only.
    // Request "investments" at dashboard.plaid.com/overview/request-products
    // to enable Robinhood holdings, then add it back here.
    const data = await plaidPost<{ link_token: string }>("/link/token/create", {
      client_name: "Peanut",
      user: { client_user_id: userId },
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    });
    return NextResponse.json({ link_token: data.link_token });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "link token failed" },
      { status: 500 },
    );
  }
}
