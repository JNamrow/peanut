/**
 * Financy (Open Finance AI) → Peanut mapping.
 *
 * Pure functions with no I/O, so they can be unit-tested without a server
 * runtime. The HTTP client and the database work live in ./financy.ts.
 *
 * Financy API docs: https://docs-financy.open-finance.ai
 */

export interface FinancyAmount {
  amount: number;
  currency?: string | null;
}

/** Financy documents two shapes for a balance entry; both are accepted. */
export interface FinancyBalance {
  balanceType?: string | null; // closingBooked | expected | interimAvailable | …
  balanceAmount?: FinancyAmount | null;
  amount?: number | null;
  currency?: string | null;
  creditLimitIncluded?: boolean | null;
  referenceDate?: string | null;
}

export interface FinancyAccount {
  id: string;
  connectionId?: string | null;
  providerId?: string | null; // hapoalim | leumi | max | isracard | …
  accountType?: string | null; // CHECKING | CARD | LOAN | SAVINGS | SECURITY | SECURITIES
  accountName?: string | null;
  accountNumber?: string | null;
  parsedAccount?: {
    bank?: string | null;
    branch?: string | null;
    number?: string | null;
  } | null;
  currency?: string | null;
  balances?: FinancyBalance[] | null;
  creditLimit?: number | null;
  cardDueDate?: string | null;
  status?: string | null;
}

export interface FinancyTransaction {
  id: string;
  SK?: string | null;
  accountId: string;
  connectionId?: string | null;
  providerId?: string | null;
  type?: string | null; // NORMAL | INSTALLMENT
  status?: string | null;
  amount?: {
    chargedAmount?: FinancyAmount | null;
    originalAmount?: FinancyAmount | null;
  } | null;
  description?: {
    description?: string | null;
    additionalInfo?: string | null;
  } | null;
  merchantName?: string | null;
  creditorName?: string | null;
  debtorName?: string | null;
  category?: {
    main?: string | null;
    sub?: string | null;
    categorizedBy?: string | null;
  } | null;
  changedCategory?: { main?: string | null; sub?: string | null } | null;
  installments?: { number?: number | null; total?: number | null } | null;
  date?: {
    transactionDate?: string | null;
    bookingDate?: string | null;
    valueDate?: string | null;
  } | null;
  balancePerEndDay?: number | null;
  isDuplicate?: boolean | null;
}

/** One bank the user linked inside the Financy app. */
export interface FinancyConnection {
  id: string;
  providerId?: string | null;
  status?: string | null;
  expiryDate?: string | null;
  lastFetchedAt?: string | null;
  lastFetchedDataDate?: string | null;
  connectionOwnerName?: string | null;
  accounts?: number | null;
  cards?: number | null;
  savings?: number | null;
  loans?: number | null;
  securities?: number | null;
  error?: { message?: string | null; type?: string | null } | null;
}

/** Statuses under which Financy serves the connection's data. */
export const READABLE_STATUSES = new Set(["CONNECTED", "ACTIVE", "COMPLETED"]);

/** Consent is gone: only the user can fix it, inside the Financy app. */
export const RECONNECT_STATUSES = new Set([
  "EXPIRED",
  "REVOKED",
  "TERMINATED_BY_USER",
  "SUSPENDED_BY_PROVIDER",
  "REJECTED",
  "CREDENTIALS_ERROR",
]);

const INSTITUTIONS: Record<string, string> = {
  hapoalim: "Bank Hapoalim",
  leumi: "Bank Leumi",
  discount: "Bank Discount",
  mizrahi: "Bank Mizrahi",
  beinleumi: "Bank Beinleumi",
  yahav: "Bank Yahav",
  mercantile: "Mercantile Discount",
  otsarHahayal: "Otsar Hahayal",
  pagi: "Bank Pagi",
  ubank: "U-Bank",
  masad: "Bank Masad",
  isracard: "Isracard",
  max: "Max",
  cal: "Visa Cal",
  americanExpress: "American Express",
  pepper: "Pepper",
  bit: "Bit",
  menora: "Menora",
};

export function prettyFinancyInstitution(
  providerId: string | null | undefined,
): string {
  if (!providerId) return "Financy";
  const base = providerId.replace(/-sandbox$/, "");
  const name =
    INSTITUTIONS[base] ?? base.charAt(0).toUpperCase() + base.slice(1);
  return providerId.endsWith("-sandbox") ? `${name} (sandbox)` : name;
}

export type PeanutAccountType =
  | "checking"
  | "savings"
  | "credit"
  | "loan"
  | "investment"
  | "other_asset";

export function mapFinancyAccountType(
  t: string | null | undefined,
): PeanutAccountType {
  switch ((t ?? "").toUpperCase()) {
    case "CHECKING":
      return "checking";
    case "CARD":
      return "credit";
    case "SAVINGS":
      return "savings";
    case "LOAN":
      return "loan";
    case "SECURITY":
    case "SECURITIES":
      return "investment";
    default:
      return "other_asset";
  }
}

function entryAmount(b: FinancyBalance): number | null {
  const v = b.balanceAmount?.amount ?? b.amount;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The balance Peanut shows. Liabilities are stored negative (money owed),
 * the way RiseUp card balances and manual loans are already kept.
 */
export function pickFinancyBalance(account: FinancyAccount): {
  current: number | null;
  available: number | null;
} {
  const list = account.balances ?? [];
  const byType = (t: string) =>
    list.find((b) => (b.balanceType ?? "").toLowerCase() === t.toLowerCase());
  const primary =
    byType("closingBooked") ??
    byType("expected") ??
    byType("interimBooked") ??
    list[0];
  let current = primary ? entryAmount(primary) : null;
  const type = mapFinancyAccountType(account.accountType);
  if (current != null && (type === "credit" || type === "loan")) {
    current = -Math.abs(current);
  }
  const avail = byType("interimAvailable") ?? byType("forwardAvailable");
  const available = avail ? entryAmount(avail) : null;
  return {
    current: current == null ? null : round2(current),
    available: available == null ? null : round2(available),
  };
}

/** Last four digits of the account or card number, when Financy sends one. */
export function financyMask(account: FinancyAccount): string | null {
  const raw = account.parsedAccount?.number ?? account.accountNumber ?? "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function financyAccountName(account: FinancyAccount): string {
  if (account.accountName?.trim()) return account.accountName.trim();
  const inst = prettyFinancyInstitution(account.providerId);
  const label: Record<PeanutAccountType, string> = {
    checking: "Checking",
    savings: "Savings",
    credit: "Card",
    loan: "Loan",
    investment: "Securities",
    other_asset: "Account",
  };
  return `${inst} ${label[mapFinancyAccountType(account.accountType)]}`;
}

export function financyTxnDate(t: FinancyTransaction): string | null {
  const d =
    t.date?.transactionDate ?? t.date?.bookingDate ?? t.date?.valueDate;
  return d ? d.slice(0, 10) : null;
}

/** Financy: negative = money out, which is Peanut's convention too. */
export function financyTxnAmount(
  t: FinancyTransaction,
  fallbackCurrency: string,
): { amount: number; currency: string } | null {
  const a = t.amount?.chargedAmount ?? t.amount?.originalAmount;
  if (!a || typeof a.amount !== "number" || !Number.isFinite(a.amount)) {
    return null;
  }
  const raw = (a.currency ?? fallbackCurrency).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(raw) ? raw : fallbackCurrency;
  return { amount: round2(a.amount), currency };
}

export function financyTxnName(t: FinancyTransaction): string {
  const n =
    t.merchantName?.trim() ||
    t.description?.description?.trim() ||
    t.creditorName?.trim() ||
    t.debtorName?.trim();
  return n || "Unknown";
}

/** "FOOD_&_DRINKS/GROCERIES". The user's own override inside Financy wins. */
export function financyCategoryKey(t: FinancyTransaction): string | null {
  const c = t.changedCategory?.main ? t.changedCategory : t.category;
  if (!c?.main) return null;
  return c.sub ? `${c.main}/${c.sub}` : c.main;
}

/** "FOOD_&_DRINKS/GROCERIES" → "Groceries"; "TRANSPORTATION" → "Transportation". */
export function prettyFinancyCategory(key: string): string {
  const leaf = key.split("/").pop() ?? key;
  return leaf
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => (w === "&" ? "&" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Best-effort bridge from Financy's two-level taxonomy to Peanut's seeded
 * Monarch-style categories, matched on the leaf name first, then the group.
 * Anything unmatched gets its own category on first sight and can be
 * re-pointed in Peanut afterwards, exactly like a RiseUp label.
 */
export const FINANCY_CATEGORY_MAP: Record<string, string> = {
  GROCERIES: "Groceries",
  SUPERMARKET: "Groceries",
  RESTAURANTS: "Restaurants & Bars",
  RESTAURANT: "Restaurants & Bars",
  BARS: "Restaurants & Bars",
  FAST_FOOD: "Restaurants & Bars",
  FOOD_DELIVERY: "Restaurants & Bars",
  COFFEE: "Coffee Shops",
  CAFE: "Coffee Shops",
  CAFES: "Coffee Shops",
  FUEL: "Gas",
  GAS: "Gas",
  GAS_STATION: "Gas",
  PARKING: "Parking & Tolls",
  TOLLS: "Parking & Tolls",
  TOLL_ROADS: "Parking & Tolls",
  PUBLIC_TRANSPORT: "Public Transit",
  PUBLIC_TRANSPORTATION: "Public Transit",
  TRAIN: "Public Transit",
  BUS: "Public Transit",
  TAXI: "Taxi & Ride Shares",
  RIDE_SHARING: "Taxi & Ride Shares",
  RIDESHARE: "Taxi & Ride Shares",
  CAR_MAINTENANCE: "Auto Maintenance",
  CAR_SERVICE: "Auto Maintenance",
  RENT: "Rent",
  MORTGAGE: "Mortgage",
  ARNONA: "Arnona",
  MUNICIPAL_TAX: "Arnona",
  PROPERTY_TAX: "Arnona",
  VAAD_BAYIT: "Va'ad Bayit",
  BUILDING_COMMITTEE: "Va'ad Bayit",
  HOME_IMPROVEMENT: "Home Improvement",
  HOME_REPAIR: "Home Improvement",
  WATER: "Water",
  ELECTRICITY: "Gas & Electric",
  ELECTRIC: "Gas & Electric",
  UTILITIES: "Gas & Electric",
  INTERNET: "Internet & Cable",
  TV: "Internet & Cable",
  CABLE: "Internet & Cable",
  PHONE: "Phone",
  MOBILE: "Phone",
  CELLULAR: "Phone",
  CLOTHING: "Clothing",
  FASHION: "Clothing",
  SHOES: "Clothing",
  ELECTRONICS: "Electronics",
  FURNITURE: "Furniture & Housewares",
  HOUSEWARES: "Furniture & Housewares",
  HOME_GOODS: "Furniture & Housewares",
  SHOPPING: "Shopping",
  ONLINE_SHOPPING: "Shopping",
  PHARMACY: "Medical",
  MEDICAL: "Medical",
  HEALTH: "Medical",
  DOCTOR: "Medical",
  KUPAT_CHOLIM: "Kupat Cholim",
  HMO: "Kupat Cholim",
  DENTIST: "Dentist",
  DENTAL: "Dentist",
  FITNESS: "Fitness",
  GYM: "Fitness",
  SPORT: "Fitness",
  CHILDCARE: "Child Care",
  CHILD_CARE: "Child Care",
  KINDERGARTEN: "Gan & School",
  SCHOOL: "Gan & School",
  EDUCATION: "Education",
  TUITION: "Education",
  KIDS_ACTIVITIES: "Child Activities",
  CHILDREN: "Child Activities",
  TRAVEL: "Travel & Vacation",
  HOTELS: "Travel & Vacation",
  HOTEL: "Travel & Vacation",
  FLIGHTS: "Travel & Vacation",
  AIRLINE: "Travel & Vacation",
  VACATION: "Travel & Vacation",
  ENTERTAINMENT: "Entertainment & Recreation",
  LEISURE: "Entertainment & Recreation",
  CINEMA: "Entertainment & Recreation",
  STREAMING: "Entertainment & Recreation",
  SUBSCRIPTIONS: "Entertainment & Recreation",
  PETS: "Pets",
  PET: "Pets",
  PERSONAL_CARE: "Personal",
  BEAUTY: "Personal",
  HAIR: "Personal",
  INSURANCE: "Insurance",
  TAXES: "Taxes",
  TAX: "Taxes",
  BANK_FEES: "Financial Fees",
  FEES: "Financial Fees",
  COMMISSION: "Financial Fees",
  ATM: "Cash & ATM",
  CASH: "Cash & ATM",
  CASH_WITHDRAWAL: "Cash & ATM",
  LOAN_REPAYMENT: "Loan Repayment",
  LOANS: "Loan Repayment",
  LOAN: "Loan Repayment",
  LEGAL: "Financial & Legal Services",
  ACCOUNTING: "Financial & Legal Services",
  DONATIONS: "Tzedakah & Charity",
  CHARITY: "Tzedakah & Charity",
  GIFTS: "Gifts",
  GIFT: "Gifts",
  SALARY: "Paychecks",
  PAYCHECK: "Paychecks",
  PAYROLL: "Paychecks",
  INTEREST: "Interest",
  DIVIDENDS: "Dividends & Capital Gains",
  DIVIDEND: "Dividends & Capital Gains",
  BUSINESS_INCOME: "Business Income",
  INCOME: "Other Income",
  REFUND: "Other Income",
  TRANSFER: "Transfer",
  TRANSFERS: "Transfer",
  CREDIT_CARD_PAYMENT: "Credit Card Payment",
  CARD_PAYMENT: "Credit Card Payment",
  INVESTMENT: "Buy",
  INVESTMENTS: "Buy",
  SECURITIES: "Buy",
};

function normalizeEnum(s: string | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Peanut category name for a Financy key, or null when nothing fits. */
export function financyCategoryName(key: string): string | null {
  const [main, sub] = key.split("/");
  return (
    FINANCY_CATEGORY_MAP[normalizeEnum(sub)] ??
    FINANCY_CATEGORY_MAP[normalizeEnum(main)] ??
    null
  );
}

/**
 * The sync window: 12 months on first sync, otherwise the last 45 days
 * (Israeli card billing lands weeks after the purchase).
 */
export function financyWindow(
  lastSyncedAt: string | null,
  backfillMonths?: number,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const from = new Date(now);
  if (backfillMonths != null) from.setMonth(from.getMonth() - backfillMonths);
  else if (lastSyncedAt) from.setDate(from.getDate() - 45);
  else from.setMonth(from.getMonth() - 12);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}
