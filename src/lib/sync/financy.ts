import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCardBillDebit } from "./riseup";
import {
  READABLE_STATUSES,
  RECONNECT_STATUSES,
  financyAccountName,
  financyCategoryKey,
  financyCategoryName,
  financyMask,
  financyTxnAmount,
  financyTxnDate,
  financyTxnName,
  financyWindow,
  mapFinancyAccountType,
  pickFinancyBalance,
  prettyFinancyCategory,
  prettyFinancyInstitution,
  type FinancyAccount,
  type FinancyConnection,
  type FinancyTransaction,
} from "./financy-map";

/**
 * Financy (Open Finance AI): Israeli open banking, supervised by the Bank of
 * Israel. The user links their banks and cards inside the Financy app, then
 * pastes the API credentials from Financy's Settings → API access into
 * Peanut. Peanut only ever reads.
 *
 * Credentials (client id, client secret, user id) are kept as one JSON
 * secret in Supabase Vault under `conn_<connectionId>`, exactly like a
 * RiseUp token. Each sync exchanges them for a short-lived Bearer token.
 *
 * Docs: https://docs-financy.open-finance.ai
 */
const BASE = "https://api.open-finance.ai";

export interface FinancyCredentials {
  clientId: string;
  clientSecret: string;
  userId: string;
}

export class FinancyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
    this.name = "FinancyError";
  }
}

export function parseFinancyCredentials(raw: string): FinancyCredentials {
  let parsed: Partial<FinancyCredentials> = {};
  try {
    parsed = JSON.parse(raw) as Partial<FinancyCredentials>;
  } catch {
    throw new FinancyError("FINANCY_AUTH_FAILED", 401);
  }
  if (!parsed.clientId || !parsed.clientSecret || !parsed.userId) {
    throw new FinancyError("FINANCY_AUTH_FAILED", 401);
  }
  return {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    userId: parsed.userId,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ErrorBody {
  type?: string;
  message?: string;
  status?: string;
}

async function readError(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

function classify(status: number, body: ErrorBody): FinancyError {
  if (status === 401) return new FinancyError("FINANCY_AUTH_FAILED", status, body.type);
  if (status === 403 && body.type === "NOT_AVAILABLE_ON_PLAN") {
    return new FinancyError("FINANCY_PLAN_REQUIRED", status, body.type);
  }
  if (status === 402) return new FinancyError("FINANCY_NO_CREDITS", status, body.type);
  return new FinancyError(
    `Financy HTTP ${status}: ${body.message ?? body.type ?? "request failed"}`,
    status,
    body.type,
  );
}

/** Exchange the long-lived credentials for a short-lived Bearer token. */
export async function financyToken(creds: FinancyCredentials): Promise<string> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await readError(res);
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new FinancyError("FINANCY_AUTH_FAILED", res.status, body.type);
    }
    throw classify(res.status, body);
  }
  const data = (await res.json()) as { accessToken?: string };
  if (!data.accessToken) throw new FinancyError("FINANCY_AUTH_FAILED", 401);
  return data.accessToken;
}

async function financyGet<T>(
  token: string,
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const body = await readError(res);
    const transient = res.status === 423 || res.status === 500 || res.status === 503;
    if (transient && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw classify(res.status, body);
  }
}

/** Walk Financy's `{ items, nextPage }` pages until the cursor runs out. */
async function listAll<T>(
  token: string,
  path: string,
  params: Record<string, string | undefined> = {},
  maxPages = 80,
): Promise<T[]> {
  const out: T[] = [];
  let nextPage: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const data = await financyGet<{ items?: T[]; nextPage?: string | number | null }>(
      token,
      path,
      { ...params, nextPage },
    );
    const items = data.items ?? [];
    out.push(...items);
    const cursor =
      data.nextPage == null || data.nextPage === "" ? undefined : String(data.nextPage);
    if (!cursor || cursor === nextPage || items.length === 0) break;
    nextPage = cursor;
  }
  return out;
}

/** Human wording for the errors a user can act on. */
export function describeFinancyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  switch (msg) {
    case "FINANCY_AUTH_FAILED":
      return "Financy rejected the credentials. Check the client id, client secret and user id under Settings → API access in Financy.";
    case "FINANCY_PLAN_REQUIRED":
      return "Financy's API needs a paid Financy plan (Starter or above). The credentials work, but data calls are refused on the free plan.";
    case "FINANCY_NO_CREDITS":
      return "Financy has no credits left for an on-demand refresh. The scheduled refresh still runs.";
    case "FINANCY_NO_BANKS":
      return "No bank is linked in Financy yet. Link one in the Financy app, then sync again.";
    case "FINANCY_RECONNECT":
      return "Your bank consent in Financy has expired or was revoked. Reconnect the bank in the Financy app, then sync again.";
    case "FINANCY_FETCHING":
      return "Financy is still collecting data from your bank. Sync again in a few minutes.";
    default:
      return msg;
  }
}

/** Errors that need the user, not a retry. */
function isUserActionError(message: string): boolean {
  return /credentials|paid Financy plan|Reconnect the bank|No bank is linked/.test(message);
}

type Admin = ReturnType<typeof createAdminClient>;

export interface FinancyBankSummary {
  id: string;
  institution: string;
  status: string;
  owner: string | null;
  expires: string | null;
  fetched: string | null;
}

function summarizeBanks(banks: FinancyConnection[]): FinancyBankSummary[] {
  return banks.map((b) => ({
    id: b.id,
    institution: prettyFinancyInstitution(b.providerId),
    status: b.status ?? "UNKNOWN",
    owner: b.connectionOwnerName ?? null,
    expires: b.expiryDate ? b.expiryDate.slice(0, 10) : null,
    fetched: b.lastFetchedAt ?? null,
  }));
}

async function loadCredentials(admin: Admin, connectionId: string): Promise<FinancyCredentials> {
  const { data: secret, error } = await admin.rpc("peanut_vault_get_secret", {
    p_name: `conn_${connectionId}`,
  });
  if (error || !secret) throw new FinancyError("FINANCY_AUTH_FAILED", 401);
  return parseFinancyCredentials(String(secret));
}

interface AccountMeta {
  id: string;
  currency: string;
  isCard: boolean;
}

/**
 * Pull every account Financy knows for this user, then the transactions in
 * the window, and upsert both. Financy ids are stable, so there is no
 * re-issued-id dance like RiseUp's; rows are keyed on (connection, id).
 * Balances come straight from the provider, so Financy accounts never need
 * a manual anchor.
 */
export async function syncFinancy(
  connectionId: string,
  opts: { backfillMonths?: number } = {},
): Promise<{ banks: number; accounts: number; upserted: number; skipped: number }> {
  const admin = createAdminClient();

  const { data: conn, error: connErr } = await admin
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .single();
  if (connErr || !conn) throw new Error("Connection not found");
  const spaceId = conn.space_id as string;
  const config = (conn.config ?? {}) as Record<string, unknown>;
  const firstSync = !conn.last_synced_at;

  const token = await financyToken(await loadCredentials(admin, connectionId));

  // ---- 1. Banks linked inside Financy. Their status says whether the data is live.
  const banks = await listAll<FinancyConnection>(token, "/v2/connections");
  const bankSummary = summarizeBanks(banks);
  const saveConfig = (extra: Record<string, unknown>) =>
    admin
      .from("connections")
      .update({ config: { ...config, financy_banks: bankSummary, ...extra } })
      .eq("id", connectionId);
  if (banks.length === 0) {
    await saveConfig({});
    throw new FinancyError("FINANCY_NO_BANKS", 409);
  }
  const readable = banks.some((b) => READABLE_STATUSES.has(b.status ?? ""));
  const needsReconnect =
    !readable && banks.some((b) => RECONNECT_STATUSES.has(b.status ?? ""));

  // ---- 2. Accounts: insert new ones, refresh balances on the rest.
  const fAccounts = (await listAll<FinancyAccount>(token, "/v2/data/accounts")).filter(
    (a) => a.id,
  );
  const { data: existing } = await admin
    .from("accounts")
    .select("id, external_id")
    .eq("connection_id", connectionId);
  const knownByExternal = new Map(
    (existing ?? []).map((a) => [a.external_id as string, a.id as string]),
  );
  const meta = new Map<string, AccountMeta>();
  for (const a of fAccounts) {
    const type = mapFinancyAccountType(a.accountType);
    const rawCurrency = (a.currency ?? "ILS").toUpperCase();
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "ILS";
    const { current, available } = pickFinancyBalance(a);
    const institution = prettyFinancyInstitution(a.providerId);
    const known = knownByExternal.get(a.id);
    if (known) {
      // The user may have renamed the account in Peanut: never touch `name`.
      const { error } = await admin
        .from("accounts")
        .update({
          institution_name: institution,
          mask: financyMask(a),
          current_balance: current,
          available_balance: available,
        })
        .eq("id", known);
      if (error) throw new Error(`Update account: ${error.message}`);
      meta.set(a.id, { id: known, currency, isCard: type === "credit" });
      continue;
    }
    const { data: row, error } = await admin
      .from("accounts")
      .insert({
        space_id: spaceId,
        connection_id: connectionId,
        source: "financy",
        external_id: a.id,
        name: financyAccountName(a),
        institution_name: institution,
        type,
        currency,
        mask: financyMask(a),
        current_balance: current,
        available_balance: available,
        is_liability: type === "credit" || type === "loan",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Create account: ${error.message}`);
    knownByExternal.set(a.id, row.id as string);
    meta.set(a.id, { id: row.id as string, currency, isCard: type === "credit" });
  }

  // ---- 3. Transactions in the window.
  const { dateFrom, dateTo } = financyWindow(
    conn.last_synced_at as string | null,
    opts.backfillMonths,
  );
  const txns = await listAll<FinancyTransaction>(token, "/v2/data/transactions", {
    dateFrom,
    dateTo,
    sort: "1",
  });

  const [{ data: categories }, { data: aliases }, { data: userCat }, { data: rules }] =
    await Promise.all([
      admin.from("categories").select("id, name, kind").eq("space_id", spaceId),
      admin
        .from("category_aliases")
        .select("source_name, category_id")
        .eq("space_id", spaceId)
        .eq("source", "financy"),
      // Peanut is the source of truth: never clobber user categorization.
      admin
        .from("transactions")
        .select("external_id")
        .eq("connection_id", connectionId)
        .eq("categorized_by", "user"),
      admin
        .from("category_rules")
        .select("match_value, match_amount, category_id")
        .eq("space_id", spaceId)
        .eq("match_type", "merchant"),
    ]);
  const userCategorized = new Set((userCat ?? []).map((r) => r.external_id as string));
  const categoryByName = new Map(
    (categories ?? []).map((c) => [c.name as string, c.id as string]),
  );
  const aliasMap = new Map(
    (aliases ?? []).map((a) => [a.source_name as string, a.category_id as string]),
  );
  const ruleExact = new Map<string, string>();
  const ruleByMerchant = new Map<string, string>();
  for (const r of rules ?? []) {
    if (r.match_amount != null) {
      ruleExact.set(`${r.match_value}|${Number(r.match_amount)}`, r.category_id as string);
    } else {
      ruleByMerchant.set(r.match_value as string, r.category_id as string);
    }
  }

  async function categoryFor(key: string, income: boolean): Promise<string | null> {
    const aliased = aliasMap.get(key);
    if (aliased) return aliased;
    const wanted = financyCategoryName(key) ?? prettyFinancyCategory(key);
    let id = categoryByName.get(wanted) ?? null;
    if (!id) {
      const { data: cat } = await admin
        .from("categories")
        .insert({
          space_id: spaceId,
          group: "Financy",
          name: wanted,
          kind: income ? "income" : "expense",
          icon: "🏷️",
        })
        .select("id")
        .single();
      id = (cat?.id as string) ?? null;
      if (!id) {
        // Lost a race on unique (space_id, name): read it back.
        const { data: again } = await admin
          .from("categories")
          .select("id")
          .eq("space_id", spaceId)
          .eq("name", wanted)
          .maybeSingle();
        id = (again?.id as string) ?? null;
      }
      if (id) categoryByName.set(wanted, id);
    }
    if (id) {
      await admin.from("category_aliases").upsert(
        { space_id: spaceId, source: "financy", source_name: key, category_id: id },
        { onConflict: "space_id,source,source_name" },
      );
      aliasMap.set(key, id);
    }
    return id;
  }

  const history = new Map<string, { account_id: string; as_of_date: string; balance: number; currency: string }>();
  let upserted = 0;
  let skipped = 0;
  for (const t of txns) {
    if (t.isDuplicate) continue;
    const acc = meta.get(t.accountId);
    const date = financyTxnDate(t);
    const money = acc ? financyTxnAmount(t, acc.currency) : null;
    if (!acc || !date || !money) {
      skipped++;
      continue;
    }
    const name = financyTxnName(t);
    const key = financyCategoryKey(t);
    let categoryId = key ? await categoryFor(key, money.amount > 0) : null;

    // Bank-side debit of a card bill: a transfer, never spending.
    const cardBill = isCardBillDebit(name, !acc.isCard);
    if (cardBill) categoryId = categoryByName.get("Credit Card Payment") ?? categoryId;
    // Merchant rules beat the provider label (but never transfer detection).
    const ruleCat = !cardBill
      ? (ruleExact.get(`${name}|${Math.abs(money.amount)}`) ?? ruleByMerchant.get(name))
      : undefined;
    if (ruleCat) categoryId = ruleCat;

    // Never include `reviewed`: inserts get the default and resyncs must not clobber it.
    const row: Record<string, unknown> = {
      space_id: spaceId,
      account_id: acc.id,
      connection_id: connectionId,
      source: "financy",
      external_id: t.id,
      date,
      name,
      original_name: t.description?.description ?? t.merchantName ?? null,
      amount: money.amount,
      currency: money.currency,
      payment_method: acc.isCard
        ? "card"
        : name.startsWith("העברה") || /TRANSFER/i.test(key ?? "")
          ? "transfer"
          : "bank",
      raw: t as unknown as Record<string, unknown>,
    };
    if (!userCategorized.has(t.id)) {
      row.category_id = categoryId;
      row.categorized_by = cardBill || ruleCat ? "rule" : categoryId ? "provider" : "none";
      row.is_transfer = cardBill;
    }
    const { error: upErr } = await admin
      .from("transactions")
      .upsert(row, { onConflict: "connection_id,external_id" });
    if (upErr) throw new Error(`Upsert txn: ${upErr.message}`);
    upserted++;

    // Financy sends the end-of-day balance with each bank transaction; on the
    // first sync that gives a year of net-worth history for free.
    if (firstSync && !acc.isCard && typeof t.balancePerEndDay === "number") {
      history.set(`${acc.id}|${date}`, {
        account_id: acc.id,
        as_of_date: date,
        balance: Math.round(t.balancePerEndDay * 100) / 100,
        currency: money.currency,
      });
    }
  }

  // ---- 4. Balance history (first sync only, bank accounts only).
  const rows = [...history.values()].map((h) => ({ ...h, source: "sync" }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from("account_balance_snapshots")
      .upsert(rows.slice(i, i + 200), { onConflict: "account_id,as_of_date" });
    if (error) throw new Error(`Balance history: ${error.message}`);
  }

  // ---- 5. Connection state.
  await admin
    .from("connections")
    .update({
      status: readable ? "active" : "error",
      error: null,
      last_synced_at: new Date().toISOString(),
      config: {
        ...config,
        financy_banks: bankSummary,
        financy_last_window: { dateFrom, dateTo },
      },
    })
    .eq("id", connectionId);
  if (!readable) {
    throw new FinancyError(needsReconnect ? "FINANCY_RECONNECT" : "FINANCY_FETCHING", 409);
  }

  return { banks: banks.length, accounts: fAccounts.length, upserted, skipped };
}

export async function markFinancyError(connectionId: string, message: string) {
  const admin = createAdminClient();
  await admin
    .from("connections")
    .update({ status: isUserActionError(message) ? "error" : "active", error: message })
    .eq("id", connectionId);
}

/**
 * Ask Financy to pull fresh data from the banks right now. Financy charges
 * the organization 20 credits per accepted refresh and finishes in a minute
 * or two; the next Peanut sync then picks the new rows up.
 */
export async function refreshFinancy(
  connectionId: string,
): Promise<{ status: string; message: string }> {
  const admin = createAdminClient();
  const token = await financyToken(await loadCredentials(admin, connectionId));
  // The doubled /chat is Financy's documented path (a single /chat is a 404).
  const res = await fetch(`${BASE}/chat/chat/connections/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await readError(res);
  if (res.status === 402) throw new FinancyError("FINANCY_NO_CREDITS", 402, body.type);
  if (res.status === 409) throw new FinancyError("FINANCY_NO_BANKS", 409, body.type);
  if (!res.ok) throw classify(res.status, body);
  const status = body.status ?? "accepted";
  return {
    status,
    message:
      status === "already_running"
        ? "Financy is already refreshing. Sync again in a couple of minutes."
        : "Financy accepted the refresh (20 credits). Sync again in a couple of minutes.",
  };
}
