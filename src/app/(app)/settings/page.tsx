import { getContext } from "@/lib/data";
import { Card, CardHeader, PageHeader, buttonCls, inputCls, selectCls } from "@/components/ui";
import { updateSpace } from "../actions";
import { ConnectionRow } from "./settings-ui";
import { PasswordForm } from "./password-form";
import type { Connection } from "@/lib/types";

export default async function SettingsPage() {
  const { supabase, space, members } = await getContext();
  const { data: connections } = await supabase
    .from("connections")
    .select("*")
    .eq("space_id", space.id)
    .order("created_at");

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-[760px] grid-cols-1 gap-4 px-6 pt-2">
        <Card>
          <CardHeader title="Household" />
          <form action={updateSpace} className="flex items-end gap-2.5 px-5 pb-4">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">Name</span>
              <input name="name" defaultValue={space.name} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">
                Primary currency
              </span>
              <select
                name="primary_currency"
                defaultValue={space.primary_currency}
                className={selectCls}
              >
                <option value="ILS">₪ ILS</option>
                <option value="USD">$ USD</option>
              </select>
            </label>
            <button className={buttonCls("secondary")}>Save</button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Members" sub="everyone sees everything" />
          <div className="px-5 pb-4">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2.5 py-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">
                  {(m.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="text-[13.5px] font-medium">{m.display_name}</span>
                <span className="text-[12px] text-muted">{m.role}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Password" sub="for your login" />
          <PasswordForm />
        </Card>

        <Card>
          <CardHeader title="Connections" />
          <div className="px-5 pb-4">
            {(connections ?? []).length === 0 ? (
              <p className="py-3 text-[13px] text-muted">
                No connections yet. Add one from the Accounts page.
              </p>
            ) : (
              ((connections ?? []) as Connection[]).map((c) => (
                <ConnectionRow key={c.id} connection={c} />
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
