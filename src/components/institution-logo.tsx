"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { cn } from "@/lib/utils";

// Institution -> domain for logo lookup.
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
  "Charles Schwab": "schwab.com",
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

/**
 * Brand logo with graceful fallback: icon.horse (hi-res) -> Google
 * favicon -> letter monogram.
 */
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
  // icon.horse first: it serves apple-touch icons (the real brand mark),
  // falling back to Google's favicon service, then a letter monogram.
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const initial = (fallback ?? institution ?? "?").slice(0, 1).toUpperCase();
  const src =
    stage === 0 && domain
      ? `https://icon.horse/icon/${domain}`
      : stage === 1 && domain
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        : null;
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
      {src ? (
        <img
          src={src}
          alt={institution ?? ""}
          width={size}
          height={size}
          className={cn(
            "absolute inset-0 h-full w-full rounded-full object-cover",
            loaded ? "bg-card opacity-100" : "opacity-0",
          )}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setStage((s) => s + 1);
          }}
        />
      ) : null}
    </span>
  );
}
