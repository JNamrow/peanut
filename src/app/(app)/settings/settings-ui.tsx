"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonCls, inputCls } from "@/components/ui";
import { deleteConnection, renewRiseupToken, syncConnectionNow } from "../actions";
import type { Connection } from "@/lib/types";
import { RefreshCw, Trash2 } from "lucide-react";

export function ConnectionRow({ connection: c }: { connection: Connection }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renewOpen, setRenewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenAge = (() => {
    const created = (c.config as { token_created_at?: string })?.token_created_at;
    if (!created || c.provider !== "riseup") return null;
    return Math.floor((Date.now() - new Date(created).getTime()) / 86400000);
  })();
  const tokenWarning = tokenAge != null && tokenAge >= 25;

  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-medium">
            {c.label ?? c.institution_name ?? c.provider}
            <span className="ml-2 text-[11.5px] font-normal text-muted">
              {c.provider}
            </span>
          </div>
          <div className="text-[12px] text-muted">
            {c.status === "error" ? (
              <span className="text-neg">Error: {c.error}</span>
            ) : c.last_synced_at ? (
              `Synced ${new Date(c.last_synced_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            ) : (
              "Never synced"
            )}
            {tokenAge != null ? (
              <span className={tokenWarning ? "ml-2 font-medium text-accent" : "ml-2"}>
                · token age {tokenAge}d{tokenWarning ? " — renew soon (30d limit)" : ""}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {c.provider === "riseup" ? (
            <button
              className={buttonCls("secondary", "sm")}
              onClick={() => setRenewOpen((v) => !v)}
            >
              Renew token
            </button>
          ) : null}
          <button
            className={buttonCls("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  await syncConnectionNow(c.id);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Sync failed");
                }
              })
            }
          >
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> Sync
          </button>
          <button
            className={buttonCls("ghost", "sm")}
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this connection? Its accounts stay, syncing stops.")) return;
              startTransition(async () => {
                await deleteConnection(c.id);
                router.refresh();
              });
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-[12.5px] text-neg">{error}</p> : null}
      {renewOpen ? (
        <form
          action={(fd) =>
            startTransition(async () => {
              setError(null);
              const result = await renewRiseupToken(c.id, fd);
              if (result.error) {
                setError(result.error);
                return;
              }
              setRenewOpen(false);
              router.refresh();
            })
          }
          className="mt-2 flex gap-2"
        >
          <input name="token" className={inputCls} placeholder="riseup_pat_… (new token)" />
          <button className={buttonCls("primary", "sm")} disabled={pending}>
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}
