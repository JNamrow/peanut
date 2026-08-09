import { getAccounts, getCategories, getContext } from "@/lib/data";
import { computeCashflowPerCurrency, currencyOrder } from "@/lib/multicurrency";
import { fmtMoney, fmtPct, monthStart, addMonths, shortDate } from "@/lib/format";
import { Donut, DONUT_COLORS, TrendBars } from "@/components/charts";
import { CashflowSankey } from "@/components/sankey";
import { Card, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui";
import { DateFilterButton, FiltersButton, type ReportParams } from "./report-controls";
import type { Category, Transaction } from "@/lib/types";

const LEGACY_RANGE_MONTHS: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ccyLabel(ccy: string) {
  return ccy === "ILS" ? "₪ ILS" : ccy === "USD" ? "$ USD" : ccy;
}

function ccySym(ccy: string) {
  return ccy === "ILS" ? "₪" : ccy === "USD" ? "$" : ccy;
}

function buildQuery(p: ReportParams, omit?: string) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (k === omit || v == null || v === "") continue;
    sp.set(k, v);
  }
  return sp.toString();
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    range?: string;
    from?: string;
    to?: string;
    by?: string;
    cats?: string;
    merchants?: string;
    accounts?: string;
    amin?: string;
    amax?: string;
    chart?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab =
    sp.tab === "income" ? "income" : sp.tab === "spending" ? "spending" : "cashflow";
  const by =
    sp.by === "merchant" ? "merchant" : sp.by === "group" ? "group" : "category";

  let from = DATE_RE.test(sp.from ?? "") ? sp.from : undefined;
  const to = DATE_RE.test(sp.to ?? "") ? sp.to : undefined;
  if (!from && !to) {
    // Legacy range=Nm translates to a from bound; "all" stays unbounded.
    const months = LEGACY_RANGE_MONTHS[sp.range ?? ""];
    if (months) from = addMonths(monthStart(), -(months - 1));
    else if (sp.range !== "all") from = addMonths(monthStart(), -2);
  }

  const current: ReportParams = {
    tab,
    by,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(sp.cats ? { cats: sp.cats } : {}),
    ...(sp.merchants ? { merchants: sp.merchants } : {}),
    ...(sp.accounts ? { accounts: sp.accounts } : {}),
    ...(sp.amin ? { amin: sp.amin } : {}),
    ...(sp.amax ? { amax: sp.amax } : {}),
  };

  const { supabase, space } = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);

  let query = supabase.from("transactions").select("*").eq("space_id", space.id);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);
  const { data: txns } = await query;
  const periodList = (txns ?? []) as Transaction[];

  // ------------------------------------------- Apply filter params in JS
  const catSet = current.cats ? new Set(current.cats.split(",")) : null;
  const merchantSet = current.merchants
    ? new Set(
        current.merchants.split("~").map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        }),
      )
    : null;
  const accountSet = current.accounts ? new Set(current.accounts.split(",")) : null;
  const aminN = Number(current.amin);
  const amaxN = Number(current.amax);
  const hasMin = current.amin != null && Number.isFinite(aminN);
  const hasMax = current.amax != null && Number.isFinite(amaxN);

  const filtered = periodList.filter((t) => {
    if (catSet && !catSet.has(t.category_id ?? "un")) return false;
    if (merchantSet && !merchantSet.has(t.name)) return false;
    if (accountSet && !accountSet.has(t.account_id)) return false;
    const abs = Math.abs(Number(t.amount));
    if (hasMin && abs < aminN) return false;
    if (hasMax && abs > amaxN) return false;
    return true;
  });

  // Merchants for the filter panel: unfiltered period list, ranked by volume.
  const merchantTotals = new Map<string, number>();
  for (const t of periodList) {
    merchantTotals.set(t.name, (merchantTotals.get(t.name) ?? 0) + Math.abs(Number(t.amount)));
  }
  const merchantOptions = [...merchantTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 200);

  const currencies = currencyOrder(filtered.map((t) => t.currency));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));

  function kindFor(t: Transaction): string {
    if (t.hide_from_reports || t.is_transfer) return "skip";
    const k = t.category_id
      ? (kindOf.get(t.category_id) ?? (Number(t.amount) > 0 ? "income" : "expense"))
      : Number(t.amount) > 0
        ? "income"
        : "expense";
    return k === "transfer" ? "skip" : k;
  }

  function bucketBy(list: Transaction[], kind: "income" | "expense") {
    const buckets = new Map<
      string,
      { key: string; label: string; labelHe: string | null; icon: string | null; value: number }
    >();
    for (const t of list) {
      if (kindFor(t) !== kind) continue;
      // Net, not absolute: refunds/incoming reduce an expense bucket
      // (keeps these totals equal to the sankey and the stat cards).
      const signed = Number(t.amount);
      const v = kind === "expense" ? -signed : signed;
      const cat = t.category_id ? catById.get(t.category_id) : null;
      let key: string, label: string, icon: string | null;
      let labelHe: string | null = null;
      if (by === "merchant") {
        key = label = t.name;
        icon = null;
      } else if (by === "group") {
        key = label = cat?.group ?? "Other";
        icon = null;
      } else {
        key = cat?.id ?? "un";
        label = cat?.name ?? "Uncategorized";
        labelHe = cat?.name_he ?? null;
        icon = cat?.icon ?? null;
      }
      const b = buckets.get(key) ?? { key, label, labelHe, icon, value: 0 };
      b.value += v;
      buckets.set(key, b);
    }
    return [...buckets.values()]
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  // A breakdown row links to its transactions, in a new tab, over the same
  // period. Category rows filter by category; merchant rows by name search.
  // Group and uncategorized rows have no single filter, so they stay plain.
  function txnHref(key: string): string | undefined {
    const q = new URLSearchParams();
    if (by === "merchant") q.set("q", key);
    else if (by !== "group" && key !== "un") q.set("category", key);
    else return undefined;
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return `/transactions?${q.toString()}`;
  }

  const periodLabel =
    from && to
      ? `${shortDate(from)} – ${shortDate(to)}`
      : from
        ? `Since ${shortDate(from)}`
        : to
          ? `Through ${shortDate(to)}`
          : "All time";

  const header = (
    <PageHeader
      title="Reports"
      tabs={
        <div className="flex items-center gap-1">
          {(["cashflow", "spending", "income"] as const).map((t) => (
            <a
              key={t}
              href={`/reports?tab=${t}&by=${by}`}
              className={`rounded-lg px-2.5 py-1 text-[13.5px] font-medium ${tab === t ? "text-accent underline decoration-2 underline-offset-8" : "text-muted hover:text-ink"}`}
            >
              {t === "cashflow" ? "Cash Flow" : t === "spending" ? "Spending" : "Income"}
            </a>
          ))}
        </div>
      }
      right={
        <>
          <DateFilterButton current={current} />
          <FiltersButton
            current={current}
            categories={categories.map((c: Category) => ({
              id: c.id,
              name: c.name,
              name_he: c.name_he,
              icon: c.icon,
              group: c.group,
            }))}
            merchants={merchantOptions}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          />
          {tab !== "cashflow" ? (
            <Segmented
              options={[
                { value: "category", label: "Category" },
                { value: "group", label: "Group" },
                { value: "merchant", label: "Merchant" },
              ]}
              value={by}
              hrefBase={`/reports?${buildQuery(current, "by")}`}
              param="by"
            />
          ) : null}
        </>
      }
    />
  );

  if (currencies.length === 0) {
    return (
      <>
        {header}
        <div className="px-6 pt-2">
          <Card>
            <EmptyState
              icon={<span>💸</span>}
              title="Nothing in this period"
              sub="Transactions matching these filters will show up here once they sync."
            />
          </Card>
        </div>
      </>
    );
  }

  // ------------------------------------------------------- Cash Flow tab
  if (tab === "cashflow") {
    const sections = currencies.map((ccy) => {
      const ccyTxns = filtered.filter((t) => t.currency === ccy);
      const cf = computeCashflowPerCurrency(ccyTxns, categories).get(ccy);

      const byMonth = new Map<string, Transaction[]>();
      let earliest = ccyTxns[0]?.date ?? monthStart();
      for (const t of ccyTxns) {
        if (t.date < earliest) earliest = t.date;
        const m = t.date.slice(0, 7);
        const arr = byMonth.get(m) ?? [];
        arr.push(t);
        byMonth.set(m, arr);
      }
      const monthKeys: string[] = [];
      let m = monthStart(new Date(`${(from ?? earliest).slice(0, 7)}-01T00:00:00`));
      const endMonth = `${(to ?? monthStart()).slice(0, 7)}-01`;
      let guard = 0;
      while (m <= endMonth && guard++ < 600) {
        monthKeys.push(m.slice(0, 7));
        m = addMonths(m, 1);
      }
      const trend = monthKeys.slice(-24).map((mk) => {
        const mcf = computeCashflowPerCurrency(byMonth.get(mk) ?? [], categories).get(ccy);
        return {
          label: new Date(`${mk}-01T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
          }),
          income: Math.round(mcf?.income ?? 0),
          expense: Math.round(mcf?.expense ?? 0),
        };
      });

      const incomeRows = bucketBy(ccyTxns, "income");
      const expenseRows = bucketBy(ccyTxns, "expense");
      const maxIncome = Math.max(1, ...incomeRows.map((r) => r.value));
      const maxExpense = Math.max(1, ...expenseRows.map((r) => r.value));
      const incomeTotal = incomeRows.reduce((s, r) => s + r.value, 0);
      const expenseTotal = expenseRows.reduce((s, r) => s + r.value, 0);

      // --- Sankey graph: income cats -> Income -> groups (+ Savings) -> cats
      const sNodes: { name: string }[] = [];
      const sLinks: { source: number; target: number; value: number }[] = [];
      const addNode = (name: string) => sNodes.push({ name }) - 1;
      const incomeHub = addNode("Income"); // hub first so it wins the name lookup

      const catLabelFor = (id: string) => {
        const c = id === "uncategorized" ? undefined : catById.get(id);
        return c ? `${c.icon ? `${c.icon} ` : ""}${c.name}` : "Uncategorized";
      };

      // Level 1: income categories (top 6, rest "Other income") -> Income.
      const incomeEntries = [...(cf?.incomeByCategory ?? new Map<string, number>())]
        .filter(([, v]) => v > 0)
        .map(([id, v]) => ({ label: catLabelFor(id), value: v }))
        .sort((a, b) => b.value - a.value);
      const topIncome = incomeEntries.slice(0, 6);
      const restIncome = incomeEntries.slice(6).reduce((s, e) => s + e.value, 0);
      for (const e of topIncome) {
        sLinks.push({ source: addNode(e.label), target: incomeHub, value: e.value });
      }
      if (restIncome > 0) {
        sLinks.push({ source: addNode("Other income"), target: incomeHub, value: restIncome });
      }

      // Levels 2+3: Income -> expense group -> its categories (top 3, rest "Other").
      const groupMap = new Map<string, { total: number; cats: { label: string; value: number }[] }>();
      for (const [id, v] of cf?.expenseByCategory ?? new Map<string, number>()) {
        if (v <= 0) continue;
        const gname = (id === "uncategorized" ? undefined : catById.get(id))?.group ?? "Other";
        const g = groupMap.get(gname) ?? { total: 0, cats: [] };
        g.total += v;
        g.cats.push({ label: catLabelFor(id), value: v });
        groupMap.set(gname, g);
      }
      const sortedGroups = [...groupMap.entries()].sort((a, b) => b[1].total - a[1].total);
      for (const [gname, g] of sortedGroups) {
        const gIdx = addNode(gname);
        sLinks.push({ source: incomeHub, target: gIdx, value: g.total });
        g.cats.sort((a, b) => b.value - a.value);
        for (const c of g.cats.slice(0, 3)) {
          sLinks.push({ source: gIdx, target: addNode(c.label), value: c.value });
        }
        const restCats = g.cats.slice(3).reduce((s, c) => s + c.value, 0);
        if (restCats > 0) {
          sLinks.push({ source: gIdx, target: addNode("Other"), value: restCats });
        }
      }

      const savings = cf?.savings ?? 0;
      if (savings > 0) {
        sLinks.push({ source: incomeHub, target: addNode("Savings"), value: savings });
      }

      const hasFlow = sLinks.length > 0;
      const chart =
        sp.chart === "bars"
          ? "bars"
          : sp.chart === "sankey"
            ? "sankey"
            : hasFlow
              ? "sankey"
              : "bars";
      const showSankey = chart === "sankey" && hasFlow;
      const leafCount = sortedGroups.reduce(
        (s, [, g]) => s + Math.min(g.cats.length, 3) + (g.cats.length > 3 ? 1 : 0),
        0,
      );
      const maxColumn = Math.max(
        1,
        topIncome.length + (restIncome > 0 ? 1 : 0),
        sortedGroups.length + (savings > 0 ? 1 : 0),
        leafCount,
      );
      const sankeyHeight = Math.max(380, Math.min(720, maxColumn * 44 + 60));

      const chartToggle = (
        <Segmented
          options={[
            { value: "sankey", label: "Sankey" },
            { value: "bars", label: "Bars" },
          ]}
          value={showSankey ? "sankey" : "bars"}
          hrefBase={`/reports?${buildQuery(current)}`}
          param="chart"
        />
      );

      return (
        <div key={ccy} className="flex flex-col gap-3">
          <div className="text-[13px] font-semibold text-ink-soft">{ccyLabel(ccy)}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`${ccySym(ccy)} TOTAL INCOME`}
              value={fmtMoney(cf?.income ?? 0, ccy, { decimals: false })}
              tone="pos"
            />
            <StatCard
              label={`${ccySym(ccy)} TOTAL SPENDING`}
              value={fmtMoney(cf?.expense ?? 0, ccy, { decimals: false })}
            />
            <StatCard
              label={`${ccySym(ccy)} NET CASH FLOW`}
              value={fmtMoney(cf?.savings ?? 0, ccy, { decimals: false })}
              tone={(cf?.savings ?? 0) >= 0 ? "pos" : "neg"}
            />
            <StatCard
              label={`${ccySym(ccy)} SAVINGS RATE`}
              value={cf && cf.income > 0 ? fmtPct(cf.savingsRate * 100, 0) : "—"}
            />
          </div>
          {showSankey ? (
            <Card>
              <CardHeader title="Cash flow" sub={periodLabel} right={chartToggle} />
              <div className="px-2 pb-3">
                <CashflowSankey
                  nodes={sNodes}
                  links={sLinks}
                  currency={ccy}
                  height={sankeyHeight}
                />
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Income vs expenses"
                sub={periodLabel}
                right={hasFlow ? chartToggle : undefined}
              />
              {ccyTxns.length === 0 ? (
                <EmptyState
                  icon={<span>💸</span>}
                  title="No cash flow yet"
                  sub="Transactions in this period will show up here once they sync."
                />
              ) : (
                <div className="px-2 pb-2">
                  <TrendBars data={trend} currency={ccy} height={230} />
                </div>
              )}
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Income breakdown"
                right={
                  <span className="tnum text-[15px] font-semibold">
                    {fmtMoney(incomeTotal, ccy, { decimals: false })}
                  </span>
                }
              />
              <div className="flex flex-col gap-1 px-5 pb-4">
                {incomeRows.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-muted">Nothing here.</p>
                ) : (
                  incomeRows.slice(0, 15).map((r, i) => (
                    <RankRow
                      key={i}
                      row={r}
                      max={maxIncome}
                      currency={ccy}
                      color="bg-pos-soft"
                      href={txnHref(r.key)}
                    />
                  ))
                )}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Expense breakdown"
                right={
                  <span className="tnum text-[15px] font-semibold">
                    {fmtMoney(expenseTotal, ccy, { decimals: false })}
                  </span>
                }
              />
              <div className="flex flex-col gap-1 px-5 pb-4">
                {expenseRows.length === 0 ? (
                  <p className="py-3 text-center text-[13px] text-muted">Nothing here.</p>
                ) : (
                  expenseRows.slice(0, 15).map((r, i) => (
                    <RankRow
                      key={i}
                      row={r}
                      max={maxExpense}
                      currency={ccy}
                      color="bg-neg-soft"
                      href={txnHref(r.key)}
                    />
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      );
    });

    return (
      <>
        {header}
        <div className="flex flex-col gap-6 px-6 pt-2">{sections}</div>
      </>
    );
  }

  // --------------------------------------------- Spending / Income tabs
  const sections = currencies.map((ccy) => {
    const ccyTxns = filtered.filter((t) => t.currency === ccy);
    const rows = bucketBy(ccyTxns, tab === "spending" ? "expense" : "income");
    const total = rows.reduce((s, r) => s + r.value, 0);
    const donutData = rows.slice(0, 8).map((r) => ({ name: r.label, value: Math.round(r.value) }));
    if (rows.length > 8) {
      donutData.push({
        name: "Other",
        value: Math.round(rows.slice(8).reduce((s, r) => s + r.value, 0)),
      });
    }

    return (
      <div key={ccy} className="flex flex-col gap-3">
        <div className="text-[13px] font-semibold text-ink-soft">{ccyLabel(ccy)}</div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
          <Card>
            <CardHeader
              title={tab === "spending" ? "Total spending" : "Total income"}
              sub={periodLabel}
            />
            <div className="relative px-4 pb-4">
              <Donut data={donutData} currency={ccy} height={230} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="tnum text-[19px] font-semibold">
                  {fmtMoney(total, ccy, { decimals: false })}
                </span>
                <span className="text-[11px] text-muted">
                  {tab === "spending" ? "spent" : "earned"}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Breakdown"
              sub={`${rows.length} ${by === "merchant" ? "merchants" : by === "group" ? "groups" : "categories"}`}
              right={
                <span className="tnum text-[15px] font-semibold">
                  {fmtMoney(total, ccy, { decimals: false })}
                </span>
              }
            />
            <div className="flex flex-col gap-0.5 px-5 pb-4">
              {rows.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted">
                  Nothing in this period.
                </p>
              ) : (
                rows.slice(0, 30).map((r, i) => {
                  const href = txnHref(r.key);
                  const content = (
                    <>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: DONUT_COLORS[Math.min(i, 8) % DONUT_COLORS.length] }}
                      />
                      <span className="w-[45%] truncate text-[13px] font-medium" dir="auto">
                        {r.icon ? `${r.icon} ` : ""}
                        {r.label}
                        {r.labelHe && r.labelHe !== r.label ? (
                          <span className="ml-1.5 font-normal text-muted">
                            · {r.labelHe}
                          </span>
                        ) : null}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-active">
                        <div
                          className="h-full rounded-full bg-chart-1"
                          style={{ width: `${total > 0 ? Math.max(1, (r.value / total) * 100) : 0}%` }}
                        />
                      </div>
                      <span className="tnum w-24 text-right text-[13px]">
                        {fmtMoney(r.value, ccy, { decimals: false })}
                      </span>
                      <span className="tnum w-10 text-right text-[12px] text-muted">
                        {total > 0 ? Math.round((r.value / total) * 100) : 0}%
                      </span>
                    </>
                  );
                  return href ? (
                    <a
                      key={i}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open these transactions"
                      className="-mx-1 flex items-center gap-3 rounded-md px-1 py-1 hover:bg-hover"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={i} className="flex items-center gap-3 py-1">
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  });

  return (
    <>
      {header}
      <div className="flex flex-col gap-6 px-6 pt-2">{sections}</div>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <Card className="px-5 py-4 text-center">
      <div
        className={`tnum text-[19px] font-semibold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-semibold tracking-wider text-muted">
        {label}
      </div>
    </Card>
  );
}

function RankRow({
  row,
  max,
  currency,
  color,
  href,
}: {
  row: { label: string; labelHe?: string | null; icon: string | null; value: number };
  max: number;
  currency: string;
  color: string;
  href?: string;
}) {
  const inner = (
    <>
      <div
        className={`absolute inset-y-0 left-0 ${color}`}
        style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
      />
      <div className="relative flex items-center justify-between px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium" dir="auto">
          {row.icon ? <span>{row.icon}</span> : null}
          {row.label}
          {row.labelHe && row.labelHe !== row.label ? (
            <span className="font-normal text-muted">· {row.labelHe}</span>
          ) : null}
        </span>
        <span className="tnum text-[13px]">
          {fmtMoney(row.value, currency, { decimals: false })}
        </span>
      </div>
    </>
  );
  if (!href) {
    return <div className="relative overflow-hidden rounded-md">{inner}</div>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open these transactions"
      className="relative block overflow-hidden rounded-md ring-inset hover:ring-1 hover:ring-line-strong"
    >
      {inner}
    </a>
  );
}
