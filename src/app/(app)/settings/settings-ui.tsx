"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonCls, inputCls } from "@/components/ui";
import {
  deleteConnection,
  refreshFinancyNow,
  renewRiseupToken,
  syncConnectionNow,
  updateFinancyCredentials,
} from "../actions";
import type { Connection } from "@/lib/types";
import { RefreshCw, Trash2 } from "lucide-react";

/** What the Financy sync records about each bank linked inside Financy. */
interface FinancyBank {
  institution: string;
  status: string;
  expires: string | null;
}

export function ConnectionRow({ connection: c }: { connection: Connection }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const isRiseup = c.provider === "riseup";
  const isFinancy = c.provider === "financy";

  // Read the clock once per mount: the lint rule for render purity is right
  // that Date.now() in render is a side effect, and a day's precision is plenty.
  const [now] = useState(() => Date.now());
  const tokenAge = (() => {
    const created = (c.config as { token_created_at?: string })?.token_created_at;
    if (!created || !isRiseup) return null;
    return Math.floor((now - new Date(created).getTime()) / 86400000);
  })();
  const tokenWarning = tokenAge != null && tokenAge >= 25;

  const banks = isFinancy
    ? ((c.config as { financy_banks?: FinancyBank[] })?.financy_banks ?? [])
    : [];

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      setError(null);
      setNote(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

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
          {banks.length ? (
            <div className="text-[12px] text-muted">
              {banks.map((b, i) => (
                <span key={`${b.institution}-${i}`}>
                  {i > 0 ? " · " : ""}
                  {b.institution}{" "}
                  <span className={/ACTIVE|CONNECTED|COMPLETED/.test(b.status) ? "" : "text-neg"}>
                    {b.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                  {b.expires ? ` (consent to ${b.expires})` : ""}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {isRiseup ? (
            <button
              className={buttonCls("secondary", "sm")}
              onClick={() => setEditOpen((v) => !v)}
            >
              Renew token
            </button>
          ) : null}
          {isFinancy ? (
            <>
              <button
                className={buttonCls("secondary", "sm")}
                onClick={() => setEditOpen((v) => !v)}
              >
                Update credentials
              </button>
              <button
                className={buttonCls("secondary", "sm")}
                disabled={pending}
                title="Ask Financy to pull fresh data from your banks now. Financy charges 20 of its credits."
                onClick={() => {
                  if (
                    !confirm(
                      "Ask Financy to refresh your banks now? Financy charges 20 credits for this. The scheduled daily refresh is free.",
                    )
                  )
                    return;
                  run(async () => {
                    const result = await refreshFinancyNow(c.id);
                    if (result.error) setError(result.error);
                    else setNote(result.message ?? "Refresh requested.");
                  });
                }}
              >
                Refresh at Financy
              </button>
            </>
          ) : null}
          <button
            className={buttonCls("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              run(async () => {
                await syncConnectionNow(c.id);
                router.refresh();
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
              run(async () => {
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
      {note ? <p className="mt-1 text-[12.5px] text-ink-soft">{note}</p> : null}
      {editOpen && isRiseup ? (
        <form
          action={(fd) =>
            run(async () => {
              const result = await renewRiseupToken(c.id, fd);
              if (result.error) {
                setError(result.error);
                return;
              }
              setEditOpen(false);
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
      {editOpen && isFinancy ? (
        <form
          action={(fd) =>
            run(async () => {
              const result = await updateFinancyCredentials(c.id, fd);
              if (result.error) {
                setError(result.error);
                return;
              }
              setEditOpen(false);
              router.refresh();
            })
          }
          className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <input name="client_id" className={inputCls} placeholder="Client id" autoComplete="off" />
          <input
            name="client_secret"
            type="password"
            className={inputCls}
            placeholder="Client secret"
            autoComplete="off"
          />
          <input name="user_id" className={inputCls} placeholder="User id" autoComplete="off" />
          <button className={buttonCls("primary", "sm")} disabled={pending}>
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}
