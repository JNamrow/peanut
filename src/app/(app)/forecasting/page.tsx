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
} from "@/lib/forecast";
import { PageHeader } from "@/components/ui";
import { SetupWizard } from "./setup-wizard";
import { ForecastView } from "./forecast-ui";
import type { Transaction } from "@/lib/types";

export default async function ForecastingPage() {
  const ctx = await getContext();
  const { supabase, space, members } = ctx;
  const accounts = await getAccounts();
  const categories = await getCategories();

  const [{ data: settings }, { data: incomeRows }, { data: eventRows }, { data: txns }] =
    await Promise.all([
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

  // ---- build inputs. Each account grows at its own rate: an explicit
  // per-account override, else the return assumption for invested money.
  const returnPct = Number(settings.return_pct);
  const defaultGrowth = (type: string) =>
    type === "investment" || type === "pension" ? returnPct : 0;
  const fAccounts: ForecastAccount[] = included.map((a) => {
    const v = Number(a.current_balance ?? 0);
    return {
      id: a.id,
      name: a.name,
      currency: a.currency,
      balance: a.is_liability ? -Math.abs(v) : v,
      growthPct: a.forecast_growth_pct ?? defaultGrowth(a.type),
      yearlyContribution: Number(a.forecast_contribution ?? 0),
    };
  });

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
  });

  // Settings for the per-row account panel (gear on each account row).
  const accountSettings = accounts
    .filter((a) => !a.hidden && a.current_balance != null)
    .map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution_name,
      currency: a.currency,
      type: a.type,
      include: a.forecast_include,
      growthPct: a.forecast_growth_pct,
      defaultGrowthPct: defaultGrowth(a.type),
      contribution: Number(a.forecast_contribution ?? 0),
    }));

  return (
    <ForecastView
      result={result}
      currencies={currencies}
      members={fMembers}
      incomes={fIncomes}
      events={fEvents}
      accountSettings={accountSettings}
      settings={{
        inflationPct: Number(settings.inflation_pct),
        returnPct,
        useActualExpenses: settings.use_actual_expenses,
        expensesOverride: override,
      }}
      actualExpenses={actualExpenses}
    />
  );
}
