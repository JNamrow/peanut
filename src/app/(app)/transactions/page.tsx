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
    month?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, space, displayCurrency, rates } = await getContext();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);

  const page = Math.max(1, Number(params.page ?? 1));
  let query = supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("space_id", space.id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.account) query = query.eq("account_id", params.account);
  if (params.category) query = query.eq("category_id", params.category);
  if (params.month) {
    const start = `${params.month}-01`;
    const end = new Date(`${params.month}-01T00:00:00`);
    end.setMonth(end.getMonth() + 1);
    query = query.gte("date", start).lt("date", end.toISOString().slice(0, 10));
  }

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
