/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

// Institution -> domain for favicon logos (Google favicon service).
const DOMAINS: Record<string, string> = {
  "Bank Leumi": "leumi.co.il",
  "Bank Hapoalim": "bankhapoalim.co.il",
  "Bank Mizrahi": "mizrahi-tefahot.co.il",
  "Bank Discount": "discountbank.co.il",
  "Leumi Card": "max.co.il",
  Max: "max.co.il",
  "American Express": "americanexpress.com",
  "Visa Cal": "cal-online.co.il",
  Isracard: "isracard.co.il",
  "One Zero": "onezerobank.com",
  Robinhood: "robinhood.com",
  Chase: "chase.com",
  "Bank of America": "bankofamerica.com",
  "Wells Fargo": "wellsfargo.com",
  Fidelity: "fidelity.com",
  Schwab: "schwab.com",
  Vanguard: "vanguard.com",
  Meitav: "meitav.co.il",
  Menorah: "menoramivt.co.il",
  Clal: "clal-ins.co.il",
  Phoenix: "fnx.co.il",
  Harel: "harel-group.co.il",
  Migdal: "migdal.co.il",
  Altshuler: "as-invest.co.il",
};

function domainFor(institution: string | null): string | null {
  if (!institution) return null;
  if (DOMAINS[institution]) return DOMAINS[institution];
  const hit = Object.keys(DOMAINS).find((k) =>
    institution.toLowerCase().includes(k.toLowerCase()),
  );
  return hit ? DOMAINS[hit] : null;
}

export function InstitutionLogo({
  institution,
  fallback,
  size = 32,
  className,
}: {
  institution: string | null;
  fallback?: string;
  size?: number;
  className?: string;
}) {
  const domain = domainFor(institution);
  const initial = (fallback ?? institution ?? "?").slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-active text-[12px] font-semibold text-ink-soft",
        className,
      )}
      style={{ width: size, height: size }}
      title={institution ?? undefined}
    >
      {initial}
      {domain ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={institution ?? ""}
          width={size}
          height={size}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
          loading="lazy"
        />
      ) : null}
    </span>
  );
}
