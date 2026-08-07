import { NextResponse } from "next/server";
import { getContext } from "@/lib/data";
import { plaidPost } from "@/lib/sync/plaid";

export async function POST() {
  const { userId } = await getContext();
  const data = await plaidPost<{ link_token: string }>("/link/token/create", {
    client_name: "Peanut",
    user: { client_user_id: userId },
    products: ["transactions"],
    optional_products: ["investments"],
    country_codes: ["US"],
    language: "en",
  });
  return NextResponse.json({ link_token: data.link_token });
}
