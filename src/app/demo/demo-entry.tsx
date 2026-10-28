"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PeanutMark } from "@/components/logo";
import { buttonCls } from "@/components/ui";

/** Signs the visitor into the demo household and opens the dashboard. */
export function DemoEntry() {
  const router = useRouter();
  const [signInError, setSignInError] = useState<string | null>(null);
  const email = process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
  const error =
    signInError ?? (!email || !password ? "The demo is not configured on this deployment." : null);

  useEffect(() => {
    if (!email || !password) return;
    let cancelled = false;
    createClient()
      .auth.signInWithPassword({ email, password })
      .then(({ error: signInError }) => {
        if (cancelled) return;
        if (signInError) {
          setSignInError(
            /rate limit/i.test(signInError.message)
              ? "Too many people are opening the demo right now. Give it a minute and try again."
              : "The demo could not sign you in. Try again in a moment.",
          );
          return;
        }
        router.replace("/dashboard");
        router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [router, email, password]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4">
      <div className="flex items-center gap-2.5">
        <PeanutMark size={34} />
        <span className="text-[26px] font-semibold tracking-tight">peanut</span>
      </div>
      {error ? (
        <div className="card flex w-full max-w-[400px] flex-col items-center gap-3 p-6 text-center">
          <p className="text-[13.5px] text-ink-soft">{error}</p>
          <div className="flex gap-2">
            <button className={buttonCls("primary")} onClick={() => window.location.reload()}>
              Try again
            </button>
            <Link href="/contact" className={buttonCls("secondary")}>
              About Peanut
            </Link>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13.5px] text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          Opening the demo household…
        </p>
      )}
    </div>
  );
}
