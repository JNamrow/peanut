import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function host(): string {
  return HOSTS[process.env.PLAID_ENV ?? "production"] ?? HOSTS.production;
}

export async function plaidPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${host()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as T & {
    error_code?: string;
    error_message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `Plaid ${path}: ${json.error_code ?? res.status} ${json.error_message ?? ""}`,
    );
  }
  return json;
}

const TYPE_MAP: Record<string, string> = {
  checking: "checking",
  savings: "savings",
  cd: "savings",
  "money market": "savings",
  hsa: "investment",
  brokerage: "investment",
  ira: "investment",
  "401k": "investment",
  roth: "investment",
  crypto: "investment",
};

function mapAccountType(type: string, subtype: string | null): string {
  if (type === "depository") return TYPE_MAP[subtype ?? ""] ?? "checking";
  if (type === "credit") return "credit";
  if (type === "investment" || type === "brokerage") return "investment";
  if (type === "loan") return "loan";
  return "other_asset";
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
  };
}

/** Upsert accounts + balance snapshots for one item. Returns account map. */
async function refreshAccounts(
  connectionId: string,
  spaceId: string,
  accessToken: string,
  institutionName: string | null,
): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const data = await plaidPost<{ accounts: PlaidAccount[] }>("/accounts/get", {
    access_token: accessToken,
  });
  const map = new Map<string, string>();
  const today = new Date().toISOString().slice(0, 10);
  for (const a of data.accounts) {
    const type = mapAccountType(a.type, a.subtype);
    const currency = a.balances.iso_currency_code ?? "USD";
    const subtype = a.subtype
      ? a.subtype.charAt(0).toUpperCase() + a.subtype.slice(1)
      : a.type.charAt(0).toUpperCase() + a.type.slice(1);
    const { data: row, error } = await admin
      .from("accounts")
      .upsert(
        {
          space_id: spaceId,
          connection_id: connectionId,
          source: "plaid",
          external_id: a.account_id,
          name: a.name,
          official_name: a.official_name,
          institution_name: institutionName,
          mask: a.mask,
          type,
          subtype,
          currency,
          current_balance: a.balances.current,
          available_balance: a.balances.available,
          is_liability: a.type === "credit" || a.type === "loan",
        },
        { onConflict: "connection_id,external_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`Upsert account: ${error.message}`);
    map.set(a.account_id, row.id as string);
    if (a.balances.current != null) {
      await admin.from("account_balance_snapshots").upsert(
        {
          account_id: row.id,
          as_of_date: today,
          balance: a.balances.current,
          currency,
          source: "sync",
        },
        { onConflict: "account_id,as_of_date" },
      );
    }
  }
  return map;
}

/** /transactions/sync with stored cursor; also refreshes balances/holdings. */
export async function syncPlaid(connectionId: string): Promise<{
  added: number;
  modified: number;
  removed: number;
}> {
  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .single();
  if (error || !conn) throw new Error("Connection not found");

  const { data: accessToken } = await admin.rpc("peanut_vault_get_secret", {
    p_name: `conn_${connectionId}`,
  });
  if (!accessToken) throw new Error("Missing Plaid access token in vault");

  const spaceId = conn.space_id as string;
  const accountMap = await refreshAccounts(
    connectionId,
    spaceId,
    String(accessToken),
    (conn.institution_name as string | null) ?? (conn.label as string | null),
  );

  const { data: aliases } = await admin
    .from("category_aliases")
    .select("source_name, category_id")
    .eq("space_id", spaceId)
    .eq("source", "plaid");
  const aliasMap = new Map(
    (aliases ?? []).map((a) => [a.source_name as string, a.category_id as string]),
  );

  let cursor = (conn.config as Record<string, unknown>)?.txn_cursor as
    | string
    | undefined;
  let added = 0,
    modified = 0,
    removed = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await plaidPost<{
      added: PlaidTxn[];
      modified: PlaidTxn[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: String(accessToken),
      cursor,
      count: 500,
    });

    for (const t of [...page.added, ...page.modified]) {
      const accountId = accountMap.get(t.account_id);
      if (!accountId) continue;
      const pfc = t.personal_finance_category?.primary ?? null;
      const categoryId = pfc ? (aliasMap.get(pfc) ?? null) : null;
      const isTransfer =
        pfc === "TRANSFER_IN" || pfc === "TRANSFER_OUT" || pfc === "LOAN_PAYMENTS";
      const { error: upErr } = await admin.from("transactions").upsert(
        {
          space_id: spaceId,
          account_id: accountId,
          connection_id: connectionId,
          source: "plaid",
          external_id: t.transaction_id,
          date: t.date,
          name: t.merchant_name ?? t.name,
          original_name: t.name,
          amount: -t.amount, // Plaid: positive = outflow. Ours: negative = outflow.
          currency: t.iso_currency_code ?? "USD",
          category_id: categoryId,
          categorized_by: categoryId ? "provider" : "none",
          pending: t.pending,
          is_transfer: isTransfer,
          raw: t as unknown as Record<string, unknown>,
        },
        { onConflict: "connection_id,external_id" },
      );
      if (upErr) throw new Error(`Upsert txn: ${upErr.message}`);
    }
    added += page.added.length;
    modified += page.modified.length;

    if (page.removed.length > 0) {
      await admin
        .from("transactions")
        .delete()
        .eq("connection_id", connectionId)
        .in(
          "external_id",
          page.removed.map((r) => r.transaction_id),
        );
      removed += page.removed.length;
    }
    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  // Holdings for investment accounts (best effort — product may be off).
  try {
    const inv = await plaidPost<{
      holdings: {
        account_id: string;
        security_id: string;
        quantity: number;
        institution_price: number | null;
        institution_value: number | null;
        cost_basis: number | null;
        iso_currency_code: string | null;
      }[];
      securities: {
        security_id: string;
        ticker_symbol: string | null;
        name: string | null;
        close_price: number | null;
      }[];
    }>("/investments/holdings/get", { access_token: String(accessToken) });
    const secById = new Map(inv.securities.map((s) => [s.security_id, s]));
    for (const h of inv.holdings) {
      const accountId = accountMap.get(h.account_id);
      if (!accountId) continue;
      const sec = secById.get(h.security_id);
      await admin.from("holdings").upsert(
        {
          account_id: accountId,
          external_id: h.security_id,
          symbol: sec?.ticker_symbol ?? null,
          name: sec?.name ?? null,
          quantity: h.quantity,
          price: h.institution_price ?? sec?.close_price ?? null,
          value: h.institution_value,
          cost_basis: h.cost_basis,
          currency: h.iso_currency_code ?? "USD",
          as_of: new Date().toISOString(),
        },
        { onConflict: "account_id,external_id" },
      );
    }
  } catch {
    // investments product not enabled for this item — fine
  }

  await admin
    .from("connections")
    .update({
      status: "active",
      error: null,
      last_synced_at: new Date().toISOString(),
      config: { ...(conn.config as Record<string, unknown>), txn_cursor: cursor },
    })
    .eq("id", connectionId);

  return { added, modified, removed };
}

interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  personal_finance_category: { primary: string; detailed: string } | null;
}
