export type Currency = string; // ISO 4217, e.g. "USD" | "ILS"

export interface Space {
  id: string;
  name: string;
  primary_currency: Currency;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  role: "owner" | "member";
  display_name: string | null;
  birthday: string | null;
  retirement_year: number | null;
  life_expectancy: number;
}

export type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit"
  | "investment"
  | "pension"
  | "loan"
  | "property"
  | "vehicle"
  | "other_asset"
  | "other_liability";

export interface Account {
  id: string;
  space_id: string;
  connection_id: string | null;
  source: "plaid" | "riseup" | "manual";
  external_id: string | null;
  name: string;
  official_name: string | null;
  institution_name: string | null;
  type: AccountType;
  subtype: string | null;
  currency: Currency;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  linked_account_id: string | null;
  balance_anchor: number | null;
  balance_anchor_date: string | null;
  forecast_include: boolean;
  forecast_growth_pct: number | null;
  forecast_growth_mode: "fixed" | "none" | "variable" | null; // null = default by type
  forecast_growth_points: { year: number; rate: number }[] | null;
  forecast_contribution: number; // legacy; no longer read

  is_liability: boolean;
  include_in_net_worth: boolean;
  hidden: boolean;
  owner_user_id: string | null;
  display_order: number;
  closed_at: string | null;
  deleted_at: string | null;
}

export interface Connection {
  id: string;
  space_id: string;
  provider: "plaid" | "riseup" | "manual";
  label: string | null;
  institution_name: string | null;
  environment: string | null;
  external_item_id: string | null;
  status: "pending" | "active" | "error" | "disconnected";
  error: string | null;
  config: Record<string, unknown>;
  last_synced_at: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  space_id: string;
  group: string;
  name: string;
  name_he: string | null;
  icon: string | null;
  color: string | null;
  kind: "income" | "expense" | "transfer";
  budget_bucket: "fixed" | "flexible" | "non_monthly" | null;
  exclude_from_budget: boolean;
  display_order: number;
  is_system: boolean;
}

export interface Transaction {
  id: string;
  space_id: string;
  account_id: string;
  connection_id: string | null;
  source: "plaid" | "riseup" | "manual";
  external_id: string | null;
  date: string;
  name: string;
  original_name: string | null;
  amount: number; // signed, negative = outflow, native currency
  currency: Currency;
  category_id: string | null;
  categorized_by: "none" | "provider" | "rule" | "user";
  notes: string | null;
  tags: string[];
  attachments: string[];
  pending: boolean;
  payment_method: "card" | "transfer" | "bank" | null;
  is_transfer: boolean;
  hide_from_reports: boolean;
  recurring_stream_id: string | null;
}

export interface BalanceSnapshot {
  account_id: string;
  as_of_date: string;
  balance: number;
  currency: Currency;
}

export interface Budget {
  space_id: string;
  month: string; // YYYY-MM-01
  category_id: string;
  amount: number; // in space primary currency
  rollover: boolean;
}

// Inlined here (lib/recurring re-exports it) to avoid a circular import.
export type Cadence =
  | "weekly"
  | "biweekly"
  | "every_4_weeks"
  | "twice_monthly_1_15"
  | "twice_monthly_15_eom"
  | "monthly"
  | "every_2_months"
  | "quarterly"
  | "semiyearly"
  | "yearly";

export interface RecurringStream {
  id: string;
  space_id: string;
  merchant_name: string;
  account_id: string | null;
  cadence: Cadence;
  typical_amount: number | null;
  currency: Currency;
  next_expected_date: string | null;
  kind: "expense" | "income";
  status: "suggested" | "active" | "dismissed" | "ended";
  start_date: string | null;
  category_id: string | null;
  logo_domain: string | null;
  logo_url: string | null;
  created_at?: string;
}

export interface TransactionEvent {
  id: string;
  kind: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

export interface Holding {
  id: string;
  account_id: string;
  external_id: string | null;
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  cost_basis: number | null;
  currency: Currency;
  as_of: string;
}

export interface FxRate {
  rate_date: string;
  base: Currency;
  quote: Currency;
  rate: number;
}

export interface PensionConfig {
  account_id: string;
  provider: string | null;
  dataset: "gemelnet" | "pensianet";
  fund_id: number;
  annual_fee_pct: number;
  deposit_fee_pct: number;
  monthly_contribution: number;
  anchor_date: string | null;
  anchor_balance: number | null;
  last_applied_period: string | null;
}
