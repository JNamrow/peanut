"use client";

import { useActionState } from "react";
import { signIn, type AuthState } from "../actions";
import { PeanutMark } from "@/components/logo";
import { buttonCls, inputCls } from "@/components/ui";

const initial: AuthState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4">
      <div className="flex items-center gap-2.5">
        <PeanutMark size={34} />
        <span className="text-[26px] font-semibold tracking-tight">peanut</span>
      </div>
      <div className="card w-full max-w-[400px] p-6">
        <h1 className="mb-4 text-[17px] font-semibold">Sign in</h1>
        <form action={action} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              className={inputCls}
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className={inputCls}
            />
          </label>
          {state.error ? (
            <p className="text-[13px] text-neg">{state.error}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className={buttonCls("primary")}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
      <p className="text-[12.5px] text-muted">
        Dollars and shekels, one household.
      </p>
    </div>
  );
}
