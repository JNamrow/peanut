// One-time seed: users, space, categories, FX backfill.
// Run: node scripts/seed.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .filter((l) => !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2"),
    ]),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Seed users come from .env.local, e.g. SEED_USERS=you@example.com:You,partner@example.com:Partner
// Every listed user becomes an owner of one shared space (SEED_SPACE_NAME, SEED_PRIMARY_CURRENCY).
const USERS = (env.SEED_USERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const [email, name] = pair.split(":").map((s) => s.trim());
    return { email, name: name || email.split("@")[0], role: "owner" };
  });
if (USERS.length === 0) {
  console.error("Set SEED_USERS in .env.local, e.g. SEED_USERS=you@example.com:You,partner@example.com:Partner");
  process.exit(1);
}
const SPACE_NAME = env.SEED_SPACE_NAME || "Household";
const PRIMARY_CURRENCY = env.SEED_PRIMARY_CURRENCY || "ILS";

// Monarch's default taxonomy + Israel additions. [group, name, icon, kind, bucket]
const CATEGORIES = [
  ["Income", "Paychecks", "💵", "income", null],
  ["Income", "Interest", "💸", "income", null],
  ["Income", "Business Income", "💰", "income", null],
  ["Income", "Other Income", "🪙", "income", null],
  ["Gifts & Donations", "Tzedakah & Charity", "🎗️", "expense", "flexible"],
  ["Gifts & Donations", "Gifts", "🎁", "expense", "non_monthly"],
  ["Auto & Transport", "Auto Payment", "🚗", "expense", "fixed"],
  ["Auto & Transport", "Public Transit", "🚃", "expense", "flexible"],
  ["Auto & Transport", "Gas", "⛽️", "expense", "flexible"],
  ["Auto & Transport", "Auto Maintenance", "🔧", "expense", "non_monthly"],
  ["Auto & Transport", "Parking & Tolls", "🅿️", "expense", "flexible"],
  ["Auto & Transport", "Taxi & Ride Shares", "🚕", "expense", "flexible"],
  ["Housing", "Mortgage", "🏠", "expense", "fixed"],
  ["Housing", "Rent", "🏡", "expense", "fixed"],
  ["Housing", "Arnona", "🏛️", "expense", "fixed"],
  ["Housing", "Va'ad Bayit", "🏢", "expense", "fixed"],
  ["Housing", "Home Improvement", "🔨", "expense", "non_monthly"],
  ["Bills & Utilities", "Water", "💧", "expense", "fixed"],
  ["Bills & Utilities", "Gas & Electric", "⚡️", "expense", "fixed"],
  ["Bills & Utilities", "Internet & Cable", "🌐", "expense", "fixed"],
  ["Bills & Utilities", "Phone", "📱", "expense", "fixed"],
  ["Food & Dining", "Groceries", "🍏", "expense", "flexible"],
  ["Food & Dining", "Restaurants & Bars", "🍽️", "expense", "flexible"],
  ["Food & Dining", "Coffee Shops", "☕️", "expense", "flexible"],
  ["Travel & Lifestyle", "Travel & Vacation", "🏝️", "expense", "non_monthly"],
  ["Travel & Lifestyle", "Entertainment & Recreation", "🎥", "expense", "flexible"],
  ["Travel & Lifestyle", "Personal", "👑", "expense", "flexible"],
  ["Travel & Lifestyle", "Pets", "🐶", "expense", "flexible"],
  ["Travel & Lifestyle", "Fun Money", "😜", "expense", "flexible"],
  ["Shopping", "Shopping", "🛍️", "expense", "flexible"],
  ["Shopping", "Clothing", "👕", "expense", "flexible"],
  ["Shopping", "Furniture & Housewares", "🪑", "expense", "non_monthly"],
  ["Shopping", "Electronics", "🖥️", "expense", "non_monthly"],
  ["Children", "Child Care", "👶", "expense", "fixed"],
  ["Children", "Gan & School", "🏫", "expense", "fixed"],
  ["Children", "Child Activities", "⚽️", "expense", "flexible"],
  ["Education", "Student Loans", "🎓", "expense", "fixed"],
  ["Education", "Education", "📚", "expense", "non_monthly"],
  ["Health & Wellness", "Medical", "💊", "expense", "non_monthly"],
  ["Health & Wellness", "Kupat Cholim", "🏥", "expense", "fixed"],
  ["Health & Wellness", "Dentist", "🦷", "expense", "non_monthly"],
  ["Health & Wellness", "Fitness", "💪", "expense", "fixed"],
  ["Financial", "Loan Repayment", "💰", "expense", "fixed"],
  ["Financial", "Financial & Legal Services", "🗄️", "expense", "non_monthly"],
  ["Financial", "Financial Fees", "🏦", "expense", "flexible"],
  ["Financial", "Cash & ATM", "🏧", "expense", "flexible"],
  ["Financial", "Insurance", "☂️", "expense", "fixed"],
  ["Financial", "Taxes", "🧾", "expense", "non_monthly"],
  ["Other", "Uncategorized", "❓", "expense", "flexible"],
  ["Other", "Miscellaneous", "💲", "expense", "flexible"],
  ["Transfers", "Transfer", "🔁", "transfer", null],
  ["Transfers", "Credit Card Payment", "💳", "transfer", null],
  ["Transfers", "Balance Adjustments", "⚖️", "transfer", null],
  ["Investments", "Buy", "➡️", "transfer", null],
  ["Investments", "Sell", "⬅️", "transfer", null],
  ["Investments", "Dividends & Capital Gains", "📈", "income", null],
];

// Plaid personal_finance_category.primary -> our category name
const PLAID_ALIASES = {
  INCOME: "Paychecks",
  TRANSFER_IN: "Transfer",
  TRANSFER_OUT: "Transfer",
  LOAN_PAYMENTS: "Loan Repayment",
  BANK_FEES: "Financial Fees",
  ENTERTAINMENT: "Entertainment & Recreation",
  FOOD_AND_DRINK: "Restaurants & Bars",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home Improvement",
  MEDICAL: "Medical",
  PERSONAL_CARE: "Personal",
  GENERAL_SERVICES: "Financial & Legal Services",
  GOVERNMENT_AND_NON_PROFIT: "Taxes",
  TRANSPORTATION: "Public Transit",
  TRAVEL: "Travel & Vacation",
  RENT_AND_UTILITIES: "Gas & Electric",
};

async function main() {
  // 1. Users
  const userIds = {};
  const passwords = {};
  const { data: existing } = await admin.auth.admin.listUsers();
  for (const u of USERS) {
    const found = existing?.users?.find((x) => x.email === u.email);
    if (found) {
      userIds[u.email] = found.id;
      console.log(`user exists: ${u.email}`);
      continue;
    }
    const password = randomBytes(9).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userIds[u.email] = data.user.id;
    passwords[u.email] = password;
    console.log(`created user: ${u.email}`);
  }

  // 2. Space + members
  let { data: space } = await admin
    .from("spaces")
    .select("id")
    .eq("name", SPACE_NAME)
    .maybeSingle();
  if (!space) {
    const { data, error } = await admin
      .from("spaces")
      .insert({ name: SPACE_NAME, primary_currency: PRIMARY_CURRENCY })
      .select("id")
      .single();
    if (error) throw error;
    space = data;
    console.log("created space");
  }
  for (const u of USERS) {
    await admin.from("space_members").upsert(
      {
        space_id: space.id,
        user_id: userIds[u.email],
        role: u.role,
        display_name: u.name,
      },
      { onConflict: "space_id,user_id" },
    );
  }

  // 3. Categories
  const { data: existingCats } = await admin
    .from("categories")
    .select("name")
    .eq("space_id", space.id);
  const have = new Set((existingCats ?? []).map((c) => c.name));
  let order = 0;
  for (const [group, name, icon, kind, bucket] of CATEGORIES) {
    order += 10;
    if (have.has(name)) continue;
    const { error } = await admin.from("categories").insert({
      space_id: space.id,
      group,
      name,
      icon,
      kind,
      budget_bucket: bucket,
      display_order: order,
      is_system: true,
      exclude_from_budget: kind === "transfer",
    });
    if (error) throw error;
  }
  console.log("categories ready");

  // 4. Plaid aliases
  const { data: cats } = await admin
    .from("categories")
    .select("id, name")
    .eq("space_id", space.id);
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  for (const [source, catName] of Object.entries(PLAID_ALIASES)) {
    const id = catByName.get(catName);
    if (!id) continue;
    await admin.from("category_aliases").upsert(
      { space_id: space.id, source: "plaid", source_name: source, category_id: id },
      { onConflict: "space_id,source,source_name" },
    );
  }
  console.log("plaid aliases ready");

  // 5. FX backfill 2019 -> today
  const thisYear = new Date().getFullYear();
  let fxCount = 0;
  for (let y = 2019; y <= thisYear; y++) {
    const to = y === thisYear ? new Date().toISOString().slice(0, 10) : `${y}-12-31`;
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${y}-01-01..${to}?base=USD&symbols=ILS`,
    );
    const json = await res.json();
    const rows = Object.entries(json.rates ?? {}).map(([date, r]) => ({
      rate_date: date,
      base: "USD",
      quote: "ILS",
      rate: r.ILS,
    }));
    if (rows.length) {
      const { error } = await admin
        .from("fx_rates")
        .upsert(rows, { onConflict: "rate_date,base,quote" });
      if (error) throw error;
      fxCount += rows.length;
    }
  }
  console.log(`fx rates: ${fxCount} days`);

  if (Object.keys(passwords).length) {
    console.log("\nTEMP PASSWORDS (change after first login):");
    for (const [email, pw] of Object.entries(passwords)) {
      console.log(`  ${email}  ->  ${pw}`);
    }
  }
  console.log("\nSeed done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
