import { notFound } from "next/navigation";
import Link from "next/link";
import { getContext, getCategories } from "@/lib/data";
import { fmtMoney, shortDate } from "@/lib/format";
import { NetWorthChart } from "@/components/charts";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { BalanceEditor, DeleteAccountButton } from "./editor";
import type { Transaction, BalanceSnapshot } from "@/lib/types";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, displayCurrency, rates } = await getContext();
  const categories = await getCategories();

  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!account) notFound();

  const [{ data: snapshots }, { data: txns }, { data: pension }] = await Promise.all([
    supabase
      .from("account_balance_snapshots")
      .select("*")
      .eq("account_id", id)
      .order("as_of_date"),
    supabase
      .from("transactions")
      .select("*")
      .eq("account_id", id)
      .order("date", { ascending: false })
      .limit(30),
    supabase.from("pension_configs").select("*").eq("account_id", id).maybeSingle(),
  ]);

  const series = ((snapshots ?? []) as BalanceSnapshot[]).map((s) => ({
    date: s.as_of_date,
    value: account.is_liability ? -Math.abs(Number(s.balance)) : Number(s.balance),
  }));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const balance = Number(account.current_balance ?? 0);

  return (
    <>
      <PageHeader
        title={
          <span>
            <Link href="/accounts" className="text-muted hover:text-ink">
              Accounts
            </Link>
            <span className="mx-1.5 text-faint">/</span>
            {account.name}
          </span>
        }
        right={<DeleteAccountButton accountId={id} />}
      />
      <div className="grid grid-cols-1 gap-4 px-6 pt-2 xl:grid-cols-[1fr_330px]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="px-5 pt-4">
              <div className="text-[11px] font-semibold tracking-wider text-muted">
                BALANCE
              </div>
              <div className="flex items-baseline gap-3">
                <span className="tnum text-[26px] font-semibold">
                  {fmtMoney(balance, account.currency)}
                </span>
                {account.currency !== displayCurrency ? (
                  <span className="tnum text-[13px] text-muted">
                    ≈{" "}
                    {fmtMoney(
                      rates.convert(balance, account.currency, displayCurrency),
                      displayCurrency,
                      { decimals: false },
                    )}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="px-2 pb-2 pt-1">
              {series.length > 1 ? (
                <NetWorthChart data={series} currency={account.currency} height={200} />
              ) : (
                <p className="px-4 pb-4 text-[13px] text-muted">
                  History starts now — one point per day.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Transactions" sub={`latest ${(txns ?? []).length}`} />
            <div className="px-2 pb-2">
              {((txns ?? []) as Transaction[]).map((t) => {
                const cat = t.category_id ? catById.get(t.category_id) : null;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-hover"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-active text-[13px]">
                        {cat?.icon ?? "💸"}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{t.name}</div>
                        <div className="text-[12px] text-muted">
                          {shortDate(t.date)}
                          {cat ? ` · ${cat.name}` : ""}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`tnum text-[13.5px] font-medium ${Number(t.amount) > 0 ? "text-pos" : ""}`}
                    >
                      {fmtMoney(Number(t.amount), t.currency, {
                        sign: Number(t.amount) > 0,
                      })}
                    </span>
                  </div>
                );
              })}
              {(txns ?? []).length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">
                  No transactions on this account.
                </p>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <div className="flex flex-col gap-1.5 px-5 pb-4 text-[13px]">
              <Row k="Type" v={account.type} />
              <Row k="Currency" v={account.currency} />
              <Row k="Institution" v={account.institution_name ?? "—"} />
              <Row k="Source" v={account.source} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Update balance" />
            <div className="px-5 pb-4">
              <BalanceEditor accountId={id} current={balance} />
              {account.source !== "manual" ? (
                <p className="mt-2 text-[12px] text-faint">
                  Synced accounts update on their own. A manual edit adds a
                  snapshot for today.
                </p>
              ) : null}
            </div>
          </Card>
          {pension ? (
            <Card>
              <CardHeader title="Pension auto-tracking" />
              <div className="flex flex-col gap-1.5 px-5 pb-4 text-[13px]">
                <Row k="Dataset" v={pension.dataset} />
                <Row k="Track #" v={String(pension.fund_id)} />
                <Row k="Annual fee" v={`${pension.annual_fee_pct}%`} />
                <Row
                  k="Monthly deposit"
                  v={fmtMoney(Number(pension.monthly_contribution ?? 0), "ILS")}
                />
                <Row
                  k="Anchor"
                  v={`${fmtMoney(Number(pension.anchor_balance ?? 0), "ILS")} on ${pension.anchor_date ?? "—"}`}
                />
                <Row k="Applied through" v={pension.last_applied_period ?? "not yet"} />
                <p className="mt-1 text-[12px] text-faint">
                  Balance rolls forward monthly from the track&apos;s official
                  yield. Update the balance above to re-anchor from a new
                  statement.
                </p>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
