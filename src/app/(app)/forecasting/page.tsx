import { getAccounts, getCategories, getContext } from "@/lib/data";
import { computeCashflowPerCurrency } from "@/lib/multicurrency";
import { addMonths, monthStart } from "@/lib/format";
import {
  computeForecast,
  yearOf,
  type ForecastAccount,
  type ForecastEvent,
  type ForecastIncome,
  type ForecastMember,
  type ForecastSplit,
} from "@/lib/forecast";
import { PageHeader } from "@/components/ui";
import { SetupWizard } from "./setup-wizard";
import { ForecastView, type AccountSetting } from "./forecast-ui";
import type { Account, Transaction } from "@/lib/types";

const GROUP_BY_TYPE: Record<string, string> = {
  checking: "Cash",
  savings: "Cash",
  cash: "Cash",
  investment: "Investments",
  pension: "Pensions",
  credit: "Credit Cards",
  loan: "Loans",
  property: "Other Assets",
  vehicle: "Other Assets",
  other_asset: "Other Assets",
  other_liability: "Other Liabilities",
};

export default async function ForecastingPage() {
  const ctx = await getContext();
  const { supabase, space, members } = ctx;
  const accounts = await getAccounts();
  const categories = await getCategories();

  const [
    { data: settings },
    { data: incomeRows },
    { data: eventRows },
    { data: splitRows },
    { data: txns },
  ] = await Promise.all([
    supabase
      .from("forecast_settings")
      .select("*")
      .eq("space_id", space.id)
      .maybeSingle(),
    supabase.from("forecast_incomes").select("*").eq("space_id", space.id),
    supabase
      .from("forecast_events")
      .select("*")
      .eq("space_id", space.id)
      .order("year"),
    supabase
      .from("forecast_splits")
      .select("*")
      .eq("space_id", space.id)
      .order("position"),
    supabase
      .from("transactions")
      .select("*")
      .eq("space_id", space.id)
      .gte("date", addMonths(monthStart(), -12)),
  ]);

  // Last-12-months actuals per currency (income + expenses).
  const cf = computeCashflowPerCurrency((txns ?? []) as Transaction[], categories);
  const actualIncome: Record<string, number> = {};
  const actualExpenses: Record<string, number> = {};
  for (const [ccy, v] of cf) {
    actualIncome[ccy] = Math.round(v.income);
    actualExpenses[ccy] = Math.round(v.expense);
  }

  const included = accounts.filter(
    (a) => a.forecast_include && !a.hidden && a.current_balance != null,
  );
  const currencies = ["ILS", "USD"].filter((c) =>
    accounts.some((a) => a.currency === c && !a.hidden),
  );

  if (!settings) {
    return (
      <>
        <PageHeader title="Forecasting" />
        <SetupWizard
          members={members.map((m) => ({
            userId: m.user_id,
            name: m.display_name ?? "Member",
          }))}
          accounts={accounts
            .filter((a) => !a.hidden)
            .map((a) => ({
              id: a.id,
              name: a.name,
              institution: a.institution_name,
              currency: a.currency,
              balance: Number(a.current_balance ?? 0),
              type: a.type,
            }))}
          actualIncome={actualIncome}
          actualExpenses={actualExpenses}
        />
      </>
    );
  }

  // ---- build inputs. Each account grows at its own rate: explicit fixed or
  // variable points, "none" = 0, else the return assumption for invested money.
  const returnPct = Number(settings.return_pct);
  const defaultGrowth = (type: string) =>
    type === "investment" || type === "pension" ? returnPct : 0;
  const baseRate = (a: Account) =>
    a.forecast_growth_mode === "none"
      ? 0
      : a.forecast_growth_mode === "fixed"
        ? (a.forecast_growth_pct ?? defaultGrowth(a.type))
        : defaultGrowth(a.type);
  const fAccounts: ForecastAccount[] = included.map((a) => {
    const v = Number(a.current_balance ?? 0);
    return {
      id: a.id,
      name: a.name,
      currency: a.currency,
      balance: a.is_liability ? -Math.abs(v) : v,
      ratePct: baseRate(a),
      ratePoints:
        a.forecast_growth_mode === "variable"
          ? (a.forecast_growth_points ?? null)
          : null,
      group: GROUP_BY_TYPE[a.type] ?? "Other Assets",
      isLiability: a.is_liability,
    };
  });

  const includedIds = new Set(included.map((a) => a.id));
  const fSplits: ForecastSplit[] = (splitRows ?? [])
    .filter((r) => includedIds.has(r.account_id))
    .map((r) => ({
      accountId: r.account_id as string,
      mode: r.mode === "amount" ? ("amount" as const) : ("percent" as const),
      value: Number(r.value),
    }));

  const override = (settings.expenses_override ?? {}) as Record<string, number | null>;
  const baseExpenses: Record<string, number> = {};
  for (const c of currencies) {
    baseExpenses[c] = settings.use_actual_expenses
      ? (actualExpenses[c] ?? 0)
      : Number(override[c] ?? actualExpenses[c] ?? 0);
  }

  const fMembers: ForecastMember[] = members.map((m) => ({
    userId: m.user_id,
    name: m.display_name ?? "Member",
    birthYear: yearOf((m as { birthday?: string | null }).birthday ?? null),
    retirementYear:
      (m as { retirement_year?: number | null }).retirement_year ?? null,
  }));

  const fIncomes: ForecastIncome[] = (incomeRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    memberUserId: r.member_user_id,
    yearlyAmount: Number(r.yearly_amount),
    currency: r.currency,
    stopsAtRetirement: r.stops_at_retirement,
  }));

  const fEvents: ForecastEvent[] = (eventRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    kind: r.kind,
    affects: r.affects,
    year: r.year,
    endYear: r.end_year,
    amount: Number(r.amount),
    currency: r.currency,
  }));

  const now = new Date().getFullYear();
  const oldestBirth = Math.min(
    ...fMembers.map((m) => m.birthYear ?? now - 30),
  );
  const endYear = oldestBirth + 90;

  const futureValues: "today" | "nominal" =
    settings.future_values === "nominal" ? "nominal" : "today";
  const splitEnabled = !!settings.split_enabled;
  const withdrawalOrder = (settings.withdrawal_order ?? []) as string[];

  const result = computeForecast({
    currencies,
    accounts: fAccounts,
    baseExpenses,
    incomes: fIncomes,
    events: fEvents,
    members: fMembers,
    inflationPct: Number(settings.inflation_pct),
    returnPct,
    startYear: now,
    endYear,
    futureValues,
    splitEnabled,
    splits: fSplits,
    withdrawalOrder,
  });

  // Settings for the per-row account panel: all visible accounts (not only
  // forecast-included), split-row accounts first in position order.
  const splitByAccount = new Map(
    (splitRows ?? []).map((r, i) => [r.account_id as string, { ...r, pos: i }]),
  );
  const settingsAccounts = accounts.filter(
    (a) => !a.hidden && a.current_balance != null,
  );
  const orderedAccounts = [
    ...settingsAccounts
      .filter((a) => splitByAccount.has(a.id))
      .sort((a, b) => splitByAccount.get(a.id)!.pos - splitByAccount.get(b.id)!.pos),
    ...settingsAccounts.filter((a) => !splitByAccount.has(a.id)),
  ];
  const accountSettings: AccountSetting[] = orderedAccounts.map((a) => {
    const split = splitByAccount.get(a.id);
    return {
      id: a.id,
      name: a.name,
      institution: a.institution_name,
      currency: a.currency,
      type: a.type,
      include: a.forecast_include,
      growthMode: a.forecast_growth_mode ?? "default",
      growthPct: a.forecast_growth_pct,
      defaultGrowthPct: defaultGrowth(a.type),
      growthPoints: a.forecast_growth_points ?? [],
      splitMode: split ? (split.mode === "amount" ? "amount" : "percent") : null,
      splitValue: split ? Number(split.value) : 0,
    };
  });

  return (
    <ForecastView
      result={result}
      currencies={currencies}
      members={fMembers}
      incomes={fIncomes}
      events={fEvents}
      accountSettings={accountSettings}
      config={{ splitEnabled, withdrawalOrder, futureValues }}
      settings={{
        inflationPct: Number(settings.inflation_pct),
        returnPct,
        useActualExpenses: settings.use_actual_expenses,
        expensesOverride: override,
        futureValues,
      }}
      actualExpenses={actualExpenses}
    />
  );
}
