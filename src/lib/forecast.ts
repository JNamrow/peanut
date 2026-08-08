// Deterministic yearly net-worth projection, per currency (never mixed).
// Model: net(y+1) = net(y) + income − expenses(inflated) + growth on the
// invested share + events. Incomes tied to a member stop at that member's
// retirement year.

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

export interface ForecastInputs {
  currencies: string[];
  startNet: Record<string, number>; // per currency, forecast accounts only
  investedShare: Record<string, number>; // 0..1 per currency
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

export interface ForecastResult {
  byCurrency: Record<string, ForecastYearRow[]>;
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
  for (const ccy of inputs.currencies) {
    const rows: ForecastYearRow[] = [];
    let net = inputs.startNet[ccy] ?? 0;
    const share = Math.max(0, Math.min(1, inputs.investedShare[ccy] ?? 0));
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

      const growth = net > 0 ? net * share * (inputs.returnPct / 100) : 0;
      const savings = income - expenses;
      net = net + savings + growth;
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
  }
  return { byCurrency, retirementYear };
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
