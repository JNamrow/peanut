"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Layers,
  CreditCard,
  BarChart3,
  PieChart,
  Wallet,
  CalendarClock,
  Target,
  TrendingUp,
  Settings,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  dashboard: Home,
  accounts: Layers,
  transactions: CreditCard,
  "cash-flow": BarChart3,
  reports: PieChart,
  budget: Wallet,
  recurring: CalendarClock,
  goals: Target,
  investments: TrendingUp,
  settings: Settings,
};

export function NavLink({ slug, label }: { slug: string; label: string }) {
  const pathname = usePathname();
  const href = `/${slug}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = icons[slug] ?? Home;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
        active ? "bg-active text-ink" : "text-ink-soft hover:bg-hover",
      )}
    >
      <Icon size={17} strokeWidth={1.8} className={active ? "text-ink" : "text-muted"} />
      {label}
    </Link>
  );
}

export function CurrencyToggle({ current }: { current: string }) {
  const router = useRouter();
  function set(ccy: string) {
    document.cookie = `display_ccy=${ccy}; path=/; max-age=31536000`;
    router.refresh();
  }
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-active p-0.5">
      {["ILS", "USD"].map((c) => (
        <button
          key={c}
          onClick={() => set(c)}
          className={cn(
            "flex-1 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold transition-colors cursor-pointer",
            c === current ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {c === "ILS" ? "₪ ILS" : "$ USD"}
        </button>
      ))}
    </div>
  );
}
