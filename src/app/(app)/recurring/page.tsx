import { getAccounts, getContext } from "@/lib/data";
import { fmtMoney, shortDate } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { DetectButton, StreamActions } from "./recurring-ui";
import type { RecurringStream } from "@/lib/types";
import { CalendarClock } from "lucide-react";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  semiyearly: "Every 6 months",
  yearly: "Every year",
};

export default async function RecurringPage() {
  const { supabase, space, rates, displayCurrency } = await getContext();
  const accounts = await getAccounts();
  const { data: streams } = await supabase
    .from("recurring_streams")
    .select("*")
    .eq("space_id", space.id)
    .neq("status", "dismissed")
    .order("next_expected_date");

  const list = (streams ?? []) as RecurringStream[];
  const suggested = list.filter((s) => s.status === "suggested");
  const active = list.filter((s) => s.status === "active");
  const accountById = new Map(accounts.map((a) => [a.id, a.name]));

  const monthlyTotal = active.reduce((s, r) => {
    const factor =
      r.cadence === "weekly"
        ? 4.33
        : r.cadence === "biweekly"
          ? 2.17
          : r.cadence === "monthly"
            ? 1
            : r.cadence === "quarterly"
              ? 1 / 3
              : r.cadence === "semiyearly"
                ? 1 / 6
                : 1 / 12;
    const v = rates.convert(Number(r.typical_amount ?? 0), r.currency, displayCurrency);
    return s + (r.kind === "expense" ? v * factor : 0);
  }, 0);

  return (
    <>
      <PageHeader title="Recurring" right={<DetectButton />} />
      <div className="flex flex-col gap-4 px-6 pt-2">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="px-5 py-4">
            <div className="tnum text-[20px] font-semibold">
              {fmtMoney(monthlyTotal, displayCurrency, { decimals: false })}
            </div>
            <div className="text-[11px] font-semibold tracking-wider text-muted">
              MONTHLY RECURRING EXPENSES
            </div>
          </Card>
          <Card className="px-5 py-4">
            <div className="tnum text-[20px] font-semibold">{active.length}</div>
            <div className="text-[11px] font-semibold tracking-wider text-muted">
              ACTIVE ITEMS
            </div>
          </Card>
          <Card className="px-5 py-4">
            <div className="tnum text-[20px] font-semibold">{suggested.length}</div>
            <div className="text-[11px] font-semibold tracking-wider text-muted">
              WAITING FOR REVIEW
            </div>
          </Card>
        </div>

        {suggested.length > 0 ? (
          <Card>
            <CardHeader title="Review suggestions" sub="found in your transactions" />
            <div className="px-2 pb-2">
              {suggested.map((r) => (
                <StreamRow
                  key={r.id}
                  stream={r}
                  accountName={r.account_id ? accountById.get(r.account_id) : undefined}
                  showActions
                />
              ))}
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="All recurring" sub="active" />
          <div className="px-2 pb-2">
            {active.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={19} />}
                title="No recurring items yet"
                sub="Press Find recurring — Peanut scans 13 months of transactions for repeat bills and paychecks."
                action={<DetectButton primary />}
              />
            ) : (
              active.map((r) => (
                <StreamRow
                  key={r.id}
                  stream={r}
                  accountName={r.account_id ? accountById.get(r.account_id) : undefined}
                />
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function StreamRow({
  stream,
  accountName,
  showActions = false,
}: {
  stream: RecurringStream;
  accountName?: string;
  showActions?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active text-[13px] font-semibold text-ink-soft">
          {stream.merchant_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium" dir="auto">
            {stream.merchant_name}
          </div>
          <div className="text-[12px] text-muted">
            {CADENCE_LABEL[stream.cadence] ?? stream.cadence}
            {accountName ? ` · ${accountName}` : ""}
            {stream.next_expected_date
              ? ` · next ${shortDate(stream.next_expected_date)}`
              : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`tnum text-[13.5px] font-medium ${stream.kind === "income" ? "text-pos" : ""}`}
        >
          {fmtMoney(Number(stream.typical_amount ?? 0), stream.currency)}
        </span>
        {showActions ? <StreamActions streamId={stream.id} /> : null}
      </div>
    </div>
  );
}
