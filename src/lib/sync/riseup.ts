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

/**
 * Pull transactions for the current + previous cashflow months
 * (Israeli card billing lands retroactively), or a deeper backfill on
 * first sync. Accounts are derived from accountNumberHash — the official
 * API has no balances endpoint yet, so balances stay manual.
 */
export async function syncRiseup(
  connectionId: string,
  opts: { backfillMonths?: number } = {},
): Promise<{ upserted: number; months: number }> {
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

  let upserted = 0;
  for (const off of offsets) {
    const month = monthStr(off);
    const payload = (await riseupGet(
      String(token),
      `/transactions?cashflowMonth=${month}`,
    )) as { transactions?: RiseupTxn[] } | RiseupTxn[];
    const txns = Array.isArray(payload)
      ? payload
      : (payload.transactions ?? []);

    for (const t of txns) {
      const hash = t.accountNumberHash ?? "unknown";
      // Ensure the account exists.
      let accountId = accountByHash.get(hash);
      if (!accountId) {
        const isCard = t.sourceType === "creditCard";
        const pretty = prettyInstitution(t.source);
        const { data: acc, error } = await admin
          .from("accounts")
          .insert({
            space_id: spaceId,
            connection_id: connectionId,
            source: "riseup",
            external_id: hash,
            name:
              t.accountNickname || (isCard ? pretty : `${pretty} Checking`),
            institution_name: pretty,
            // No real card digits in the RiseUp API — leave mask empty.
            type: isCard ? "credit" : "checking",
            currency: "ILS",
            is_liability: isCard,
          })
          .select("id")
          .single();
        if (error) throw new Error(`Create account: ${error.message}`);
        accountId = acc.id as string;
        accountByHash.set(hash, accountId);
      }

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
      const row: Record<string, unknown> = {
        space_id: spaceId,
        account_id: accountId,
        connection_id: connectionId,
        source: "riseup",
        external_id: t.transactionId,
        date: t.transactionDate.slice(0, 10),
        name: t.businessName ?? "Unknown",
        original_name: t.businessName,
        amount: t.isIncome ? Math.abs(t.amount) : -Math.abs(t.amount),
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
      // recategorized this transaction.
      if (!userCategorized.has(t.transactionId)) {
        row.category_id = categoryId;
        row.categorized_by =
          cardBill || ruleCat ? "rule" : categoryId ? "provider" : "none";
        row.is_transfer = cardBill;
      }
      const { error: upErr } = await admin
        .from("transactions")
        .upsert(row, { onConflict: "connection_id,external_id" });
      if (upErr) throw new Error(`Upsert txn: ${upErr.message}`);
      upserted++;
    }
  }

  await admin
    .from("connections")
    .update({ status: "active", error: null, last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);

  return { upserted, months: offsets.length };
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
