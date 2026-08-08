// Deterministic yearly net-worth projection, per currency (never mixed).
// Model: each account compounds at its own rate and receives its yearly
// direct contribution; net savings (income − expenses − contributions)
// pile up in a 0%-growth "Extra savings" bucket. Incomes tied to a member
// stop at that member's retirement year.

export interface ForecastMember {
  userId: string;
  name: string;
  birthYear: number | null;
  retirementYear: number | null;
}

export interface ForecastIncome {
  id: string;
  name: string;
  memberUserId: string | null;
  yearlyAmount: number;
  currency: string;
  stopsAtRetirement: boolean;
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
  growthPct: number; // effective yearly rate for THIS account
  yearlyContribution: number; // today's money; inflates each year
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
  series: number[]; // one balance per year, same order as the year rows
}

export interface ForecastResult {
  byCurrency: Record<string, ForecastYearRow[]>;
  accountRows: Record<string, ForecastAccountRow[]>; // per currency
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
  for (const ccy of inputs.currencies) {
    const rows: ForecastYearRow[] = [];
    const accs = inputs.accounts.filter((a) => a.currency === ccy);
    const balances = accs.map((a) => a.balance);
    const series: number[][] = accs.map(() => []);
    const extraSeries: number[] = [];
    let extra = 0; // savings not directed at any account; grows at 0%
    for (let year = inputs.startYear; year <= inputs.endYear; year++) {
      const yearsOut = year - inputs.startYear;
      const inflate = Math.pow(1 + inputs.inflationPct / 100, yearsOut);

      let income = 0;
      for (const src of inputs.incomes) {
        if (src.currency !== ccy) continue;
        if (src.stopsAtRetirement && src.memberUserId) {
          const m = memberById.get(src.memberUserId);
          if (m?.retirementYear != null && year > m.retirementYear) continue;
        }
        income += src.yearlyAmount * inflate;
      }

      let expenses = (inputs.baseExpenses[ccy] ?? 0) * inflate;

      const yearEvents: ForecastEvent[] = [];
      for (const ev of inputs.events) {
        if (ev.currency !== ccy) continue;
        const active =
          ev.kind === "one_time"
            ? ev.year === year
            : ev.year <= year && (ev.endYear == null || year <= ev.endYear);
        if (!active) continue;
        if (ev.year === year) yearEvents.push(ev);
        if (ev.affects === "income") income += ev.amount;
        else expenses += ev.amount;
      }

      let contributions = 0;
      let net = 0;
      for (let i = 0; i < accs.length; i++) {
        const contrib = accs[i].yearlyContribution * inflate;
        contributions += contrib;
        balances[i] = balances[i] * (1 + accs[i].growthPct / 100) + contrib;
        series[i].push(Math.round(balances[i]));
        net += balances[i];
      }
      const savings = income - expenses;
      extra += savings - contributions;
      extraSeries.push(Math.round(extra));
      net += extra;
      rows.push({
        year,
        netWorth: Math.round(net),
        income: Math.round(income),
        expenses: Math.round(expenses),
        savings: Math.round(savings),
        events: yearEvents,
      });
    }
    byCurrency[ccy] = rows;
    accountRows[ccy] = [
      ...accs.map((a, i) => ({ id: a.id, name: a.name, series: series[i] })),
      { id: null, name: "Extra savings", series: extraSeries },
    ];
  }
  return { byCurrency, accountRows, retirementYear };
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
