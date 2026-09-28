import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BASE = "https://input.riseup.co.il/api/external";

interface RiseupTxn {
  transactionId: string;
  businessName: string | null;
  transactionDate: string;
  billingDate?: string | null;
  cashflowDate?: string | null;
  amount: number; // always positive
  isIncome: boolean;
  categoryLabel?: string | null;
  categoryType?: string | null;
  actualType?: string | null;
  accountNumberHash?: string | null;
  accountNickname?: string | null;
  source?: string | null;
  sourceType?: string | null; // creditCard | checkingAccount
  isInstallment?: boolean;
  installmentNumber?: number | null;
  totalNumberOfInstallments?: number | null;
  isPostponed?: boolean;
}

async function riseupGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("RISEUP_TOKEN_EXPIRED");
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After") ?? "?";
    throw new Error(`RISEUP_RATE_LIMITED (retry after ${retry}s)`);
  }
  if (!res.ok) throw new Error(`RiseUp ${path}: HTTP ${res.status}`);
  return res.json();
}

// Which bank-statement descriptors pay which card issuer's bill.
export const CARD_BILL_PATTERNS_BY_INSTITUTION: Record<string, string[]> = {
  "Leumi Card": ["לאומי ויזה", "כרטיסי אשראי"],
  "American Express": ["אמריקן אקספרס"],
  "Visa Cal": ["ויזה כאל", "כאל"],
  Isracard: ["ישראכרט"],
  Max: ["מקס איט"],
};

// Bank-side debits of monthly card bills. Counting these AND the card's
// own purchases double-counts spending — Monarch marks them transfers.
const CC_BILL_PATTERNS = [
  "לאומי ויזה",
  "אמריקן אקספרס",
  "כרטיסי אשראי",
  "ישראכרט",
  "מקס איט",
  "ויזה כאל",
];

function isCardBillDebit(name: string | null, isChecking: boolean): boolean {
  if (!name || !isChecking) return false;
  return CC_BILL_PATTERNS.some((p) => name.includes(p));
}

const INSTITUTIONS: Record<string, string> = {
  leumiBank: "Bank Leumi",
  poalim: "Bank Hapoalim",
  mizrahi: "Bank Mizrahi",
  discount: "Bank Discount",
  leumicard: "Leumi Card",
  max: "Max",
  americanexpress: "American Express",
  cal: "Visa Cal",
  isracard: "Isracard",
  onezero: "One Zero",
};

function prettyInstitution(source: string | null | undefined): string {
  if (!source) return "RiseUp";
  return (
    INSTITUTIONS[source] ??
    source.charAt(0).toUpperCase() + source.slice(1)
  );
}

function monthStr(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A transaction we already hold for this connection. */
interface StoredTxn {
  id: string;
  external_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string | null;
}

/** A transaction RiseUp just handed us, with its account already resolved. */
interface Incoming {
  t: RiseupTxn;
  accountId: string;
  date: string;
  amount: number; // signed, the way we store it
}

function normalizeMerchant(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Same card, same day, same amount: two ids, one charge. */
function isSameCharge(f: Incoming, row: StoredTxn): boolean {
  return (
    f.accountId === row.account_id &&
    f.date === row.date &&
    f.amount === Number(row.amount)
  );
}

/**
 * The looser case: the issuer settled a day or two later, or re-priced a
 * foreign-currency charge, so the date and the amount both moved a little.
 */
function isSettledLater(f: Incoming, row: StoredTxn): boolean {
  const before = Number(row.amount);
  if (f.accountId !== row.account_id) return false;
  if (before === 0 || Math.sign(f.amount) !== Math.sign(before)) return false;
  if (daysApart(f.date, row.date) > 3) return false;
  const drift = Math.abs(Math.abs(f.amount) - Math.abs(before)) / Math.abs(before);
  if (drift > 0.05) return false;
  const fresh = normalizeMerchant(f.t.businessName);
  const stored = normalizeMerchant(row.name);
  return (
    fresh.length >= 6 && stored.length >= 6 && fresh.slice(0, 6) === stored.slice(0, 6)
  );
}

/**
 * RiseUp gives a card charge a NEW transactionId once the issuer actually
 * bills it: same purchase, new id, often a tidied-up merchant name and
 * sometimes a final post-conversion amount. Upserting on the id alone leaves
 * the freshly-scraped row sitting next to the billed one — the duplicates
 * people see in the app. Pair every retired row with the charge it became so
 * the transaction keeps its row, and with it the user's category, notes,
 * receipts and recurring link.
 *
 * Returns incoming transactionId -> the stored row it continues.
 */
function pairReissuedCharges(
  retiring: StoredTxn[],
  fresh: Incoming[],
): Map<string, StoredTxn> {
  const adoptions = new Map<string, StoredTxn>();
  const claimedRows = new Set<string>();
  const claimedTxns = new Set<string>();
  const claim = (f: Incoming, row: StoredTxn) => {
    adoptions.set(f.t.transactionId, row);
    claimedRows.add(row.id);
    claimedTxns.add(f.t.transactionId);
  };

  for (const row of retiring) {
    // Identical charges are interchangeable, so the first free match will do.
    const hit = fresh.find(
      (f) => !claimedTxns.has(f.t.transactionId) && isSameCharge(f, row),
    );
    if (hit) claim(hit, row);
  }
  for (const row of retiring) {
    if (claimedRows.has(row.id)) continue;
    const near = fresh.filter(
      (f) => !claimedTxns.has(f.t.transactionId) && isSettledLater(f, row),
    );
    // Only when it is unambiguous — two coffees at one place must not merge.
    if (near.length === 1) claim(near[0], row);
  }
  return adoptions;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Every row we hold for the provider months this run fetched. */
async function loadStoredForMonths(
  admin: Admin,
  connectionId: string,
  months: string[],
): Promise<StoredTxn[]> {
  const out: StoredTxn[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("transactions")
      .select("id, external_id, account_id, date, amount, name")
      .eq("connection_id", connectionId)
      .in("raw->>cashflowDate", months)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Load stored txns: ${error.message}`);
    out.push(...((data ?? []) as StoredTxn[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/**
 * Rows for ids we did not see in the month window — a charge RiseUp moved to
 * another cashflow month still lives under its own id, and must not be
 * mistaken for a new one.
 */
async function loadStoredByExternalIds(
  admin: Admin,
  connectionId: string,
  ids: string[],
): Promise<StoredTxn[]> {
  const out: StoredTxn[] = [];
  const CHUNK = 100; // keep the request URL well inside its limits
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from("transactions")
      .select("id, external_id, account_id, date, amount, name")
      .eq("connection_id", connectionId)
      .in("external_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`Load stored txns: ${error.message}`);
    out.push(...((data ?? []) as StoredTxn[]));
  }
  return out;
}

/**
 * Pull transactions for the current + previous cashflow months
 * (Israeli card billing lands retroactively), or a deeper backfill on
 * first sync. Accounts are derived from accountNumberHash — the official
 * API has no balances endpoint yet, so balances stay manual.
 *
 * RiseUp is the source of truth for the months it answers: a charge it no
 * longer reports is either the same purchase under a re-issued id (adopted)
 * or a charge that never settled (removed).
 */
export async function syncRiseup(
  connectionId: string,
  opts: { backfillMonths?: number } = {},
): Promise<{
  upserted: number;
  adopted: number;
  removed: number;
  months: number;
}> {
  const admin = createAdminClient();

  const { data: conn, error: connErr } = await admin
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .single();
  if (connErr || !conn) throw new Error("Connection not found");

  const { data: token, error: vaultErr } = await admin.rpc(
    "peanut_vault_get_secret",
    { p_name: `conn_${connectionId}` },
  );
  if (vaultErr || !token) throw new Error("Missing RiseUp token in vault");

  const spaceId = conn.space_id as string;
  const back = opts.backfillMonths ?? (conn.last_synced_at ? 0 : 12);
  const offsets = Array.from({ length: back + 2 }, (_, i) => -i); // 0, -1, ...

  // Existing riseup accounts + categories + aliases + user-categorized txns.
  const [{ data: accounts }, { data: categories }, { data: aliases }, { data: userCat }] =
    await Promise.all([
      admin
        .from("accounts")
        .select("id, external_id")
        .eq("connection_id", connectionId),
      admin
        .from("categories")
        .select("id, name, name_he, kind")
        .eq("space_id", spaceId),
      admin
        .from("category_aliases")
        .select("source_name, category_id")
        .eq("space_id", spaceId)
        .eq("source", "riseup"),
      // Peanut is the source of truth: never clobber user categorization.
      admin
        .from("transactions")
        .select("external_id")
        .eq("connection_id", connectionId)
        .eq("categorized_by", "user"),
    ]);
  const userCategorized = new Set(
    (userCat ?? []).map((r) => r.external_id as string),
  );
  const { data: rules } = await admin
    .from("category_rules")
    .select("match_value, match_amount, category_id")
    .eq("space_id", spaceId)
    .eq("match_type", "merchant");
  // Amount-scoped rules match merchant+|amount| exactly; plain rules match merchant.
  const ruleExact = new Map<string, string>();
  const ruleByMerchant = new Map<string, string>();
  for (const r of rules ?? []) {
    if (r.match_amount != null) {
      ruleExact.set(
        `${r.match_value}|${Number(r.match_amount)}`,
        r.category_id as string,
      );
    } else {
      ruleByMerchant.set(r.match_value as string, r.category_id as string);
    }
  }
  const accountByHash = new Map(
    (accounts ?? []).map((a) => [a.external_id as string, a.id as string]),
  );
  const aliasMap = new Map(
    (aliases ?? []).map((a) => [a.source_name as string, a.category_id as string]),
  );
  const categoryByName = new Map<string, string>();
  for (const c of categories ?? []) {
    categoryByName.set(c.name as string, c.id as string);
    if (c.name_he) categoryByName.set(c.name_he as string, c.id as string);
  }

  async function accountFor(t: RiseupTxn): Promise<string> {
    const hash = t.accountNumberHash ?? "unknown";
    const known = accountByHash.get(hash);
    if (known) return known;
    const isCard = t.sourceType === "creditCard";
    const pretty = prettyInstitution(t.source);
    const { data: acc, error } = await admin
      .from("accounts")
      .insert({
        space_id: spaceId,
        connection_id: connectionId,
        source: "riseup",
        external_id: hash,
        name: t.accountNickname || (isCard ? pretty : `${pretty} Checking`),
        institution_name: pretty,
        // No real card digits in the RiseUp API — leave mask empty.
        type: isCard ? "credit" : "checking",
        currency: "ILS",
        is_liability: isCard,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Create account: ${error.message}`);
    accountByHash.set(hash, acc.id as string);
    return acc.id as string;
  }

  // ---- 1. Read the whole window first. What the provider reports across all
  //         of it is what decides which stored rows are still real.
  const incoming: Incoming[] = [];
  const answered: string[] = [];
  for (const off of offsets) {
    const month = monthStr(off);
    const payload = (await riseupGet(
      String(token),
      `/transactions?cashflowMonth=${month}`,
    )) as { transactions?: RiseupTxn[] } | RiseupTxn[];
    const txns = Array.isArray(payload) ? payload : (payload.transactions ?? []);
    // An empty month proves nothing (nothing scraped yet, a bank mid-outage),
    // so it never gets a say in what is removed.
    if (txns.length > 0) answered.push(month);
    for (const t of txns) {
      incoming.push({
        t,
        accountId: await accountFor(t),
        date: t.transactionDate.slice(0, 10),
        amount: t.isIncome ? Math.abs(t.amount) : -Math.abs(t.amount),
      });
    }
  }

  // ---- 2. Line the answer up against what we already hold.
  const stored = answered.length
    ? await loadStoredForMonths(admin, connectionId, answered)
    : [];
  const storedByExternal = new Map(stored.map((r) => [r.external_id, r]));
  const unknownIds = incoming
    .map((i) => i.t.transactionId)
    .filter((id) => !storedByExternal.has(id));
  for (const r of await loadStoredByExternalIds(admin, connectionId, unknownIds)) {
    storedByExternal.set(r.external_id, r);
  }

  const reported = new Set(incoming.map((i) => i.t.transactionId));
  const retiring = stored.filter((r) => !reported.has(r.external_id));
  const fresh = incoming.filter((i) => !storedByExternal.has(i.t.transactionId));
  const adoptions = pairReissuedCharges(retiring, fresh);
  const adoptedRows = new Set([...adoptions.values()].map((r) => r.id));

  // ---- 3. Write.
  let upserted = 0;
  let adopted = 0;
  for (const { t, accountId, date, amount } of incoming) {
    // Resolve category from RiseUp's Hebrew label.
    let categoryId: string | null = null;
    const label = t.categoryLabel?.trim();
    if (label) {
      categoryId = aliasMap.get(label) ?? null;
      if (!categoryId) {
        categoryId = categoryByName.get(label) ?? null;
        if (!categoryId) {
          const { data: cat } = await admin
            .from("categories")
            .insert({
              space_id: spaceId,
              group: "RiseUp",
              name: label,
              name_he: label,
              kind: t.isIncome ? "income" : "expense",
              icon: "🏷️",
            })
            .select("id")
            .single();
          categoryId = (cat?.id as string) ?? null;
          if (categoryId) categoryByName.set(label, categoryId);
        }
        if (categoryId) {
          await admin.from("category_aliases").upsert(
            {
              space_id: spaceId,
              source: "riseup",
              source_name: label,
              category_id: categoryId,
            },
            { onConflict: "space_id,source,source_name" },
          );
          aliasMap.set(label, categoryId);
        }
      }
    }

    const cardBill = isCardBillDebit(
      t.businessName ?? null,
      t.sourceType !== "creditCard",
    );
    if (cardBill) {
      categoryId = categoryByName.get("Credit Card Payment") ?? categoryId;
    }
    // Never include `reviewed` here: inserts get the column default (false) and resyncs must not clobber the user's review state.
    const row: Record<string, unknown> = {
      space_id: spaceId,
      account_id: accountId,
      connection_id: connectionId,
      source: "riseup",
      external_id: t.transactionId,
      date,
      name: t.businessName ?? "Unknown",
      original_name: t.businessName,
      amount,
      currency: "ILS",
      payment_method:
        t.sourceType === "creditCard"
          ? "card"
          : (t.businessName ?? "").startsWith("העברה")
            ? "transfer"
            : "bank",
      raw: t as unknown as Record<string, unknown>,
    };
    // Merchant rules beat the provider label (but never transfer detection).
    const ruleCat = !cardBill
      ? (ruleExact.get(`${t.businessName ?? ""}|${Math.abs(t.amount)}`) ??
        ruleByMerchant.get(t.businessName ?? ""))
      : undefined;
    if (ruleCat) categoryId = ruleCat;
    // Peanut wins: only write category fields if the user has not
    // recategorized this transaction. An adopted row answers to the id it
    // was categorized under, not the one RiseUp just minted.
    const continues = adoptions.get(t.transactionId);
    if (!userCategorized.has(continues?.external_id ?? t.transactionId)) {
      row.category_id = categoryId;
      row.categorized_by =
        cardBill || ruleCat ? "rule" : categoryId ? "provider" : "none";
      row.is_transfer = cardBill;
    }

    if (continues) {
      const { error: adoptErr } = await admin
        .from("transactions")
        .update(row)
        .eq("id", continues.id);
      if (adoptErr) throw new Error(`Adopt txn: ${adoptErr.message}`);
      adopted++;
    } else {
      const { error: upErr } = await admin
        .from("transactions")
        .upsert(row, { onConflict: "connection_id,external_id" });
      if (upErr) throw new Error(`Upsert txn: ${upErr.message}`);
      upserted++;
    }
  }

  // ---- 4. Drop what RiseUp no longer reports and nothing took over: a
  //         charge that was authorised and then never settled.
  const gone = retiring.filter((r) => !adoptedRows.has(r.id));
  let removed = 0;
  if (gone.length > 0) {
    // A half-answered month must not take real history with it.
    if (gone.length > Math.max(10, stored.length * 0.4)) {
      throw new Error(
        `RiseUp reported only ${incoming.length} of the ${stored.length} charges we hold for ${answered.join(", ")} — left the missing ${gone.length} alone rather than deleting them.`,
      );
    }
    const { error: delErr } = await admin
      .from("transactions")
      .delete()
      .in(
        "id",
        gone.map((r) => r.id),
      );
    if (delErr) throw new Error(`Remove retired txns: ${delErr.message}`);
    removed = gone.length;
  }

  await admin
    .from("connections")
    .update({ status: "active", error: null, last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);

  return { upserted, adopted, removed, months: offsets.length };
}

export async function markRiseupError(connectionId: string, message: string) {
  const admin = createAdminClient();
  await admin
    .from("connections")
    .update({
      status: message === "RISEUP_TOKEN_EXPIRED" ? "error" : "active",
      error: message,
    })
    .eq("id", connectionId);
}
