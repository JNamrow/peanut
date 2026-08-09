// Deterministic yearly net-worth projection, per currency (never mixed).
// Model: each account compounds at its own (possibly year-varying) rate.
// Positive net savings are routed to accounts via the ordered split rows
// ("amount" rows are Monarch's yearly direct contribution; "percent" rows
// take a share of the remaining pool); whatever is left piles up in an
// "Extra savings" bucket that compounds at inflation (so it keeps its real
// value). Negative years draw the bucket down
// and then withdraw from accounts in the configured order. All displayed
// numbers are deflated to today's money unless futureValues="nominal".

export interface ForecastMember {
  userId: string;
  name: string;
  birthYear: number | null;
  retirementYear: number | null;
  lifeExpectancy: number;
}

export interface ForecastIncome {
  id: string;
  name: string;
  icon: string | null;
  memberUserId: string | null;
  yearlyAmount: number;
  currency: string;
  stopsAtRetirement: boolean;
  excluded: boolean; // contributes 0 income but still shows in cashflow
}

export interface ForecastEvent {
  id: string;
  name: string;
  icon: string | null;
  kind: "one_time" | "yearly";
  affects: "expense" | "income";
  year: number;
  endYear: number | null;
  amount: number;
  currency: string;
}

export interface ForecastAccount {
  id: string;
  name: string;
  currency: string;
  balance: number; // signed: liabilities negative
  ratePct: number; // base fixed yearly %
  ratePoints: { year: number; rate: number }[] | null; // variable mode; overrides ratePct
  group: string;
  isLiability: boolean;
}

export interface ForecastSplit {
  accountId: string;
  mode: "percent" | "amount";
  value: number; // percent of remaining pool, or yearly amount in today's money
}

export interface ForecastInputs {
  currencies: string[];
  accounts: ForecastAccount[]; // forecast-included accounts only
  baseExpenses: Record<string, number>; // yearly, per currency
  incomes: ForecastIncome[];
  events: ForecastEvent[];
  members: ForecastMember[];
  inflationPct: number;
  returnPct: number;
  startYear: number;
  endYear: number;
  futureValues: "today" | "nominal";
  splitEnabled: boolean;
  splits: ForecastSplit[]; // in position order
  withdrawalOrder: string[]; // account ids; empty = Cash, Investments, Pensions
}

export interface ForecastYearRow {
  year: number;
  netWorth: number;
  income: number;
  expenses: number;
  savings: number;
  events: ForecastEvent[];
}

export interface ForecastAccountRow {
  id: string | null; // null = the Extra savings bucket
  name: string;
  group: string; // "Cash" | "Investments" | "Pensions" | "Credit Cards" | "Loans" | "Other Assets" | "Other Liabilities" | "Extra"
  isLiability: boolean;
  ratePct: number; // effective first-year growth rate (for the badge)
  series: number[]; // end-of-year balance per year, display units
  // Per year, display units; start+inflation+growth+contribution === series value (rounding aside).
  breakdown: { start: number; inflation: number; growth: number; contribution: number }[];
}

// One Cash Flow tab tree row: an income source, an event, or the base
// "Living expenses" row (id null). Series values are display units per year.
export interface ForecastSeriesRow {
  id: string | null;
  name: string;
  icon: string | null;
  series: number[];
}

export interface ForecastResult {
  byCurrency: Record<string, ForecastYearRow[]>;
  accountRows: Record<string, ForecastAccountRow[]>; // per currency
  cashflow: Record<
    string,
    { incomeSources: ForecastSeriesRow[]; expenseRows: ForecastSeriesRow[]; net: number[] }
  >; // per currency
  retirementYear: number | null; // earliest member retirement
}

export function computeForecast(inputs: ForecastInputs): ForecastResult {
  const memberById = new Map(inputs.members.map((m) => [m.userId, m]));
  const retirementYears = inputs.members
    .map((m) => m.retirementYear)
    .filter((y): y is number => y != null);
  const retirementYear = retirementYears.length
    ? Math.min(...retirementYears)
    : null;

  const byCurrency: Record<string, ForecastYearRow[]> = {};
  const accountRows: Record<string, ForecastAccountRow[]> = {};
  const cashflow: ForecastResult["cashflow"] = {};
  for (const ccy of inputs.currencies) {
    const rows: ForecastYearRow[] = [];
    const accs = inputs.accounts.filter((a) => a.currency === ccy);
    const ccyIncomes = inputs.incomes.filter((s) => s.currency === ccy);
    const ccyEvents = inputs.events.filter((e) => e.currency === ccy);
    const incomeSeries: number[][] = ccyIncomes.map(() => []);
    const eventSeries: number[][] = ccyEvents.map(() => []);
    const livingSeries: number[] = [];
    const netSeries: number[] = [];
    const idxById = new Map(accs.map((a, i) => [a.id, i]));

    const sortedPoints = accs.map((a) =>
      a.ratePoints && a.ratePoints.length
        ? [...a.ratePoints].sort((x, y) => x.year - y.year)
        : null,
    );
    // Rate of the last point with point.year <= year; the first point's
    // rate for earlier years; else the base fixed rate.
    const rateFor = (i: number, year: number): number => {
      const pts = sortedPoints[i];
      if (!pts) return accs[i].ratePct;
      let rate = pts[0].rate;
      for (const p of pts) {
        if (p.year > year) break;
        rate = p.rate;
      }
      return rate;
    };

    const ccySplits = inputs.splits.filter((s) => idxById.has(s.accountId));
    const withdrawalIdx: number[] = inputs.withdrawalOrder.length
      ? inputs.withdrawalOrder
          .map((id) => idxById.get(id))
          .filter((i): i is number => i != null)
      : ["Cash", "Investments", "Pensions"].flatMap((g) =>
          accs.map((a, i) => (a.group === g ? i : -1)).filter((i) => i >= 0),
        );

    const balances = accs.map((a) => a.balance);
    const series: number[][] = accs.map(() => []);
    const breakdowns = accs.map(
      () =>
        [] as { start: number; inflation: number; growth: number; contribution: number }[],
    );
    // Unrounded display value at year start, per account (initially the balance).
    const prevDisp = accs.map((a) => a.balance);
    const extraSeries: number[] = [];
    const extraBreakdown: typeof breakdowns[number] = [];
    let prevExtraDisp = 0;
    let extra = 0; // savings not directed at any account; compounds at inflation

    for (let year = inputs.startYear; year <= inputs.endYear; year++) {
      const yearsOut = year - inputs.startYear;
      const inflate = Math.pow(1 + inputs.inflationPct / 100, yearsOut);
      const deflator = inputs.futureValues === "today" ? inflate : 1;

      let income = 0;
      for (let si = 0; si < ccyIncomes.length; si++) {
        const src = ccyIncomes[si];
        let amt = 0;
        if (!src.excluded) {
          let active = true;
          if (src.stopsAtRetirement && src.memberUserId) {
            const m = memberById.get(src.memberUserId);
            if (m?.retirementYear != null && year > m.retirementYear) active = false;
          }
          if (active) amt = src.yearlyAmount * inflate;
        }
        income += amt;
        incomeSeries[si].push(Math.round(amt / deflator));
      }

      const baseExpense = (inputs.baseExpenses[ccy] ?? 0) * inflate;
      let expenses = baseExpense;
      livingSeries.push(Math.round(baseExpense / deflator));

      const yearEvents: ForecastEvent[] = [];
      for (let ei = 0; ei < ccyEvents.length; ei++) {
        const ev = ccyEvents[ei];
        const active =
          ev.kind === "one_time"
            ? ev.year === year
            : ev.year <= year && (ev.endYear == null || year <= ev.endYear);
        const amt = active ? ev.amount : 0;
        if (active && ev.year === year) yearEvents.push(ev);
        if (ev.affects === "income") income += amt;
        else expenses += amt;
        eventSeries[ei].push(Math.round(amt / deflator));
      }

      const growthNom = accs.map((_, i) => balances[i] * (rateFor(i, year) / 100));
      for (let i = 0; i < accs.length; i++) balances[i] += growthNom[i];
      const contribNom = accs.map(() => 0);

      const savings = income - expenses;
      netSeries.push(Math.round(savings / deflator));
      const extraStart = extra;
      // Extra compounds nominally at inflation, so its real value holds
      // (in today's-money display its growth and inflation rows offset).
      const extraGrowthNom = extra * (inputs.inflationPct / 100);
      extra += extraGrowthNom;
      if (savings > 0 && inputs.splitEnabled) {
        let pool = savings;
        for (const s of ccySplits) {
          if (pool <= 0) break;
          const i = idxById.get(s.accountId)!;
          // "percent" takes its share of the REMAINING pool (Monarch "of remainder").
          const want = s.mode === "amount" ? s.value * inflate : pool * (s.value / 100);
          const take = Math.min(want, pool);
          if (take <= 0) continue;
          balances[i] += take;
          contribNom[i] += take;
          pool -= take;
        }
        extra += pool;
      } else {
        extra += savings;
      }

      if (extra < 0) {
        let deficit = -extra;
        for (const i of withdrawalIdx) {
          if (deficit <= 0) break;
          if (accs[i].isLiability || balances[i] <= 0) continue;
          const take = Math.min(balances[i], deficit);
          balances[i] -= take;
          contribNom[i] -= take; // withdrawals show as negative contribution
          deficit -= take;
        }
        extra = -deficit; // whatever could not be covered stays negative
      }

      let net = extra;
      for (let i = 0; i < accs.length; i++) {
        net += balances[i];
        const endDisp = balances[i] / deflator;
        const growthDisp = growthNom[i] / deflator;
        const contribDisp = contribNom[i] / deflator;
        series[i].push(Math.round(endDisp));
        breakdowns[i].push({
          start: Math.round(prevDisp[i]),
          // Derived so the identity holds; 0 in nominal mode and the first year.
          inflation: Math.round(endDisp - prevDisp[i] - growthDisp - contribDisp),
          growth: Math.round(growthDisp),
          contribution: Math.round(contribDisp),
        });
        prevDisp[i] = endDisp;
      }

      const extraEndDisp = extra / deflator;
      const extraGrowthDisp = extraGrowthNom / deflator;
      const extraContribDisp = (extra - extraStart - extraGrowthNom) / deflator;
      extraSeries.push(Math.round(extraEndDisp));
      extraBreakdown.push({
        start: Math.round(prevExtraDisp),
        inflation: Math.round(
          extraEndDisp - prevExtraDisp - extraGrowthDisp - extraContribDisp,
        ),
        growth: Math.round(extraGrowthDisp),
        contribution: Math.round(extraContribDisp),
      });
      prevExtraDisp = extraEndDisp;

      rows.push({
        year,
        netWorth: Math.round(net / deflator),
        income: Math.round(income / deflator),
        expenses: Math.round(expenses / deflator),
        savings: Math.round(savings / deflator),
        events: yearEvents,
      });
    }

    byCurrency[ccy] = rows;
    accountRows[ccy] = [
      ...accs.map((a, i) => ({
        id: a.id,
        name: a.name,
        group: a.group,
        isLiability: a.isLiability,
        ratePct: rateFor(i, inputs.startYear),
        series: series[i],
        breakdown: breakdowns[i],
      })),
      {
        id: null,
        name: "Extra savings",
        group: "Extra",
        isLiability: false,
        ratePct: inputs.inflationPct,
        series: extraSeries,
        breakdown: extraBreakdown,
      },
    ];
    const eventRow = (ev: ForecastEvent, i: number): ForecastSeriesRow => ({
      id: ev.id,
      name: ev.name,
      icon: ev.icon,
      series: eventSeries[i],
    });
    cashflow[ccy] = {
      incomeSources: [
        ...ccyIncomes.map((s, i) => ({
          id: s.id,
          name: s.name,
          icon: s.icon,
          series: incomeSeries[i],
        })),
        ...ccyEvents
          .map(eventRow)
          .filter((_, i) => ccyEvents[i].affects === "income"),
      ],
      expenseRows: [
        { id: null, name: "Living expenses", icon: null, series: livingSeries },
        ...ccyEvents
          .map(eventRow)
          .filter((_, i) => ccyEvents[i].affects === "expense"),
      ],
      net: netSeries,
    };
  }
  return { byCurrency, accountRows, cashflow, retirementYear };
}

export function yearOf(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const y = Number(dateStr.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export const EVENT_TEMPLATES: {
  key: string;
  name: string;
  icon: string;
  affects: "expense" | "income";
  kind: "one_time" | "yearly";
  sub: string;
}[] = [
  { key: "income", name: "Income", icon: "📈", affects: "income", kind: "one_time", sub: "Inheritance, bonus, stock sales" },
  { key: "expense", name: "Expense", icon: "💳", affects: "expense", kind: "one_time", sub: "Buy a car, home repairs, one-time costs" },
  { key: "buy_home", name: "Buy a home", icon: "🏠", affects: "expense", kind: "one_time", sub: "Down payment and purchase costs" },
  { key: "new_job", name: "New job", icon: "💼", affects: "income", kind: "yearly", sub: "Yearly income change from a new position" },
  { key: "have_kid", name: "Have a kid", icon: "👶", affects: "expense", kind: "yearly", sub: "Added yearly costs of raising children" },
  { key: "career_break", name: "Career break", icon: "🏖️", affects: "income", kind: "yearly", sub: "Reduced income for a period (use negative)" },
  { key: "custom", name: "Custom", icon: "✏️", affects: "expense", kind: "one_time", sub: "Anything else" },
];
