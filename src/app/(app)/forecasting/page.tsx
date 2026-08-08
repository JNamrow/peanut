import { getAccounts, getCategories, getContext } from "@/lib/data";
import { computeCashflowPerCurrency } from "@/lib/multicurrency";
import { addMonths, monthStart } from "@/lib/format";
import {
  computeForecast,
  yearOf,
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

  // ---- build inputs
  const startNet: Record<string, number> = {};
  const invested: Record<string, number> = {};
  for (const a of included) {
    const v = Number(a.current_balance ?? 0);
    const signed = a.is_liability ? -Math.abs(v) : v;
    startNet[a.currency] = (startNet[a.currency] ?? 0) + signed;
    if (a.type === "investment" || a.type === "pension") {
      invested[a.currency] = (invested[a.currency] ?? 0) + Math.max(0, v);
    }
  }
  const investedShare: Record<string, number> = {};
  for (const c of currencies) {
    const assets = included
      .filter((a) => a.currency === c && !a.is_liability)
      .reduce((s, a) => s + Number(a.current_balance ?? 0), 0);
    investedShare[c] = assets > 0 ? (invested[c] ?? 0) / assets : 0;
  }

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
    startNet,
    investedShare,
    baseExpenses,
    incomes: fIncomes,
    events: fEvents,
    members: fMembers,
    inflationPct: Number(settings.inflation_pct),
    returnPct: Number(settings.return_pct),
    startYear: now,
    endYear,
  });

  return (
    <ForecastView
      result={result}
      currencies={currencies}
      members={fMembers}
      incomes={fIncomes}
      events={fEvents}
      settings={{
        inflationPct: Number(settings.inflation_pct),
        returnPct: Number(settings.return_pct),
        useActualExpenses: settings.use_actual_expenses,
        expensesOverride: override,
      }}
      actualExpenses={actualExpenses}
    />
  );
}
