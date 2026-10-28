import Link from "next/link";
import type { ReactNode } from "react";
import { PeanutMark } from "./logo";
import { NavLink } from "./nav";
import { DemoBanner } from "./demo-banner";
import { getContext } from "@/lib/data";
import { signOut } from "@/app/(auth)/actions";
import { isDemoDeployment } from "@/lib/demo/config";
import { LogOut } from "lucide-react";

const NAV: { slug: string; label: string }[] = [
  { slug: "dashboard", label: "Dashboard" },
  { slug: "accounts", label: "Accounts" },
  { slug: "transactions", label: "Transactions" },
  { slug: "cash-flow", label: "Cash Flow" },
  { slug: "reports", label: "Reports" },
  { slug: "budget", label: "Budget" },
  { slug: "recurring", label: "Recurring" },
  { slug: "goals", label: "Goals" },
  { slug: "investments", label: "Investments" },
  { slug: "forecasting", label: "Forecasting" },
];

export async function AppShell({ children }: { children: ReactNode }) {
  const ctx = await getContext();
  const me = ctx.members.find((m) => m.user_id === ctx.userId);
  const name = me?.display_name ?? ctx.userEmail.split("@")[0];
  const demo = isDemoDeployment();

  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 flex w-[210px] flex-col gap-1 px-3 py-4">
        <Link href="/dashboard" className="mb-3 flex items-center gap-2 px-2">
          <PeanutMark size={26} />
          <span className="text-[17px] font-semibold tracking-tight">peanut</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink key={n.slug} slug={n.slug} label={n.label} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <NavLink slug="settings" label="Settings" />
          <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-[13px] font-medium">{name}</span>
            </div>
            {demo ? null : (
              <form action={signOut}>
                <button
                  className="cursor-pointer text-muted transition-colors hover:text-ink"
                  title="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>
      <main className="ml-[210px] min-w-0 flex-1 pb-16">
        {demo ? <DemoBanner /> : null}
        {children}
      </main>
    </div>
  );
}
