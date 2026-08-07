"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonCls } from "@/components/ui";
import { runRecurringDetection, setRecurringStatus } from "../actions";
import { Sparkles, Check, X } from "lucide-react";

export function DetectButton({ primary = false }: { primary?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={buttonCls(primary ? "primary" : "secondary")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await runRecurringDetection();
          router.refresh();
        })
      }
    >
      <Sparkles size={14} /> {pending ? "Scanning…" : "Find recurring"}
    </button>
  );
}

export function StreamActions({ streamId }: { streamId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function set(status: "active" | "dismissed") {
    startTransition(async () => {
      await setRecurringStatus(streamId, status);
      router.refresh();
    });
  }
  return (
    <div className="flex items-center gap-1">
      <button
        title="Confirm"
        disabled={pending}
        onClick={() => set("active")}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-pos-soft text-pos hover:opacity-80"
      >
        <Check size={14} />
      </button>
      <button
        title="Not recurring"
        disabled={pending}
        onClick={() => set("dismissed")}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-neg-soft text-neg hover:opacity-80"
      >
        <X size={14} />
      </button>
    </div>
  );
}
