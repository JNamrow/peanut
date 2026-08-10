import type { Cadence, RecurringStream, Transaction } from "@/lib/types";

export type { Cadence } from "@/lib/types";

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  every_4_weeks: "Every 4 weeks",
  twice_monthly_1_15: "Twice a month (1st & 15th)",
  twice_monthly_15_eom: "Twice a month (15th & last day)",
  monthly: "Every month",
  every_2_months: "Every 2 months",
  quarterly: "Every 3 months",
  semiyearly: "Every 6 months",
  yearly: "Every year",
};

export interface MonthOccurrence {
  streamId: string;
  name: string;
  cadence: Cadence;
  date: string; // expected or actual YYYY-MM-DD
  accountId: string | null;
  amount: number; // positive magnitude
  currency: string;
  kind: "expense" | "income";
  categoryId: string | null; // paid = the txn's category, else the stream's
  logoDomain: string | null;
  paid: boolean;
  txnId: string | null;
  daysUntil: number; // negative = overdue/past
}

export interface RecurringMonth {
  upcoming: MonthOccurrence[];
  paid: MonthOccurrence[];
  totals: Record<
    string,
    { incomePaid: number; incomeTotal: number; expensePaid: number; expenseTotal: number }
  >; // per currency
}

const DAY_MS = 86400000;

const DAY_STEP: Partial<Record<Cadence, number>> = {
  weekly: 7,
  biweekly: 14,
  every_4_weeks: 28,
};

const MONTH_INTERVAL: Partial<Record<Cadence, number>> = {
  monthly: 1,
  every_2_months: 2,
  quarterly: 3,
  semiyearly: 6,
  yearly: 12,
};

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Expected dates inside YYYY-MM for a cadence anchored at `anchor` (never before the anchor). */
export function occurrencesInMonth(cadence: Cadence, anchor: string, month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const step = DAY_STEP[cadence];
  if (step) {
    const anchorMs = Date.parse(`${anchor}T00:00:00Z`);
    if (Number.isNaN(anchorMs)) return [];
    const startMs = Date.UTC(y, m - 1, 1);
    const endMs = Date.UTC(y, m - 1, daysInMonth);
    const stepMs = step * DAY_MS;
    const out: string[] = [];
    for (
      let n = Math.max(0, Math.ceil((startMs - anchorMs) / stepMs));
      anchorMs + n * stepMs <= endMs;
      n++
    ) {
      out.push(new Date(anchorMs + n * stepMs).toISOString().slice(0, 10));
    }
    return out;
  }

  if (cadence === "twice_monthly_1_15") {
    return [ymd(y, m, 1), ymd(y, m, 15)].filter((d) => d >= anchor);
  }
  if (cadence === "twice_monthly_15_eom") {
    return [ymd(y, m, 15), ymd(y, m, daysInMonth)].filter((d) => d >= anchor);
  }

  const interval = MONTH_INTERVAL[cadence] ?? 1;
  const [ay, am, ad] = anchor.split("-").map(Number);
  if (!ay || !am) return [];
  const diff = (y - ay) * 12 + (m - am);
  if (diff < 0 || diff % interval !== 0) return [];
  return [ymd(y, m, Math.min(ad || 1, daysInMonth))];
}

function anchorFor(s: RecurringStream, todayYmd: string): string {
  return s.start_date ?? s.next_expected_date ?? s.created_at?.slice(0, 10) ?? todayYmd;
}

export function buildRecurringMonth(
  streams: RecurringStream[],
  monthTxns: Transaction[],
  month: string,
  todayYmd: string,
): RecurringMonth {
  const relevant = streams.filter((s) => s.status === "active" || s.status === "ended");
  const byId = new Map(relevant.map((s) => [s.id, s]));

  // Assign each txn to at most one stream: an explicit link wins; otherwise
  // merchant + currency + sign. Explicitly linked txns are never stolen.
  const matched = new Map<string, Transaction[]>();
  for (const t of monthTxns) {
    let s: RecurringStream | undefined;
    if (t.recurring_stream_id) {
      s = byId.get(t.recurring_stream_id);
    } else {
      s = relevant.find(
        (st) =>
          st.merchant_name === t.name &&
          st.currency === t.currency &&
          (st.kind === "income" ? Number(t.amount) > 0 : Number(t.amount) < 0),
      );
    }
    if (!s) continue;
    const arr = matched.get(s.id) ?? [];
    arr.push(t);
    matched.set(s.id, arr);
  }

  const upcoming: MonthOccurrence[] = [];
  const paid: MonthOccurrence[] = [];

  for (const s of relevant) {
    const expected =
      s.status === "active" ? occurrencesInMonth(s.cadence, anchorFor(s, todayYmd), month) : [];
    const txns = [...(matched.get(s.id) ?? [])].sort((a, b) => a.date.localeCompare(b.date));

    // Greedy nearest-date pairing: closest expected/txn pairs consume each other.
    const pairs: { e: number; t: number; gap: number }[] = [];
    for (let e = 0; e < expected.length; e++) {
      for (let t = 0; t < txns.length; t++) {
        pairs.push({ e, t, gap: Math.abs(daysBetween(expected[e], txns[t].date)) });
      }
    }
    pairs.sort((a, b) => a.gap - b.gap);
    const usedE = new Set<number>();
    const usedT = new Set<number>();
    for (const p of pairs) {
      if (usedE.has(p.e) || usedT.has(p.t)) continue;
      usedE.add(p.e);
      usedT.add(p.t);
    }

    const base = {
      streamId: s.id,
      name: s.merchant_name,
      cadence: s.cadence,
      accountId: s.account_id,
      currency: s.currency,
      kind: s.kind,
      categoryId: s.category_id,
      logoDomain: s.logo_domain,
    };
    for (const t of txns) {
      paid.push({
        ...base,
        date: t.date,
        amount: Math.abs(Number(t.amount)),
        categoryId: t.category_id ?? s.category_id,
        paid: true,
        txnId: t.id,
        daysUntil: daysBetween(todayYmd, t.date),
      });
    }
    expected.forEach((date, e) => {
      if (usedE.has(e)) return;
      upcoming.push({
        ...base,
        date,
        amount: Math.abs(Number(s.typical_amount ?? 0)),
        paid: false,
        txnId: null,
        daysUntil: daysBetween(todayYmd, date),
      });
    });
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  paid.sort((a, b) => b.date.localeCompare(a.date));

  const totals: RecurringMonth["totals"] = {};
  const bucket = (ccy: string) =>
    (totals[ccy] ??= { incomePaid: 0, incomeTotal: 0, expensePaid: 0, expenseTotal: 0 });
  for (const o of paid) {
    const b = bucket(o.currency);
    if (o.kind === "income") {
      b.incomePaid += o.amount;
      b.incomeTotal += o.amount;
    } else {
      b.expensePaid += o.amount;
      b.expenseTotal += o.amount;
    }
  }
  for (const o of upcoming) {
    const b = bucket(o.currency);
    if (o.kind === "income") b.incomeTotal += o.amount;
    else b.expenseTotal += o.amount;
  }

  return { upcoming, paid, totals };
}
