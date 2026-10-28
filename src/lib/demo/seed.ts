/**
 * Demo data for Peanut: a fictional Anglo-Israeli household, "Maya & Tom",
 * who live in shekels and dollars.
 *
 * Maya is salaried at a Tel Aviv tech company and banks at Leumi. Tom is a
 * US remote contractor paid into Chase; he moves dollars over with Wise, pays
 * Israeli tax advances as a resident and US self-employment tax to the IRS.
 * Shekel spending lives on two Israeli cards paid from Leumi, dollar spending
 * on a Chase Sapphire paid from Chase checking.
 *
 * Everything is generated from a fixed seed, relative to `now`, so the demo
 * always looks current and reseeds identically for a given day. Ids are
 * hashes of stable keys, so accounts, categories and streams keep their ids
 * across days too.
 */
import type {
  Account,
  AccountType,
  BalanceSnapshot,
  Budget,
  Cadence,
  Category,
  Connection,
  FxRate,
  Holding,
  PensionConfig,
  RecurringStream,
  Space,
  SpaceMember,
  Transaction,
} from "../types";

// ---------------------------------------------------------------------------
// Fixed ids
// ---------------------------------------------------------------------------

export const DEMO_SPACE_ID = "5d1c7a3e-9b2f-4e6a-8c4d-2f7b9e1a3c5d";
export const DEMO_USER_ID = "8a2f4c6e-1d3b-4f5a-9e7c-6b8d0a2c4e6f";
export const DEMO_PARTNER_ID = "3c5e7a9b-2d4f-4a6c-8e0b-1f3d5a7c9e1b";

// ---------------------------------------------------------------------------
// Row types: the live tables carry a few columns the app's types leave out
// ---------------------------------------------------------------------------

export type SpaceRow = Space & { created_at: string };
export type SpaceMemberRow = SpaceMember & { created_at: string };
export type ConnectionRow = Connection & { created_by: string | null };
export type AccountRow = Account & { created_at: string };
export type BalanceSnapshotRow = BalanceSnapshot & { source: string };
export type CategoryRow = Category & { created_at: string };
export interface CategoryAliasRow {
  space_id: string;
  source: string;
  source_name: string;
  category_id: string;
}
export interface CategoryRuleRow {
  id: string;
  space_id: string;
  match_type: "merchant";
  match_value: string;
  category_id: string;
  created_at: string;
  match_amount: number | null;
}
export type TransactionRow = Transaction & {
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Live columns that the committed Transaction type may not list yet.
  reviewed: boolean;
  transfer_pair_id: string | null;
  split_parent_id: string | null;
};
export interface TransactionEventRow {
  id: string;
  space_id: string;
  transaction_id: string;
  kind: string;
  summary: string;
  actor_name: string | null;
  created_at: string;
}
export type BudgetRow = Budget & { currency: string };
export type RecurringStreamRow = RecurringStream & {
  match_pattern: string | null;
  created_at: string;
};
export interface GoalRow {
  id: string;
  space_id: string;
  name: string;
  icon: string | null;
  kind: "save_up" | "pay_down";
  target_amount: number;
  currency: string;
  target_date: string | null;
  starting_amount: number;
  planned_monthly: number;
  status: "active" | "archived";
  display_order: number;
  created_at: string;
}
export interface GoalAccountRow {
  goal_id: string;
  account_id: string;
}
export type HoldingRow = Holding;
export type PensionConfigRow = PensionConfig & { updated_at: string };
export interface ForecastSettingsRow {
  space_id: string;
  inflation_pct: number;
  return_pct: number;
  use_actual_expenses: boolean;
  expenses_override: Record<string, number | null>;
  created_at: string;
  updated_at: string;
  future_values: "today" | "nominal";
  split_enabled: boolean;
  withdrawal_order: string[] | null;
}
export interface ForecastIncomeRow {
  id: string;
  space_id: string;
  member_user_id: string | null;
  name: string;
  icon: string | null;
  yearly_amount: number;
  currency: string;
  stops_at_retirement: boolean;
  created_at: string;
  excluded: boolean;
}
export interface ForecastEventRow {
  id: string;
  space_id: string;
  name: string;
  icon: string | null;
  kind: "one_time" | "yearly";
  affects: "expense" | "income";
  year: number;
  end_year: number | null;
  amount: number;
  currency: string;
  created_at: string;
}
export interface ForecastSplitRow {
  account_id: string;
  space_id: string;
  mode: "amount" | "percent";
  value: number;
  position: number;
}
export type FxRateRow = FxRate;

export interface DemoData {
  spaces: SpaceRow[];
  space_members: SpaceMemberRow[];
  connections: ConnectionRow[];
  accounts: AccountRow[];
  account_balance_snapshots: BalanceSnapshotRow[];
  categories: CategoryRow[];
  category_aliases: CategoryAliasRow[];
  category_rules: CategoryRuleRow[];
  transactions: TransactionRow[];
  transaction_events: TransactionEventRow[];
  budgets: BudgetRow[];
  recurring_streams: RecurringStreamRow[];
  goals: GoalRow[];
  goal_accounts: GoalAccountRow[];
  holdings: HoldingRow[];
  pension_configs: PensionConfigRow[];
  forecast_settings: ForecastSettingsRow[];
  forecast_incomes: ForecastIncomeRow[];
  forecast_events: ForecastEventRow[];
  forecast_splits: ForecastSplitRow[];
  fx_rates: FxRateRow[];
}

// ---------------------------------------------------------------------------
// Deterministic randomness, ids and dates
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, and the same sequence on every platform. */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return Math.min(max, Math.floor(this.between(min, max + 1)));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
  gauss(mean: number, sd: number): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** How many times something happens in a month, around a mean. */
  count(mean: number): number {
    return Math.max(0, Math.round(this.gauss(mean, Math.sqrt(mean) * 0.8)));
  }
  money(min: number, max: number): number {
    return round2(this.between(min, max));
  }
}

const FNV_BASES = [0x811c9dc5, 0x3f2a1b7c, 0x9e3779b9, 0x1b873593] as const;

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable UUID (v4 layout) from a string key: same key, same id, forever. */
function uuidFromKey(key: string): string {
  const hex = FNV_BASES.map((basis, i) =>
    fnv1a(`${i}|${key}`, basis).toString(16).padStart(8, "0"),
  ).join("");
  const variant = "89ab"[parseInt(hex[16], 16) & 3];
  const h = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17)}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Dates are local-calendar YYYY-MM-DD strings, like the app's month helpers.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateOf(y: number, m0: number, day: number): string {
  return ymd(new Date(y, m0, day));
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  return dateOf(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/** Whole days from `from` to `to` (positive when `to` is later). */
function dayDiff(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86400000);
}

function isoAt(date: string, hour: number, minute: number): string {
  return `${date}T${pad2(hour)}:${pad2(minute)}:00.000Z`;
}

// ---------------------------------------------------------------------------
// Category taxonomy (Peanut's seed script, verbatim)
// ---------------------------------------------------------------------------

type CategoryKind = Category["kind"];
type BudgetBucket = Category["budget_bucket"];

/** [group, name, icon, kind, budget bucket] */
export const DEMO_TAXONOMY: readonly (readonly [
  string,
  string,
  string,
  CategoryKind,
  BudgetBucket,
])[] = [
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

const CATEGORY_NAMES = new Set(DEMO_TAXONOMY.map((c) => c[1]));

const HEBREW_NAMES: Record<string, string> = {
  Paychecks: "משכורת",
  Groceries: "סופר ומכולת",
  "Restaurants & Bars": "מסעדות",
  "Coffee Shops": "בתי קפה",
  Gas: "דלק",
  Rent: "שכר דירה",
  Arnona: "ארנונה",
  "Va'ad Bayit": "ועד בית",
  "Kupat Cholim": "קופת חולים",
  "Public Transit": "תחבורה ציבורית",
};

/** Plaid personal_finance_category.primary -> category name (from seed.mjs). */
const PLAID_ALIASES: readonly (readonly [string, string])[] = [
  ["INCOME", "Paychecks"],
  ["TRANSFER_IN", "Transfer"],
  ["TRANSFER_OUT", "Transfer"],
  ["LOAN_PAYMENTS", "Loan Repayment"],
  ["BANK_FEES", "Financial Fees"],
  ["ENTERTAINMENT", "Entertainment & Recreation"],
  ["FOOD_AND_DRINK", "Restaurants & Bars"],
  ["GENERAL_MERCHANDISE", "Shopping"],
  ["HOME_IMPROVEMENT", "Home Improvement"],
  ["MEDICAL", "Medical"],
  ["PERSONAL_CARE", "Personal"],
  ["GENERAL_SERVICES", "Financial & Legal Services"],
  ["GOVERNMENT_AND_NON_PROFIT", "Taxes"],
  ["TRANSPORTATION", "Public Transit"],
  ["TRAVEL", "Travel & Vacation"],
  ["RENT_AND_UTILITIES", "Gas & Electric"],
];

/** RiseUp's Hebrew labels -> category name. */
const RISEUP_ALIASES: readonly (readonly [string, string])[] = [
  ["כלכלה", "Groceries"],
  ["מסעדות", "Restaurants & Bars"],
  ["דלק", "Gas"],
  ["ביטוח", "Insurance"],
  ["בריאות", "Medical"],
  ["תחבורה", "Public Transit"],
  ["פנאי ובילויים", "Entertainment & Recreation"],
  ["ביגוד", "Clothing"],
  ["חשבונות", "Gas & Electric"],
];

/** Merchant rules the household set up; matching rows are categorized "rule". */
const MERCHANT_RULES: readonly (readonly [string, string])[] = [
  ["Pango", "Parking & Tolls"],
  ["Wolt", "Restaurants & Bars"],
  ["Super-Pharm", "Personal"],
];
const RULE_MERCHANTS = new Set(MERCHANT_RULES.map((r) => r[0]));

function categoryId(name: string): string {
  if (!CATEGORY_NAMES.has(name)) throw new Error(`Unknown category: ${name}`);
  return uuidFromKey(`category:${name}`);
}

// ---------------------------------------------------------------------------
// The household
// ---------------------------------------------------------------------------

const SEED = 20240613;
const MONTHS_BACK = 24;
const WISE_FEE = 0.0055;

type AccountKey =
  | "leumiChecking"
  | "leumiSavings"
  | "maxCard"
  | "isracard"
  | "menoraPension"
  | "altshulerStudy"
  | "carLoan"
  | "chaseChecking"
  | "chaseSapphire"
  | "fidelity"
  | "vanguardRoth";

const CONNECTION_IDS = {
  riseup: uuidFromKey("connection:riseup"),
  plaid: uuidFromKey("connection:plaid"),
};

interface AccountDef {
  key: AccountKey;
  name: string;
  official: string;
  institution: string;
  type: AccountType;
  subtype: string;
  currency: string;
  mask: string;
  source: Account["source"];
  liability: boolean;
  owner: string;
  paysFrom?: AccountKey; // a card and the bank account that pays its bill
  creditLimit?: number;
  target: number; // today's balance (cards: informational; they roll from 0)
  daily: boolean; // balance rolls through transactions day by day
}

const ACCOUNT_DEFS: readonly AccountDef[] = [
  { key: "leumiChecking", name: "Leumi Checking", official: "חשבון עו\"ש", institution: "Bank Leumi", type: "checking", subtype: "checking", currency: "ILS", mask: "4471", source: "riseup", liability: false, owner: DEMO_USER_ID, target: 38000, daily: true },
  { key: "leumiSavings", name: "Leumi Savings", official: "פיקדון שקלי", institution: "Bank Leumi", type: "savings", subtype: "savings", currency: "ILS", mask: "4489", source: "manual", liability: false, owner: DEMO_USER_ID, target: 250000, daily: true },
  { key: "maxCard", name: "Max Visa", official: "MAX VISA", institution: "Max", type: "credit", subtype: "credit card", currency: "ILS", mask: "8821", source: "riseup", liability: true, owner: DEMO_USER_ID, paysFrom: "leumiChecking", creditLimit: 30000, target: -6400, daily: true },
  { key: "isracard", name: "Isracard Mastercard", official: "ISRACARD MASTERCARD", institution: "Isracard", type: "credit", subtype: "credit card", currency: "ILS", mask: "3307", source: "riseup", liability: true, owner: DEMO_PARTNER_ID, paysFrom: "leumiChecking", creditLimit: 20000, target: -2100, daily: true },
  { key: "menoraPension", name: "Menora Mivtachim Pension", official: "קרן פנסיה מקיפה", institution: "Menorah Mivtachim", type: "pension", subtype: "pension", currency: "ILS", mask: "0192", source: "manual", liability: false, owner: DEMO_USER_ID, target: 212000, daily: false },
  { key: "altshulerStudy", name: "Altshuler Shaham Keren Hishtalmut", official: "קרן השתלמות", institution: "Altshuler Shaham", type: "pension", subtype: "study_fund", currency: "ILS", mask: "7745", source: "manual", liability: false, owner: DEMO_PARTNER_ID, target: 118000, daily: false },
  { key: "carLoan", name: "Car Loan", official: "הלוואת רכב", institution: "Bank Leumi", type: "loan", subtype: "auto", currency: "ILS", mask: "5520", source: "manual", liability: true, owner: DEMO_USER_ID, target: -48000, daily: true },
  { key: "chaseChecking", name: "Chase Total Checking", official: "TOTAL CHECKING", institution: "Chase", type: "checking", subtype: "checking", currency: "USD", mask: "6610", source: "plaid", liability: false, owner: DEMO_PARTNER_ID, target: 11500, daily: true },
  { key: "chaseSapphire", name: "Chase Sapphire Preferred", official: "SAPPHIRE PREFERRED", institution: "Chase", type: "credit", subtype: "credit card", currency: "USD", mask: "2048", source: "plaid", liability: true, owner: DEMO_PARTNER_ID, paysFrom: "chaseChecking", creditLimit: 15000, target: -1900, daily: true },
  { key: "fidelity", name: "Fidelity Brokerage", official: "INDIVIDUAL - TOD", institution: "Fidelity", type: "investment", subtype: "brokerage", currency: "USD", mask: "7731", source: "manual", liability: false, owner: DEMO_PARTNER_ID, target: 64000, daily: false },
  { key: "vanguardRoth", name: "Vanguard Roth IRA", official: "ROTH IRA BROKERAGE", institution: "Vanguard", type: "investment", subtype: "roth ira", currency: "USD", mask: "9034", source: "manual", liability: false, owner: DEMO_PARTNER_ID, target: 28000, daily: false },
];

interface HoldingDef {
  account: AccountKey;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  costBasis: number;
}

const HOLDING_DEFS: readonly HoldingDef[] = [
  { account: "fidelity", symbol: "VTI", name: "Vanguard Total Stock Market ETF", quantity: 130, price: 295.14, costBasis: 31900 },
  { account: "fidelity", symbol: "VXUS", name: "Vanguard Total International Stock ETF", quantity: 180, price: 68.2, costBasis: 11120 },
  { account: "fidelity", symbol: "BND", name: "Vanguard Total Bond Market ETF", quantity: 110, price: 73.41, costBasis: 7960 },
  { account: "fidelity", symbol: "AAPL", name: "Apple Inc.", quantity: 35, price: 227.3, costBasis: 5610 },
  { account: "vanguardRoth", symbol: "VTSAX", name: "Vanguard Total Stock Market Index Admiral", quantity: 198.412, price: 141.13, costBasis: 24480 },
];

/** Monthly growth paths for the accounts that are not rolled by transactions. */
interface GrowthDef {
  key: AccountKey;
  drift: number; // mean monthly return
  vol: number; // monthly return spread
  dipMonthsAgo: number; // one bad month, then a rebound
  dip: number;
  monthly: number; // deposits that never show as transactions (payroll pension)
}

const GROWTH_DEFS: readonly GrowthDef[] = [
  { key: "fidelity", drift: 0.007, vol: 0.026, dipMonthsAgo: 9, dip: -0.072, monthly: 0 },
  { key: "vanguardRoth", drift: 0.0068, vol: 0.025, dipMonthsAgo: 9, dip: -0.068, monthly: 0 },
  { key: "menoraPension", drift: 0.0045, vol: 0.011, dipMonthsAgo: 9, dip: -0.031, monthly: 2900 },
  { key: "altshulerStudy", drift: 0.0048, vol: 0.012, dipMonthsAgo: 9, dip: -0.034, monthly: 1700 },
];

/** Bills and income that land on the same day every cycle. */
interface StreamDef {
  key: string;
  name: string;
  account: AccountKey;
  category: string;
  cadence: Cadence;
  day: number; // day of month; twice-monthly streams land on the 1st and 15th
  amount: number; // typical size, positive
  jitter: number; // relative wobble of each occurrence
  kind: "expense" | "income";
  status: "active" | "suggested" | "dismissed";
  logo: string | null;
  parity: number; // every_2_months: which months (window index % 2)
  listed: boolean; // whether the Recurring page knows about it
  transfer: boolean;
}

function stream(
  def: Pick<StreamDef, "key" | "name" | "account" | "category" | "day" | "amount"> &
    Partial<StreamDef>,
): StreamDef {
  return {
    cadence: "monthly",
    jitter: 0,
    kind: "expense",
    status: "active",
    logo: null,
    parity: 0,
    listed: true,
    transfer: false,
    ...def,
  };
}

const STREAM_DEFS: readonly StreamDef[] = [
  // Shekel side: Leumi checking
  stream({ key: "rent", name: "Rent - Landlord", account: "leumiChecking", category: "Rent", day: 2, amount: 6200 }),
  stream({ key: "arnona", name: "עיריית תל אביב - ארנונה", account: "leumiChecking", category: "Arnona", cadence: "every_2_months", day: 15, amount: 1380, jitter: 0.02, logo: "tel-aviv.gov.il" }),
  stream({ key: "vaad", name: "ועד בית", account: "leumiChecking", category: "Va'ad Bayit", day: 5, amount: 350 }),
  stream({ key: "bezeq", name: "בזק", account: "leumiChecking", category: "Internet & Cable", day: 12, amount: 109.9, logo: "bezeq.co.il" }),
  stream({ key: "maccabi", name: "מכבי שירותי בריאות", account: "leumiChecking", category: "Kupat Cholim", day: 11, amount: 296, logo: "maccabi4u.co.il" }),
  stream({ key: "harel", name: "הראל ביטוח", account: "leumiChecking", category: "Insurance", day: 6, amount: 320, logo: "harel-group.co.il" }),
  stream({ key: "carLoan", name: "Leumi Car Loan", account: "leumiChecking", category: "Auto Payment", day: 20, amount: 1150, logo: "leumi.co.il" }),
  stream({ key: "mayaSalary", name: "Lumio Tech Ltd Salary", account: "leumiChecking", category: "Paychecks", day: 10, amount: 37500, jitter: 0.012, kind: "income" }),
  stream({ key: "electric", name: "חברת החשמל", account: "leumiChecking", category: "Gas & Electric", cadence: "every_2_months", day: 18, amount: 740, jitter: 0.3, parity: 1, listed: false }),
  stream({ key: "water", name: "מי אביבים", account: "leumiChecking", category: "Water", cadence: "every_2_months", day: 22, amount: 245, jitter: 0.25, parity: 1, listed: false }),
  stream({ key: "latet", name: "לתת", account: "leumiChecking", category: "Tzedakah & Charity", day: 4, amount: 250, listed: false }),
  stream({ key: "fees", name: "עמלות לאומי", account: "leumiChecking", category: "Financial Fees", day: 1, amount: 36, jitter: 0.3, listed: false }),
  stream({ key: "mikdamot", name: "מס הכנסה - מקדמות", account: "leumiChecking", category: "Taxes", day: 15, amount: 8400, listed: false }),
  stream({ key: "bituachLeumi", name: "ביטוח לאומי", account: "leumiChecking", category: "Taxes", day: 15, amount: 1950, listed: false }),
  stream({ key: "hishtalmut", name: "Altshuler Shaham - Hishtalmut", account: "leumiChecking", category: "Transfer", day: 6, amount: 1700, listed: false, transfer: true }),
  // Shekel side: cards
  stream({ key: "partner", name: "פרטנר", account: "maxCard", category: "Phone", day: 9, amount: 59.9, logo: "partner.co.il" }),
  stream({ key: "netflix", name: "Netflix", account: "maxCard", category: "Entertainment & Recreation", day: 3, amount: 54.9, logo: "netflix.com" }),
  stream({ key: "spotify", name: "Spotify", account: "maxCard", category: "Entertainment & Recreation", day: 7, amount: 29.9, logo: "spotify.com" }),
  stream({ key: "holmes", name: "הולמס פלייס", account: "maxCard", category: "Fitness", day: 1, amount: 289, logo: "holmesplace.co.il" }),
  stream({ key: "ravkav", name: "רב-קו", account: "maxCard", category: "Public Transit", day: 3, amount: 225, logo: "ravkavonline.co.il" }),
  stream({ key: "cellcom", name: "Cellcom", account: "isracard", category: "Phone", day: 8, amount: 49.9, logo: "cellcom.co.il" }),
  // Dollar side
  stream({ key: "tomSalary", name: "Northwind Labs", account: "chaseChecking", category: "Paychecks", cadence: "twice_monthly_1_15", day: 1, amount: 4800, kind: "income" }),
  stream({ key: "studentLoan", name: "Nelnet Student Loan", account: "chaseChecking", category: "Student Loans", day: 28, amount: 480 }),
  stream({ key: "zelleMom", name: "Zelle to Mom", account: "chaseChecking", category: "Gifts", day: 2, amount: 150 }),
  stream({ key: "claude", name: "Claude.ai", account: "chaseSapphire", category: "Education", day: 5, amount: 20, logo: "claude.ai" }),
  stream({ key: "youtube", name: "YouTube Premium", account: "chaseSapphire", category: "Entertainment & Recreation", day: 12, amount: 13.99, logo: "youtube.com" }),
  stream({ key: "icloud", name: "iCloud", account: "chaseSapphire", category: "Internet & Cable", day: 18, amount: 9.99, logo: "apple.com" }),
  stream({ key: "googleFi", name: "Google Fi", account: "chaseSapphire", category: "Phone", day: 24, amount: 35, logo: "fi.google.com" }),
  stream({ key: "audible", name: "Audible", account: "chaseSapphire", category: "Entertainment & Recreation", day: 16, amount: 14.95, logo: "audible.com" }),
  stream({ key: "patreon", name: "Patreon", account: "chaseSapphire", category: "Entertainment & Recreation", day: 22, amount: 5, status: "suggested", logo: "patreon.com" }),
  stream({ key: "nytimes", name: "NYTimes", account: "chaseSapphire", category: "Education", day: 27, amount: 17, status: "suggested", logo: "nytimes.com" }),
  stream({ key: "googleOne", name: "Google One", account: "chaseSapphire", category: "Internet & Cable", day: 14, amount: 1.99, status: "dismissed", logo: "google.com" }),
];

/** Day-to-day card spending: who, where, how much, how often. */
interface Merchant {
  name: string;
  category: string;
  min: number;
  max: number;
}

function m(name: string, category: string, min: number, max: number): Merchant {
  return { name, category, min, max };
}

const GROCERIES_IL = [m("שופרסל דיל", "Groceries", 220, 780), m("רמי לוי", "Groceries", 260, 820), m("ויקטורי", "Groceries", 110, 360), m("AM:PM", "Groceries", 32, 140)];
const COFFEE_IL = [m("ארומה", "Coffee Shops", 11, 34), m("Cafe Cafe", "Coffee Shops", 14, 42), m("Landwer", "Coffee Shops", 18, 54), m("Cofix", "Coffee Shops", 5, 16), m("Golda", "Coffee Shops", 18, 48)];
const RESTAURANTS_IL = [m("Wolt", "Restaurants & Bars", 62, 215), m("Hummus Abu Hassan", "Restaurants & Bars", 42, 105), m("Miznon", "Restaurants & Bars", 58, 140), m("Port Said", "Restaurants & Bars", 120, 320), m("Japanika", "Restaurants & Bars", 95, 240), m("Benedict", "Restaurants & Bars", 110, 260)];
const FUEL_IL = [m("פז", "Gas", 190, 390), m("Sonol", "Gas", 200, 380), m("דלק", "Gas", 180, 360)];
const PARKING_IL = [m("Pango", "Parking & Tolls", 9, 58)];
const TAXI_IL = [m("Yango", "Taxi & Ride Shares", 22, 74), m("Gett", "Taxi & Ride Shares", 28, 92)];
const SHOPPING_IL = [m("Zara", "Clothing", 99, 420), m("Castro", "Clothing", 89, 360), m("H&M", "Clothing", 69, 290), m("Golf & Co", "Clothing", 99, 320), m("Fox Home", "Furniture & Housewares", 89, 520), m("Decathlon", "Shopping", 99, 560), m("Hamashbir", "Shopping", 120, 520), m("Ace", "Shopping", 60, 380), m("Steimatzky", "Entertainment & Recreation", 44, 168)];
const FUN_IL = [m("Cinema City", "Entertainment & Recreation", 48, 130), m("Yes Planet", "Entertainment & Recreation", 46, 124), m("Zappa Club", "Entertainment & Recreation", 160, 420), m("Bar Giyora", "Restaurants & Bars", 90, 260)];
const PERSONAL_IL = [m("Super-Pharm", "Personal", 48, 290), m("מכבי פארם", "Medical", 32, 185), m("מספרת שי", "Personal", 160, 280)];
// Amazon twice: it is where most of the dollar shopping happens.
const ONLINE_US = [m("Amazon", "Shopping", 15, 180), m("Amazon", "Shopping", 15, 180), m("Apple", "Electronics", 0.99, 79), m("Etsy", "Shopping", 18, 95), m("Udemy", "Education", 12, 25), m("Steam", "Entertainment & Recreation", 10, 60), m("Kindle", "Education", 6, 18)];

interface SpendPlan {
  account: AccountKey;
  table: readonly Merchant[];
  perMonth: number;
}

const SPEND_PLANS: readonly SpendPlan[] = [
  { account: "maxCard", table: GROCERIES_IL, perMonth: 6 },
  { account: "maxCard", table: COFFEE_IL, perMonth: 12 },
  { account: "maxCard", table: RESTAURANTS_IL, perMonth: 5 },
  { account: "maxCard", table: FUEL_IL, perMonth: 2.6 },
  { account: "maxCard", table: PARKING_IL, perMonth: 5 },
  { account: "maxCard", table: TAXI_IL, perMonth: 2 },
  { account: "maxCard", table: SHOPPING_IL, perMonth: 3.5 },
  { account: "maxCard", table: FUN_IL, perMonth: 1.2 },
  { account: "maxCard", table: PERSONAL_IL, perMonth: 2.2 },
  { account: "isracard", table: GROCERIES_IL, perMonth: 3 },
  { account: "isracard", table: COFFEE_IL, perMonth: 4 },
  { account: "isracard", table: RESTAURANTS_IL, perMonth: 3 },
  { account: "isracard", table: FUEL_IL, perMonth: 1.2 },
  { account: "isracard", table: TAXI_IL, perMonth: 1.5 },
  { account: "isracard", table: SHOPPING_IL, perMonth: 2 },
  { account: "isracard", table: PERSONAL_IL, perMonth: 0.8 },
  { account: "chaseSapphire", table: ONLINE_US, perMonth: 8 },
];

/** Big-ticket and one-off rows, placed relative to the current month. */
interface OneOff {
  account: AccountKey;
  monthsAgo: number;
  day: number;
  name: string;
  amount: number;
  category: string;
  notes?: string;
  tags?: string[];
}

const ONE_OFFS: readonly OneOff[] = [
  { account: "maxCard", monthsAgo: 14, day: 16, name: "IKEA", amount: -2180, category: "Furniture & Housewares", notes: "Bookshelves + desk" },
  { account: "maxCard", monthsAgo: 3, day: 9, name: "IKEA", amount: -1460, category: "Furniture & Housewares" },
  { account: "isracard", monthsAgo: 7, day: 21, name: "Dr. Levi Dental Clinic", amount: -2400, category: "Dentist", notes: "Crown, two visits" },
  { account: "maxCard", monthsAgo: 11, day: 6, name: "מוסך שלמה", amount: -1850, category: "Auto Maintenance", notes: "Timing belt + service" },
  { account: "maxCard", monthsAgo: 2, day: 24, name: "מוסך שלמה", amount: -940, category: "Auto Maintenance", notes: "Annual test + brake pads" },
  { account: "leumiChecking", monthsAgo: 15, day: 19, name: "ביטוח ישיר - ביטוח רכב", amount: -4850, category: "Insurance" },
  { account: "leumiChecking", monthsAgo: 3, day: 19, name: "ביטוח ישיר - ביטוח רכב", amount: -4980, category: "Insurance" },
  { account: "isracard", monthsAgo: 9, day: 12, name: "KSP", amount: -4290, category: "Electronics", notes: "Tom's laptop" },
  { account: "isracard", monthsAgo: 4, day: 7, name: "Isrotel Eilat", amount: -2350, category: "Travel & Vacation", tags: ["eilat"] },
  { account: "leumiChecking", monthsAgo: 8, day: 23, name: "העברה - מתנה לחתונה של נועה", amount: -800, category: "Gifts" },
  { account: "maxCard", monthsAgo: 5, day: 2, name: "El Al", amount: -2980, category: "Travel & Vacation", notes: "Flights for Dana's wedding" },
  { account: "maxCard", monthsAgo: 1, day: 13, name: "Zara", amount: 189.9, category: "Clothing", notes: "Refund" },
  { account: "chaseSapphire", monthsAgo: 6, day: 2, name: "Amazon", amount: 42.5, category: "Shopping", notes: "Refund" },
  { account: "chaseSapphire", monthsAgo: 13, day: 11, name: "Chase Sapphire annual fee", amount: -95, category: "Financial Fees" },
  { account: "chaseSapphire", monthsAgo: 1, day: 11, name: "Chase Sapphire annual fee", amount: -95, category: "Financial Fees" },
  { account: "chaseSapphire", monthsAgo: 10, day: 3, name: "Apple", amount: -999, category: "Electronics", notes: "iPhone" },
  { account: "chaseSapphire", monthsAgo: 12, day: 8, name: "Delta", amount: -1120, category: "Travel & Vacation", notes: "Thanksgiving in Boston" },
  { account: "chaseSapphire", monthsAgo: 18, day: 21, name: "United Airlines", amount: -1090, category: "Travel & Vacation", notes: "Trip home" },
  { account: "chaseSapphire", monthsAgo: 7, day: 14, name: "Marriott", amount: -640, category: "Travel & Vacation", notes: "Northwind offsite" },
  { account: "leumiChecking", monthsAgo: 10, day: 27, name: "צבעי - דירה", amount: -3200, category: "Home Improvement", notes: "Painting the apartment" },
  { account: "maxCard", monthsAgo: 6, day: 18, name: "ד\"ר כהן - רופא עור", amount: -600, category: "Medical" },
  { account: "isracard", monthsAgo: 16, day: 4, name: "אולפן גורדון", amount: -1800, category: "Education", notes: "Tom's ulpan, semester" },
  { account: "leumiChecking", monthsAgo: 2, day: 9, name: "העברה - מתנה ליום הולדת", amount: -500, category: "Gifts" },
];

/** [day, merchant, amount, category] */
type TripRow = readonly [number, string, number, string];

const NYC_ROWS: readonly TripRow[] = [
  [9, "Uber", -54.2, "Taxi & Ride Shares"], [9, "Shake Shack", -31.4, "Restaurants & Bars"],
  [10, "Blue Bottle Coffee", -8.75, "Coffee Shops"], [10, "Trader Joe's", -46.3, "Groceries"], [10, "MTA OMNY", -34, "Public Transit"],
  [11, "Chipotle", -18.9, "Restaurants & Bars"], [11, "The Met Museum", -60, "Entertainment & Recreation"],
  [12, "Whole Foods", -72.8, "Groceries"], [12, "Uber", -23.6, "Taxi & Ride Shares"],
  [13, "Katz's Delicatessen", -64.5, "Restaurants & Bars"], [13, "Blue Bottle Coffee", -11.25, "Coffee Shops"],
  [14, "Costco", -187.4, "Groceries"], [14, "Telecharge - Broadway", -312, "Entertainment & Recreation"],
  [15, "Chipotle", -24.1, "Restaurants & Bars"], [15, "Strand Bookstore", -38.2, "Entertainment & Recreation"],
  [16, "Trader Joe's", -29.9, "Groceries"], [16, "Uber", -17.8, "Taxi & Ride Shares"],
  [17, "Whole Foods", -41.6, "Groceries"], [17, "Shake Shack", -27.3, "Restaurants & Bars"],
  [18, "Chipotle", -15.6, "Restaurants & Bars"], [18, "Blue Bottle Coffee", -9.5, "Coffee Shops"],
  [19, "Uber", -61.8, "Taxi & Ride Shares"], [19, "Hudson News - JFK", -14.9, "Shopping"],
];

const GREECE_ROWS: readonly TripRow[] = [
  [3, "Athens Airport Express", -42, "Public Transit"], [3, "Taverna Nikos", -238, "Restaurants & Bars"],
  [4, "Acropolis Museum", -98, "Entertainment & Recreation"], [4, "Kiosk Plaka", -46, "Groceries"],
  [5, "Blue Star Ferries", -412, "Travel & Vacation"], [5, "Paros Beach Bar", -164, "Restaurants & Bars"],
  [6, "Naoussa Rent a Car", -1120, "Travel & Vacation"], [6, "Sklavenitis Market", -187, "Groceries"],
  [7, "Taverna Nikos", -296, "Restaurants & Bars"], [8, "Paros Beach Bar", -132, "Restaurants & Bars"],
  [8, "Kiosk Naoussa", -58, "Groceries"], [9, "Pharmacy Parikia", -74, "Medical"],
  [9, "Ouzeri Kostas", -221, "Restaurants & Bars"], [10, "Athens Metro", -38, "Public Transit"],
];

/** The last few days always have fresh card activity; these are the pending rows. */
const RECENT_ROWS: readonly { account: AccountKey; daysAgo: number; name: string; amount: number; category: string }[] = [
  { account: "maxCard", daysAgo: 0, name: "ארומה", amount: -24, category: "Coffee Shops" },
  { account: "maxCard", daysAgo: 1, name: "Wolt", amount: -118.5, category: "Restaurants & Bars" },
  { account: "maxCard", daysAgo: 2, name: "שופרסל דיל", amount: -312.4, category: "Groceries" },
  { account: "chaseSapphire", daysAgo: 3, name: "Amazon", amount: -38.9, category: "Shopping" },
];

/** What Tom buys with spare dollars every four months, in turn. */
const LUMP_SYMBOLS = ["VXUS", "VTI", "BND"] as const;

/** Monthly card bills: statement = calendar month, paid from the bank on a fixed day. */
const BILL_DEFS: readonly { card: AccountKey; day: number; bankName: string; cardName: string }[] = [
  { card: "maxCard", day: 10, bankName: "Max bill", cardName: "Max - bill payment" },
  { card: "isracard", day: 15, bankName: "Isracard bill", cardName: "Isracard - bill payment" },
  { card: "chaseSapphire", day: 5, bankName: "Chase Sapphire payment", cardName: "Payment Thank You - Web" },
];

const BUDGET_ILS: readonly (readonly [string, number])[] = [
  ["Paychecks", 37500], ["Groceries", 3200], ["Restaurants & Bars", 1400], ["Coffee Shops", 350], ["Gas", 900],
  ["Rent", 6200], ["Arnona", 700], ["Va'ad Bayit", 350], ["Gas & Electric", 400], ["Phone", 120],
  ["Kupat Cholim", 300], ["Fitness", 300], ["Public Transit", 250], ["Shopping", 600], ["Clothing", 600],
  ["Personal", 450], ["Entertainment & Recreation", 300], ["Insurance", 350], ["Auto Payment", 1150],
];

const BUDGET_USD: readonly (readonly [string, number])[] = [
  ["Paychecks", 9600], ["Groceries", 450], ["Restaurants & Bars", 300], ["Shopping", 250],
  ["Entertainment & Recreation", 40], ["Education", 40], ["Student Loans", 420],
];

// ---------------------------------------------------------------------------
// Generation state
// ---------------------------------------------------------------------------

interface MonthRef {
  index: number; // 0 = oldest month in the window
  y: number;
  m0: number;
  key: string; // YYYY-MM
  days: number;
}

interface Seed {
  rng: Rng;
  now: Date;
  today: string;
  start: string; // first day of the window
  startIso: string;
  months: MonthRef[];
  last: MonthRef; // the current month
  fx: Map<string, number>; // USD -> ILS by date
  accounts: Map<AccountKey, AccountRow>;
  txns: TransactionRow[];
  seq: Map<AccountKey, number>;
}

function createSeed(now: Date): Seed {
  const months: MonthRef[] = [];
  for (let i = 0; i <= MONTHS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK + i, 1);
    months.push({
      index: i,
      y: d.getFullYear(),
      m0: d.getMonth(),
      key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      days: daysInMonth(d.getFullYear(), d.getMonth()),
    });
  }
  const start = dateOf(months[0].y, months[0].m0, 1);
  const seed: Seed = {
    rng: new Rng(SEED),
    now,
    today: ymd(now),
    start,
    startIso: isoAt(start, 9, 0),
    months,
    last: months[months.length - 1],
    fx: new Map(),
    accounts: new Map(),
    txns: [],
    seq: new Map(),
  };
  for (const [i, def] of ACCOUNT_DEFS.entries()) seed.accounts.set(def.key, buildAccount(seed, def, i));
  return seed;
}

function account(seed: Seed, key: AccountKey): AccountRow {
  const a = seed.accounts.get(key);
  if (!a) throw new Error(`Unknown account: ${key}`);
  return a;
}

function monthsAgo(seed: Seed, n: number): MonthRef | undefined {
  return seed.months[seed.last.index - n];
}

function clampDay(mo: MonthRef, day: number): string {
  return dateOf(mo.y, mo.m0, Math.min(day, mo.days));
}

function usdIls(seed: Seed, date: string): number {
  return seed.fx.get(date) ?? 3.6;
}

function buildAccount(seed: Seed, def: AccountDef, order: number): AccountRow {
  const connection =
    def.source === "riseup" ? CONNECTION_IDS.riseup : def.source === "plaid" ? CONNECTION_IDS.plaid : null;
  return {
    id: uuidFromKey(`account:${def.key}`),
    space_id: DEMO_SPACE_ID,
    connection_id: connection,
    source: def.source,
    external_id: `${def.source}-${def.mask}`,
    name: def.name,
    official_name: def.official,
    institution_name: def.institution,
    type: def.type,
    currency: def.currency,
    mask: def.mask,
    current_balance: null, // filled in once the history is rolled
    available_balance: null,
    is_liability: def.liability,
    include_in_net_worth: true,
    hidden: false,
    owner_user_id: def.owner,
    display_order: order,
    created_at: seed.startIso,
    closed_at: null,
    deleted_at: null,
    subtype: def.subtype,
    linked_account_id: def.paysFrom ? uuidFromKey(`account:${def.paysFrom}`) : null,
    balance_anchor: null,
    balance_anchor_date: null,
    forecast_include: true,
    forecast_growth_pct: null,
    forecast_contribution: 0,
    forecast_growth_mode: null,
    forecast_growth_points: null,
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

interface TxnSpec {
  account: AccountKey;
  date: string;
  name: string;
  amount: number;
  category: string | null;
  by?: Transaction["categorized_by"];
  transfer?: boolean;
  stream?: string | null;
  notes?: string | null;
  tags?: string[];
  reviewed?: boolean;
}

function externalId(source: Account["source"], key: AccountKey, n: number): string {
  const prefix = source === "riseup" ? "ru" : source === "plaid" ? "pl" : "mn";
  return `${prefix}-${key}-${String(n).padStart(5, "0")}`;
}

function addTxn(seed: Seed, spec: TxnSpec): TransactionRow {
  const acc = account(seed, spec.account);
  const n = (seed.seq.get(spec.account) ?? 0) + 1;
  seed.seq.set(spec.account, n);
  const transfer = spec.transfer ?? false;
  const by = spec.by ?? (RULE_MERCHANTS.has(spec.name) ? "rule" : "provider");
  const age = dayDiff(spec.date, seed.today);
  // Older rows are mostly reviewed; the last few weeks still need a look.
  const reviewed = spec.reviewed ?? (by === "user" || seed.rng.chance(age > 45 ? 0.9 : 0.5));
  const createdAt = isoAt(spec.date, 6 + (n % 12), (n * 7) % 60);
  const row: TransactionRow = {
    id: uuidFromKey(`txn:${spec.account}:${n}`),
    space_id: DEMO_SPACE_ID,
    account_id: acc.id,
    connection_id: acc.connection_id,
    source: acc.source,
    external_id: externalId(acc.source, spec.account, n),
    date: spec.date,
    name: spec.name,
    original_name: spec.name,
    amount: round2(spec.amount),
    currency: acc.currency,
    category_id: spec.category ? categoryId(spec.category) : null,
    categorized_by: spec.category ? by : "none",
    notes: spec.notes ?? null,
    tags: spec.tags ?? [],
    pending: false,
    is_transfer: transfer,
    hide_from_reports: false,
    recurring_stream_id: spec.stream ? uuidFromKey(`stream:${spec.stream}`) : null,
    raw: null,
    created_at: createdAt,
    updated_at: createdAt,
    attachments: [],
    payment_method: transfer ? "transfer" : acc.type === "credit" ? "card" : "bank",
    reviewed,
    transfer_pair_id: null,
    split_parent_id: null,
  };
  seed.txns.push(row);
  return row;
}

function pairTransfer(a: TransactionRow, b: TransactionRow): void {
  a.transfer_pair_id = b.id;
  b.transfer_pair_id = a.id;
}

/** Every date a stream lands on inside the window, up to today. */
function occurrences(def: StreamDef, seed: Seed): string[] {
  const out: string[] = [];
  for (const mo of seed.months) {
    if (def.cadence === "every_2_months" && mo.index % 2 !== def.parity) continue;
    const days = def.cadence === "twice_monthly_1_15" ? [1, 15] : [def.day];
    for (const day of days) {
      const date = clampDay(mo, day);
      if (date <= seed.today) out.push(date);
    }
  }
  return out;
}

/** The first expected date after today. */
function nextExpected(def: StreamDef, seed: Seed): string {
  const first = seed.months[0];
  for (let i = 1; i <= 70; i++) {
    const date = addDays(seed.today, i);
    const d = parseYmd(date);
    const index = (d.getFullYear() - first.y) * 12 + (d.getMonth() - first.m0);
    const day = d.getDate();
    const onDay = day === Math.min(def.day, daysInMonth(d.getFullYear(), d.getMonth()));
    const hit =
      def.cadence === "twice_monthly_1_15"
        ? day === 1 || day === 15
        : def.cadence === "every_2_months"
          ? onDay && index % 2 === def.parity
          : onDay;
    if (hit) return date;
  }
  return addDays(seed.today, 30);
}

function generateStreams(seed: Seed): void {
  for (const def of STREAM_DEFS) {
    for (const date of occurrences(def, seed)) {
      const wobble = def.jitter ? 1 + seed.rng.gauss(0, def.jitter) : 1;
      const amount = round2(def.amount * wobble) * (def.kind === "income" ? 1 : -1);
      addTxn(seed, {
        account: def.account,
        date,
        name: def.name,
        amount,
        category: def.category,
        transfer: def.transfer,
        stream: def.listed && def.status === "active" ? def.key : null,
      });
    }
  }
}

function generateSpending(seed: Seed): void {
  for (const mo of seed.months) {
    for (const plan of SPEND_PLANS) {
      const n = seed.rng.count(plan.perMonth);
      for (let i = 0; i < n; i++) {
        const date = dateOf(mo.y, mo.m0, seed.rng.int(1, mo.days));
        const merchant = seed.rng.pick(plan.table);
        const amount = -seed.rng.money(merchant.min, merchant.max);
        const byUser = seed.rng.chance(0.06);
        if (date > seed.today) continue;
        addTxn(seed, {
          account: plan.account,
          date,
          name: merchant.name,
          amount,
          category: merchant.category,
          by: byUser ? "user" : undefined,
        });
      }
    }
  }
}

function generateOneOffs(seed: Seed): void {
  for (const o of ONE_OFFS) {
    const mo = monthsAgo(seed, o.monthsAgo);
    if (!mo) continue;
    const date = clampDay(mo, o.day);
    if (date > seed.today) continue;
    addTxn(seed, { account: o.account, date, name: o.name, amount: o.amount, category: o.category, notes: o.notes, tags: o.tags });
  }
}

function addTripRows(seed: Seed, acc: AccountKey, mo: MonthRef, rows: readonly TripRow[], tag: string): void {
  for (const [day, name, amount, category] of rows) {
    const date = clampDay(mo, day);
    if (date <= seed.today) addTxn(seed, { account: acc, date, name, amount, category, tags: [tag] });
  }
}

function generateTrips(seed: Seed): void {
  // New York last spring: flights and the apartment booked ahead, then ten days of charges.
  const nycYear = seed.now.getMonth() >= 5 ? seed.now.getFullYear() : seed.now.getFullYear() - 1;
  const nyc = seed.months.find((mo) => mo.y === nycYear && mo.m0 === 3);
  if (nyc) {
    const twoBefore = seed.months[nyc.index - 2];
    const oneBefore = seed.months[nyc.index - 1];
    if (twoBefore) addTxn(seed, { account: "chaseSapphire", date: clampDay(twoBefore, 20), name: "Delta", amount: -1184, category: "Travel & Vacation", tags: ["nyc"], notes: "TLV-JFK, two tickets" });
    if (oneBefore) addTxn(seed, { account: "chaseSapphire", date: clampDay(oneBefore, 2), name: "Airbnb", amount: -1460, category: "Travel & Vacation", tags: ["nyc"] });
    addTripRows(seed, "chaseSapphire", nyc, NYC_ROWS, "nyc");
    const atm = clampDay(nyc, 11);
    if (atm <= seed.today) addTxn(seed, { account: "chaseChecking", date: atm, name: "Chase ATM - Manhattan", amount: -200, category: "Cash & ATM", tags: ["nyc"] });
  }
  // Greece: the most recent August that is at least a couple of months back.
  const greeceYear = seed.now.getMonth() >= 9 ? seed.now.getFullYear() : seed.now.getFullYear() - 1;
  const greece = seed.months.find((mo) => mo.y === greeceYear && mo.m0 === 7);
  if (greece) {
    const twoBefore = seed.months[greece.index - 2];
    const oneBefore = seed.months[greece.index - 1];
    if (twoBefore) addTxn(seed, { account: "maxCard", date: clampDay(twoBefore, 14), name: "El Al", amount: -3480, category: "Travel & Vacation", tags: ["greece"], notes: "TLV-ATH, two tickets" });
    if (oneBefore) addTxn(seed, { account: "chaseSapphire", date: clampDay(oneBefore, 20), name: "Booking.com", amount: -618, category: "Travel & Vacation", tags: ["greece"] });
    addTripRows(seed, "maxCard", greece, GREECE_ROWS, "greece");
  }
}

function generateRecentActivity(seed: Seed): void {
  for (const r of RECENT_ROWS) {
    const row = addTxn(seed, { account: r.account, date: addDays(seed.today, -r.daysAgo), name: r.name, amount: r.amount, category: r.category, reviewed: false });
    row.pending = true;
  }
}

function contribute(seed: Seed, to: AccountKey, date: string, amount: number, symbol: string): void {
  const out = addTxn(seed, { account: "chaseChecking", date, name: to === "fidelity" ? "Fidelity Investments" : "Vanguard", amount: -amount, category: "Transfer", transfer: true });
  const inn = addTxn(seed, { account: to, date, name: "Transfer from Chase", amount, category: "Transfer", transfer: true });
  pairTransfer(out, inn);
  addTxn(seed, { account: to, date, name: `Buy ${symbol}`, amount: -amount, category: "Buy", transfer: true });
}

function generateSavingsAndRetirement(seed: Seed): void {
  for (const mo of seed.months) {
    // The day after Maya's salary, ₪8,000 goes to the pikadon.
    const savingsDate = clampDay(mo, 11);
    if (savingsDate <= seed.today) {
      const out = addTxn(seed, { account: "leumiChecking", date: savingsDate, name: "Transfer to Leumi Savings", amount: -8000, category: "Transfer", transfer: true });
      const inn = addTxn(seed, { account: "leumiSavings", date: savingsDate, name: "Transfer from Leumi Checking", amount: 8000, category: "Transfer", transfer: true });
      pairTransfer(out, inn);
    }
    // $700 a month into Fidelity, and a twelfth of the Roth limit into Vanguard.
    const fidDate = clampDay(mo, 3);
    if (fidDate <= seed.today) contribute(seed, "fidelity", fidDate, 700, "VTI");
    const rothDate = clampDay(mo, 4);
    if (rothDate <= seed.today) contribute(seed, "vanguardRoth", rothDate, 583.33, "VTSAX");
  }
}

/** Net flow per window month for one account; the partial current month borrows last month's figure. */
function monthlyNet(seed: Seed, key: AccountKey): number[] {
  const id = account(seed, key).id;
  const byMonth = new Map<string, number>();
  for (const t of seed.txns) {
    if (t.account_id === id) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
  }
  const nets = seed.months.map((mo) => byMonth.get(mo.key) ?? 0);
  if (nets.length > 1) nets[nets.length - 1] = nets[nets.length - 2];
  return nets;
}

/**
 * Tom moves dollars over with Wise once a month, sized to what the shekel
 * account needs: whatever Maya's salary did not cover, give or take a bit.
 * Runs after every other shekel row exists, so the checking balance holds a
 * steady level instead of drifting with two years of random spending.
 */
function generateWise(seed: Seed): void {
  const nets = monthlyNet(seed, "leumiChecking");
  let shortfall = 0; // cumulative shekel need, net of what was already sent
  for (const mo of seed.months) {
    shortfall -= nets[mo.index];
    const date = clampDay(mo, 8);
    if (date > seed.today) break;
    const rate = usdIls(seed, date) * (1 - WISE_FEE);
    const wanted = (shortfall + 100 * seed.rng.int(-3, 3) * rate) / rate;
    const usd = Math.min(5200, Math.max(0, 100 * Math.round(wanted / 100)));
    if (usd < 500) continue; // the shekel side covered itself this month
    const ils = round2(usd * rate);
    const out = addTxn(seed, { account: "chaseChecking", date, name: "Wise Transfer", amount: -usd, category: "Transfer", transfer: true });
    const inn = addTxn(seed, { account: "leumiChecking", date, name: "Wise", amount: ils, category: "Transfer", transfer: true });
    pairTransfer(out, inn);
    shortfall -= ils;
  }
}

/** Every other month Tom invests the dollars that piled up in Chase beyond a small cushion. */
function generateFidelityLumps(seed: Seed): void {
  const nets = monthlyNet(seed, "chaseChecking");
  let cum = 0;
  let invested = 0;
  let k = 0;
  for (const mo of seed.months) {
    cum += nets[mo.index];
    if ((seed.last.index - mo.index) % 2 !== 1) continue;
    const date = clampDay(mo, 17);
    if (date > seed.today) continue;
    const spare = 100 * Math.floor((cum - invested - 500) / 100);
    if (spare < 1000) continue;
    const amount = Math.min(9000, spare);
    contribute(seed, "fidelity", date, amount, LUMP_SYMBOLS[k++ % LUMP_SYMBOLS.length]);
    invested += amount;
  }
}

function generateBankExtras(seed: Seed): void {
  for (const mo of seed.months) {
    // US self-employment tax, quarterly.
    if ([0, 3, 5, 8].includes(mo.m0) && clampDay(mo, 15) <= seed.today) {
      addTxn(seed, { account: "chaseChecking", date: clampDay(mo, 15), name: "IRS USATAXPYMT", amount: -5000, category: "Taxes" });
    }
    // Quarterly dividends and pikadon interest at quarter end.
    if (mo.m0 % 3 === 2 && clampDay(mo, 28) <= seed.today) {
      addTxn(seed, { account: "fidelity", date: clampDay(mo, 28), name: "Dividend - VTI", amount: seed.rng.money(118, 176), category: "Dividends & Capital Gains" });
      addTxn(seed, { account: "fidelity", date: clampDay(mo, 28), name: "Dividend - BND", amount: seed.rng.money(26, 36), category: "Dividends & Capital Gains" });
      if (clampDay(mo, 31) <= seed.today) addTxn(seed, { account: "leumiSavings", date: clampDay(mo, 31), name: "ריבית פיקדון", amount: seed.rng.money(560, 760), category: "Interest" });
    }
    // The odd Zelle to a friend.
    if (seed.rng.chance(0.7) && clampDay(mo, 19) <= seed.today) {
      addTxn(seed, { account: "chaseChecking", date: clampDay(mo, 19), name: "Zelle - Dave M.", amount: -seed.rng.money(50, 160), category: "Fun Money" });
    }
  }
  // Cash every five or six weeks.
  for (let d = addDays(seed.start, seed.rng.int(5, 25)); d <= seed.today; d = addDays(d, seed.rng.int(28, 52))) {
    addTxn(seed, { account: "leumiChecking", date: d, name: "משיכת מזומן - כספומט לאומי", amount: -100 * seed.rng.int(3, 8), category: "Cash & ATM" });
  }
}

/** The loan side of each car-loan payment: the principal portion, worked backwards from today's debt. */
function generateLoanPrincipal(seed: Seed): void {
  const def = STREAM_DEFS.find((s) => s.key === "carLoan");
  if (!def) return;
  const dates = occurrences(def, seed);
  const rate = 0.065 / 12;
  const before: number[] = new Array<number>(dates.length).fill(0);
  let debt = 48000;
  for (let i = dates.length - 1; i >= 0; i--) {
    debt = (debt + def.amount) / (1 + rate);
    before[i] = debt;
  }
  dates.forEach((date, i) => {
    const interest = round2(before[i] * rate);
    addTxn(seed, { account: "carLoan", date, name: "Car loan - principal", amount: round2(def.amount - interest), category: "Transfer", transfer: true });
  });
}

/** Bank-side debits of last month's card statement, paired with the card-side payment. */
function generateCardBills(seed: Seed): void {
  for (const def of BILL_DEFS) {
    const cardDef = ACCOUNT_DEFS.find((a) => a.key === def.card);
    if (!cardDef?.paysFrom) continue;
    const cardId = account(seed, def.card).id;
    const byMonth = new Map<string, number>();
    for (const t of seed.txns) {
      if (t.account_id === cardId && !t.is_transfer && !t.pending) {
        byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
      }
    }
    for (const mo of seed.months) {
      if (mo.index === 0) continue;
      const charges = byMonth.get(seed.months[mo.index - 1].key) ?? 0;
      const date = clampDay(mo, def.day);
      if (charges >= 0 || date > seed.today) continue;
      const bill = round2(-charges);
      const out = addTxn(seed, { account: cardDef.paysFrom, date, name: def.bankName, amount: -bill, category: "Credit Card Payment", transfer: true, by: "rule" });
      const inn = addTxn(seed, { account: def.card, date, name: def.cardName, amount: bill, category: "Credit Card Payment", transfer: true, by: "rule" });
      pairTransfer(out, inn);
    }
  }
}

// ---------------------------------------------------------------------------
// Balances and snapshots
// ---------------------------------------------------------------------------

interface SnapshotResult {
  rows: BalanceSnapshotRow[];
  paths: Map<AccountKey, { date: string; value: number }[]>;
}

/** A monthly value path that lands exactly on today's balance. */
function monthlyPath(seed: Seed, def: GrowthDef, target: number): { date: string; value: number }[] {
  const acc = account(seed, def.key);
  const incoming = new Map<string, number>();
  for (const t of seed.txns) {
    if (t.account_id === acc.id && t.is_transfer && t.amount > 0) {
      incoming.set(t.date.slice(0, 7), (incoming.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    }
  }
  const lastIndex = seed.months.length - 1;
  const dates = seed.months.slice(1).map((mo) => dateOf(mo.y, mo.m0, 1));
  if (dates[dates.length - 1] !== seed.today) dates.push(seed.today);
  // Step i runs from the 1st of month i to the next point (a full month, or today).
  const returns = dates.map((_, i) => {
    const partial = i === lastIndex ? seed.now.getDate() / 30 : 1;
    let r = def.drift + def.vol * seed.rng.gauss(0, 1);
    if (i === lastIndex - def.dipMonthsAgo) r = def.dip;
    if (i === lastIndex - def.dipMonthsAgo + 1) r = Math.abs(r) + 0.02;
    return r * partial;
  });
  const contributions = dates.map((_, i) => (incoming.get(seed.months[Math.min(i, lastIndex)].key) ?? 0) + def.monthly);
  // Solve the opening value: target = V0 * Π(1+r) + Σ c_i * Π_{j>i}(1+r_j)
  let growth = 1;
  let carried = 0;
  for (let i = 0; i < dates.length; i++) {
    growth *= 1 + returns[i];
    carried = carried * (1 + returns[i]) + contributions[i];
  }
  let value = (target - carried) / growth;
  const out = [{ date: seed.start, value: round2(value) }];
  for (let i = 0; i < dates.length; i++) {
    value = value * (1 + returns[i]) + contributions[i];
    out.push({ date: dates[i], value: round2(value) });
  }
  return out;
}

/**
 * Daily balances between the monthly points. The real app snapshots every
 * account every night, and the net-worth windows assume that: an account with
 * only monthly rows would drop out of the first days of a window.
 */
function expandDaily(path: { date: string; value: number }[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!b) {
      out.push(a);
      break;
    }
    const span = Math.max(1, Math.round((parseYmd(b.date).getTime() - parseYmd(a.date).getTime()) / 86_400_000));
    for (let k = 0; k < span; k++) {
      out.push({ date: addDays(a.date, k), value: round2(a.value + ((b.value - a.value) * k) / span) });
    }
  }
  return out;
}

function buildSnapshots(seed: Seed): SnapshotResult {
  const rows: BalanceSnapshotRow[] = [];
  const paths = new Map<AccountKey, { date: string; value: number }[]>();
  const holdingsTotal = new Map<AccountKey, number>();
  for (const h of HOLDING_DEFS) holdingsTotal.set(h.account, (holdingsTotal.get(h.account) ?? 0) + round2(h.quantity * h.price));

  for (const def of ACCOUNT_DEFS) {
    const acc = account(seed, def.key);
    if (def.daily) {
      // Opening balance = today's target less everything that happened since; cards start the window clean.
      const mine = seed.txns.filter((t) => t.account_id === acc.id);
      const total = mine.reduce((s, t) => s + t.amount, 0);
      const byDate = new Map<string, number>();
      for (const t of mine) byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount);
      let balance = def.type === "credit" ? 0 : def.target - total;
      for (let d = seed.start; d <= seed.today; d = addDays(d, 1)) {
        balance += byDate.get(d) ?? 0;
        rows.push({ account_id: acc.id, as_of_date: d, balance: round2(balance), currency: acc.currency, source: "sync" });
      }
      acc.current_balance = round2(balance);
    } else {
      const growth = GROWTH_DEFS.find((g) => g.key === def.key);
      if (!growth) continue;
      const path = monthlyPath(seed, growth, holdingsTotal.get(def.key) ?? def.target);
      paths.set(def.key, path);
      for (const p of expandDaily(path)) rows.push({ account_id: acc.id, as_of_date: p.date, balance: p.value, currency: acc.currency, source: "sync" });
      acc.current_balance = path[path.length - 1].value;
    }
    acc.available_balance = def.creditLimit != null ? round2(def.creditLimit + acc.current_balance) : acc.current_balance;
    if (def.source === "manual") {
      acc.balance_anchor = acc.current_balance;
      acc.balance_anchor_date = seed.today;
    }
  }
  return { rows, paths };
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

function buildCategories(seed: Seed): CategoryRow[] {
  return DEMO_TAXONOMY.map(([group, name, icon, kind, bucket], i) => ({
    id: categoryId(name),
    space_id: DEMO_SPACE_ID,
    group,
    name,
    icon,
    kind,
    exclude_from_budget: kind === "transfer",
    display_order: (i + 1) * 10,
    is_system: group === "Transfers",
    created_at: seed.startIso,
    budget_bucket: bucket,
    name_he: HEBREW_NAMES[name] ?? null,
    color: null,
  }));
}

function buildConnections(seed: Seed): ConnectionRow[] {
  const hoursAgo = (h: number) => new Date(seed.now.getTime() - h * 3600_000).toISOString();
  return [
    {
      id: CONNECTION_IDS.riseup,
      space_id: DEMO_SPACE_ID,
      provider: "riseup",
      label: "RiseUp",
      institution_name: "RiseUp",
      environment: "production",
      external_item_id: null,
      status: "active",
      error: null,
      config: { token_created_at: hoursAgo(24 * 12) },
      created_by: DEMO_USER_ID,
      created_at: seed.startIso,
      last_synced_at: hoursAgo(3.2),
    },
    {
      id: CONNECTION_IDS.plaid,
      space_id: DEMO_SPACE_ID,
      provider: "plaid",
      label: "Chase",
      institution_name: "Chase",
      environment: "production",
      external_item_id: "demo-item-chase",
      status: "active",
      error: null,
      config: { institution_id: "ins_56", products: ["transactions"] },
      created_by: DEMO_PARTNER_ID,
      created_at: seed.startIso,
      last_synced_at: hoursAgo(1.7),
    },
  ];
}

function buildStreamRows(seed: Seed): RecurringStreamRow[] {
  return STREAM_DEFS.filter((def) => def.listed).map((def) => {
    const acc = account(seed, def.account);
    const dates = occurrences(def, seed);
    return {
      id: uuidFromKey(`stream:${def.key}`),
      space_id: DEMO_SPACE_ID,
      merchant_name: def.name,
      match_pattern: null,
      account_id: acc.id,
      cadence: def.cadence,
      typical_amount: def.amount,
      currency: acc.currency,
      next_expected_date: nextExpected(def, seed),
      kind: def.kind,
      status: def.status,
      created_at: seed.startIso,
      start_date: dates[0] ?? seed.start,
      category_id: categoryId(def.category),
      logo_domain: def.logo,
      logo_url: null,
    };
  });
}

/** Maya recategorized a few recent rows by hand; each leaves a short trail. */
function buildEvents(seed: Seed): TransactionEventRow[] {
  const nameOf = new Map(DEMO_TAXONOMY.map((c) => [categoryId(c[1]), c[1]]));
  const guesses = ["Uncategorized", "Miscellaneous", "Shopping", "Fun Money"];
  const out: TransactionEventRow[] = [];
  let k = 0;
  for (const t of seed.txns) {
    if (t.categorized_by !== "user" || !t.category_id || dayDiff(t.date, seed.today) > 60) continue;
    const final = nameOf.get(t.category_id) ?? "Uncategorized";
    const others = guesses.filter((g) => g !== final);
    const steps = k % 3 === 0 ? [others[0], others[1], final] : [others[k % others.length], final];
    steps.forEach((name, i) => {
      out.push({
        id: uuidFromKey(`txn-event:${t.id}:${i}`),
        space_id: DEMO_SPACE_ID,
        transaction_id: t.id,
        kind: "category",
        summary: `Category set to ${name}`,
        actor_name: "Maya",
        created_at: isoAt(t.date, 17 + i, (k * 11 + i * 5) % 60),
      });
    });
    t.updated_at = isoAt(t.date, 17 + steps.length - 1, (k * 11 + (steps.length - 1) * 5) % 60);
    k++;
  }
  return out;
}

function buildBudgets(seed: Seed): BudgetRow[] {
  const out: BudgetRow[] = [];
  for (let back = 0; back <= 2; back++) {
    const mo = monthsAgo(seed, back);
    if (!mo) continue;
    const month = `${mo.key}-01`;
    for (const [name, amount] of BUDGET_ILS) out.push({ space_id: DEMO_SPACE_ID, month, category_id: categoryId(name), amount, rollover: false, currency: "ILS" });
    for (const [name, amount] of BUDGET_USD) out.push({ space_id: DEMO_SPACE_ID, month, category_id: categoryId(name), amount, rollover: false, currency: "USD" });
  }
  return out;
}

function buildGoals(seed: Seed, snapshots: BalanceSnapshotRow[]): { goals: GoalRow[]; links: GoalAccountRow[] } {
  const loan = account(seed, "carLoan");
  const openingDebt = Math.abs(snapshots.find((s) => s.account_id === loan.id)?.balance ?? 48000);
  const y = seed.now.getFullYear();
  const springYear = seed.now.getMonth() < 3 ? y : y + 1;
  const monthsOut = (n: number) => dateOf(y, seed.now.getMonth() + n, 1);
  const goals: GoalRow[] = [
    { id: uuidFromKey("goal:emergency"), space_id: DEMO_SPACE_ID, name: "Emergency fund", icon: "🛟", kind: "save_up", target_amount: 300000, currency: "ILS", target_date: monthsOut(18), starting_amount: 0, planned_monthly: 8000, status: "active", display_order: 0, created_at: seed.startIso },
    { id: uuidFromKey("goal:japan"), space_id: DEMO_SPACE_ID, name: "Japan trip", icon: "🗾", kind: "save_up", target_amount: 6000, currency: "USD", target_date: `${springYear}-04-15`, starting_amount: 2250, planned_monthly: 500, status: "active", display_order: 1, created_at: isoAt(monthsOut(-4), 9, 0) },
    { id: uuidFromKey("goal:car-loan"), space_id: DEMO_SPACE_ID, name: "Pay off the car loan", icon: "🚗", kind: "pay_down", target_amount: Math.round(openingDebt), currency: "ILS", target_date: monthsOut(48), starting_amount: Math.round(openingDebt), planned_monthly: 1150, status: "active", display_order: 2, created_at: seed.startIso },
  ];
  const links: GoalAccountRow[] = [
    { goal_id: goals[0].id, account_id: account(seed, "leumiSavings").id },
    { goal_id: goals[2].id, account_id: loan.id },
  ];
  return { goals, links };
}

function buildHoldings(seed: Seed): HoldingRow[] {
  const asOf = new Date(seed.now.getTime() - 1.7 * 3600_000).toISOString();
  return HOLDING_DEFS.map((h) => ({
    id: uuidFromKey(`holding:${h.account}:${h.symbol}`),
    account_id: account(seed, h.account).id,
    external_id: `${h.account}-${h.symbol}`,
    symbol: h.symbol,
    name: h.name,
    quantity: h.quantity,
    price: h.price,
    value: round2(h.quantity * h.price),
    cost_basis: h.costBasis,
    currency: "USD",
    as_of: asOf,
  }));
}

function buildPensionConfigs(seed: Seed, paths: SnapshotResult["paths"]): PensionConfigRow[] {
  const anchorOf = (key: AccountKey) => {
    const path = paths.get(key) ?? [];
    return path[Math.max(0, path.length - 4)] ?? { date: seed.today, value: 0 };
  };
  const applied = monthsAgo(seed, 2)?.key ?? seed.today.slice(0, 7);
  const updatedAt = new Date(seed.now.getTime() - 26 * 3600_000).toISOString();
  const menora = anchorOf("menoraPension");
  const altshuler = anchorOf("altshulerStudy");
  return [
    { account_id: account(seed, "menoraPension").id, provider: "Menorah Mivtachim", dataset: "pensianet", fund_id: 9661, annual_fee_pct: 0.22, deposit_fee_pct: 1.5, monthly_contribution: 2900, anchor_date: menora.date, anchor_balance: menora.value, last_applied_period: applied, updated_at: updatedAt },
    { account_id: account(seed, "altshulerStudy").id, provider: "Altshuler Shaham", dataset: "gemelnet", fund_id: 1416, annual_fee_pct: 0.65, deposit_fee_pct: 0, monthly_contribution: 1700, anchor_date: altshuler.date, anchor_balance: altshuler.value, last_applied_period: applied, updated_at: updatedAt },
  ];
}

/** USD/ILS as a mean-reverting daily walk between about 3.35 and 3.85. */
function buildFxRates(seed: Seed): FxRateRow[] {
  const rows: FxRateRow[] = [];
  let rate = 3.72;
  const end = addDays(seed.today, 14);
  for (let d = addDays(seed.start, -7); d <= end; d = addDays(d, 1)) {
    rate += seed.rng.gauss(0, 0.011) + (3.6 - rate) * 0.012;
    rate = Math.min(3.85, Math.max(3.35, rate));
    const rounded = Math.round(rate * 10000) / 10000;
    rows.push({ rate_date: d, base: "USD", quote: "ILS", rate: rounded });
    seed.fx.set(d, rounded);
  }
  return rows;
}

function sortTxns(seed: Seed): void {
  seed.txns.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function buildDemoDataRaw(now: Date = new Date()): DemoData {
  const seed = createSeed(now);
  const fx_rates = buildFxRates(seed);
  const categories = buildCategories(seed);

  generateStreams(seed);
  generateSpending(seed);
  generateOneOffs(seed);
  generateTrips(seed);
  generateRecentActivity(seed);
  generateSavingsAndRetirement(seed);
  generateBankExtras(seed);
  generateLoanPrincipal(seed);
  generateCardBills(seed); // needs every card charge
  generateWise(seed); // needs every other shekel row
  generateFidelityLumps(seed); // needs every other dollar row
  sortTxns(seed);

  const snapshots = buildSnapshots(seed);
  const transaction_events = buildEvents(seed);
  const { goals, links } = buildGoals(seed, snapshots.rows);
  const y = seed.now.getFullYear();

  return {
    spaces: [{ id: DEMO_SPACE_ID, name: "Maya & Tom", primary_currency: "ILS", created_at: seed.startIso }],
    space_members: [
      { space_id: DEMO_SPACE_ID, user_id: DEMO_USER_ID, role: "owner", display_name: "Maya", created_at: seed.startIso, birthday: "1991-06-14", retirement_year: 2058, life_expectancy: 90 },
      { space_id: DEMO_SPACE_ID, user_id: DEMO_PARTNER_ID, role: "owner", display_name: "Tom", created_at: seed.startIso, birthday: "1989-02-03", retirement_year: 2058, life_expectancy: 90 },
    ],
    connections: buildConnections(seed),
    accounts: ACCOUNT_DEFS.map((def) => account(seed, def.key)),
    account_balance_snapshots: snapshots.rows,
    categories,
    category_aliases: [
      ...RISEUP_ALIASES.map(([source_name, name]) => ({ space_id: DEMO_SPACE_ID, source: "riseup", source_name, category_id: categoryId(name) })),
      ...PLAID_ALIASES.map(([source_name, name]) => ({ space_id: DEMO_SPACE_ID, source: "plaid", source_name, category_id: categoryId(name) })),
    ],
    category_rules: MERCHANT_RULES.map(([merchant, name]) => ({
      id: uuidFromKey(`rule:${merchant}`),
      space_id: DEMO_SPACE_ID,
      match_type: "merchant",
      match_value: merchant,
      category_id: categoryId(name),
      created_at: seed.startIso,
      match_amount: null,
    })),
    transactions: seed.txns,
    transaction_events,
    budgets: buildBudgets(seed),
    recurring_streams: buildStreamRows(seed),
    goals,
    goal_accounts: links,
    holdings: buildHoldings(seed),
    pension_configs: buildPensionConfigs(seed, snapshots.paths),
    forecast_settings: [
      {
        space_id: DEMO_SPACE_ID,
        inflation_pct: 3,
        return_pct: 7,
        use_actual_expenses: true,
        expenses_override: {},
        created_at: seed.startIso,
        updated_at: new Date(seed.now.getTime() - 5 * 86400_000).toISOString(),
        future_values: "today",
        split_enabled: false,
        withdrawal_order: null,
      },
    ],
    forecast_incomes: [
      { id: uuidFromKey("income:maya"), space_id: DEMO_SPACE_ID, member_user_id: DEMO_USER_ID, name: "Maya - Lumio Tech", icon: "💼", yearly_amount: 450000, currency: "ILS", stops_at_retirement: true, created_at: seed.startIso, excluded: false },
      { id: uuidFromKey("income:tom"), space_id: DEMO_SPACE_ID, member_user_id: DEMO_PARTNER_ID, name: "Tom - Northwind Labs", icon: "🧑‍💻", yearly_amount: 115200, currency: "USD", stops_at_retirement: true, created_at: seed.startIso, excluded: false },
    ],
    forecast_events: [
      { id: uuidFromKey("forecast-event:japan"), space_id: DEMO_SPACE_ID, name: "Japan trip", icon: "🗾", kind: "one_time", affects: "expense", year: y + 1, end_year: null, amount: 6000, currency: "USD", created_at: seed.startIso },
      { id: uuidFromKey("forecast-event:car"), space_id: DEMO_SPACE_ID, name: "New car", icon: "🚗", kind: "one_time", affects: "expense", year: y + 3, end_year: null, amount: 120000, currency: "ILS", created_at: seed.startIso },
      { id: uuidFromKey("forecast-event:apartment"), space_id: DEMO_SPACE_ID, name: "Apartment down payment", icon: "🏠", kind: "one_time", affects: "expense", year: y + 5, end_year: null, amount: 160000, currency: "USD", created_at: seed.startIso },
    ],
    forecast_splits: [],
    fx_rates,
  };
}

/** The auth user ids behind the two household members, when the deployment's differ from the fixed ones. */
export interface DemoMemberIds {
  userId?: string;
  partnerId?: string;
}

function remapIds<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = remapIds(v, map);
    return out as T;
  }
  return value;
}

/**
 * The whole household, deterministic for a given `now`. Pass the real auth
 * user ids to point memberships, account owners and incomes at them; the
 * fixed DEMO_USER_ID / DEMO_PARTNER_ID are used otherwise.
 */
export function buildDemoData(now: Date = new Date(), ids: DemoMemberIds = {}): DemoData {
  const data = buildDemoDataRaw(now);
  const map = new Map<string, string>();
  if (ids.userId && ids.userId !== DEMO_USER_ID) map.set(DEMO_USER_ID, ids.userId);
  if (ids.partnerId && ids.partnerId !== DEMO_PARTNER_ID) map.set(DEMO_PARTNER_ID, ids.partnerId);
  return map.size ? remapIds(data, map) : data;
}
