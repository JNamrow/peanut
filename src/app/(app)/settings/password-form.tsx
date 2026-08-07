"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/(auth)/actions";
import { buttonCls, inputCls } from "@/components/ui";

const initial: AuthState = { error: null };

export function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);
  return (
    <form action={action} className="flex items-end gap-2.5 px-5 pb-4">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-soft">
          New password (8+ characters)
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          className={inputCls}
        />
      </label>
      <button className={buttonCls("secondary")} disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
      {state.error ? (
        <p className="pb-2 text-[12.5px] text-neg">{state.error}</p>
      ) : null}
    </form>
  );
}
