import { getAccounts, getCategories, getContext } from "@/lib/data";
import { PageHeader, Card } from "@/components/ui";
import { TxnTable, TxnFilters, AddTransactionButton } from "./txn-ui";
import type { Transaction } from "@/lib/types";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    account?: string;
    category?: string;
    flow?: string;
    month?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const raw = await searchParams;
  const { supabase, space, displayCurrency, rates } = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);

  // Backcompat: ?month=YYYY-MM translates to its from/to range.
  let from = raw.from;
  let to = raw.to;
  if (raw.month && !from && !to) {
    from = `${raw.month}-01`;
    const end = new Date(`${raw.month}-01T00:00:00`);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0); // last day of the month
    to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }
  const flow = raw.flow === "in" || raw.flow === "out" ? raw.flow : undefined;
  const params = {
    q: raw.q,
    account: raw.account,
    category: raw.category,
    flow,
    from,
    to,
    page: raw.page,
  };

  const page = Math.max(1, Number(params.page ?? 1));
  let query = supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("space_id", space.id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (params.q) {
    // Search also matches category names (English or Hebrew) against the
    // already-loaded categories, widening the query to those category ids.
    const needle = params.q.toLowerCase();
    const catIds = categories
      .filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.name_he ?? "").toLowerCase().includes(needle),
      )
      .map((c) => c.id);
    if (catIds.length > 0) {
      // or() parses commas/parens as syntax, so strip them from the pattern.
      const safeQ = params.q.replace(/[(),]/g, "");
      query = query.or(
        `name.ilike.%${safeQ}%,category_id.in.(${catIds.join(",")})`,
      );
    } else {
      query = query.ilike("name", `%${params.q}%`);
    }
  }
  if (params.account) query = query.eq("account_id", params.account);
  if (params.category) query = query.eq("category_id", params.category);
  if (flow === "in") query = query.gt("amount", 0);
  if (flow === "out") query = query.lt("amount", 0);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data: txns, count } = await query;

  return (
    <>
      <PageHeader
        title="Transactions"
        right={<AddTransactionButton accounts={accounts} categories={categories} />}
      />
      <div className="px-6 pt-2">
        <Card className="overflow-visible">
          <div className="px-4 pt-3">
            <TxnFilters
              accounts={accounts}
              categories={categories}
              current={params}
              total={count ?? 0}
            />
          </div>
          <TxnTable
            txns={(txns ?? []) as Transaction[]}
            accounts={accounts}
            categories={categories}
            displayCurrency={displayCurrency}
            usdIls={rates.usdIls()}
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? 0}
            params={params}
          />
        </Card>
      </div>
    </>
  );
}
