# Monarch behavior spec (grounding doc)

Source: Monarch's help center (help.monarch.com, all 109 articles pulled
2026-08-07), their production GraphQL schema, and a live click-through of
the app. This is the reference for how Peanut features should behave.
Peanut deviations are marked **[Peanut]**.

## Core mechanics (the load-bearing rules)

- **Category types drive everything.** Three fixed types: income /
  expense / transfer. Anything categorized as a transfer-type category
  (Transfer, Credit Card Payment, Buy, Sell, Balance Adjustments) is
  excluded from cash flow, budget, and spending. There is NO
  transfer-pair matching engine. CC purchase = expense at swipe;
  CC payment = transfer.
- **Exclusion axes:** category type = transfer; per-transaction
  `hideFromReports`; account-level hide flags (hide from list / hide
  balance from net worth / hide txns from reports); category
  `excludeFromBudget` (budget only — still counts in cash flow).
- **Cash flow definitions:** savings = income − expense;
  savings rate = savings / income.
- **[Peanut]** All of the above per currency, never mixed. ₪ and $ are
  computed and displayed separately on every page.

## Accounts

- Groups: Cash, Credit Cards, Investments, Loans, Real Estate, Vehicles,
  Valuables, Other. **[Peanut]** adds Pensions & Study Funds.
- Page: net worth chart on top (ranges 1M/3M/6M/YTD/1Y/ALL), grouped
  account list with per-account sparkline + "updated X ago", right-side
  Summary card (Totals/Percent toggle, stacked asset bar).
- Balance history = daily snapshots per account. Manual accounts:
  editing balance creates a snapshot; CSV import is the only bulk
  history edit; last-90-days grid editable inline (web).
- Close account = hide + keep history, balance → 0. Delete = remove
  (undelete restores transactions but never balance history).
- Manual transactions on a manual account can adjust its balance
  (toggle, default on); never on synced accounts.
- **[Peanut] todo:** per-row sparklines; edit balance history grid;
  close-vs-delete distinction; Totals/Percent toggle.

## Transactions

- Default taxonomy: type → group → category, ~60 defaults with emoji.
  Defaults can be renamed/disabled, never deleted. Category sort order
  drives display everywhere.
- Rules engine: ordered rules, criteria AND (statement text, merchant,
  amount, category, account, owner), actions (rename, recategorize,
  tags, hide, review status, split by %/$). All matching rules apply in
  order. Retroactive "apply to existing" checkbox.
- Splits: each part becomes its own transaction; unsplit restores.
- Tags: many-to-many; defaults Tax/Reimburse/Split/Business/Subscription.
- Pending txns not editable (posted version arrives as new row).
- Review flow: needs-review flag, per-member review assignment,
  swipe review on mobile.
- **[Peanut] todo:** rules engine, splits, tags, review flow, notes,
  CSV import, merchant rename.

## Cash Flow

- Summary card: Total income, Total spending, Net cash flow ("savings"),
  Savings rate. Sankey chart (income → group → category) + income vs
  expense trend bars (stacked ↔ grouped toggle), timeframe
  day/week/month/quarter/year. Breakdown = ranked category bars.
  In 2026 the standalone page merged into Reports as a tab.
- **[Peanut]:** per-currency sections; Sankey todo.

## Budget

- Two systems, switchable: **Category budgeting** (per category planned
  amounts, optional group-level) and **Flex budgeting** (every expense
  category is fixed / flexible / non-monthly; flex tracked against ONE
  bucket number; non-monthly requires rollover + target + frequency).
- Left to budget = budgeted income − budgeted expenses − goal
  contributions.
- Rollovers (expense only): remaining = prev rollover + planned − actual;
  negatives carry. Frequencies monthly…every-12-months, variable.
- First-run auto-fill from 6-month averages; move-money flow between
  categories keeps month total constant.
- Budget calendar view: 12-month grid per category (pre-load known
  future expenses).
- Goals appear as a Contributions section (planned monthly per goal).
- **[Peanut]:** category budgeting per currency (₪ budget tracks ₪
  spending). Todo: rollovers, flex bucket, move money, auto-fill,
  goal contributions section.

## Recurring

- Stream = merchant (or liability account) + frequency + amount
  (isApproximate) + next date. Cadences: weekly, biweekly, 4-weekly,
  twice-monthly (1st+15th / 15th+last), monthly, bimonthly, quarterly,
  4-monthly, semiyearly, yearly. Weekend dates shift to previous
  business day.
- Detection on every sync + on-demand scan; candidates enter a review
  queue (approve / not recurring). One stream per merchant.
- Views: Monthly (list/calendar) + All recurring (active/canceled).
  Status colors: green ✓ paid; yellow ✓ paid different amount; blue
  upcoming; red ✗ missed.
- Notifications 3 days before expected charge.
- **[Peanut]:** detector + review queue done. Todo: calendar view,
  paid/missed matching against transactions, twice-monthly cadences.

## Goals (Save up / Pay down)

- Creation wizard: Select (multi-select templates with photos, creates
  drafts) → Targets (per goal: name, photo, optional target amount,
  date requires amount, "spending reduces goal progress" toggle) →
  Contribution (starting funds from an account) → Budget (planned
  monthly per goal; shows computed "$X/mo needed" from target+date).
- **Funding model is an allocation ledger, not linked balances:**
  dated From→To moves between accounts and goals; "Available for
  goals" = unallocated money across goal accounts; allocations can
  optionally count in budget actuals ("Include in budget" toggle).
  Reconciliation history tracks drift between allocations and real
  account balances.
- Goal detail: hero photo, Total saved / Total spent / Available to
  spend / Left to save, Timeline vs Contributions views.
- Statuses: On track / At risk / Completed.
- **[Peanut]:** wizard (Select/Targets/Plan) done with linked-account
  progress. Todo: allocation ledger, available-for-goals pool,
  spending-reduces-progress, pay-down statement view.

## Reports

- Three tabs: **Cash Flow / Spending / Income**.
- Chart types: Sankey (cash flow), stacked↔grouped trend bars, pie,
  ranked breakdown bars, treemap. Groupings: category / group /
  merchant / owner / budget-variability. Time buckets day→year.
- Filters: date presets (last 7/30/60 days, this/last month, this/last
  year, last 12 months default, all time, custom), accounts,
  categories, merchants, tags, amount ranges, hidden/split/recurring.
- Saved reports (chart + grouping + filters persisted, shareable URL).
  Export: PNG chart, CSV transactions.
- **[Peanut]:** three tabs per currency. Todo: sankey, treemap, saved
  reports, filters beyond range/grouping.

## Investments

- Holdings (grouped by type/institution/account; price, quantity,
  value, day change) + Allocation breakdown. Prices ~15min refresh.
- Performance: time-weighted, position-size weighted, vs S&P 500 /
  US Stocks / US Bonds. Without cost basis, chart assumes current
  holdings held for the whole range.
- Manual investment accounts: track balance only, or track holdings
  (ticker + quantity, auto-priced).
- Investment transactions (Buy/Sell = transfer-type, Dividends =
  income) — off by default.
- **[Peanut]:** per-currency portfolio + holdings from Plaid; pensions
  auto-drift from data.gov.il published yields (no US equivalent).
  Todo: benchmarks, allocation by security type, manual holdings.

## Household

- One shared space: all members see all accounts/transactions (no
  per-member privacy). Owner role manages members/billing. "Shared
  Views" = ownership labels per account/transaction, filterable.
- **[Peanut]:** shared space done. Todo: ownership labels.

## Multi-currency

- Monarch: none. Bare numbers displayed with "$", no conversion.
  Their official advice: don't mix currencies.
- **[Peanut]:** native currency per account/transaction; ₪ and $
  aggregated and shown separately everywhere; FX table exists for
  goal conversions only.
