import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { backfillFx } from "@/lib/sync/fx";
import { DEMO_RESET_MS, demoCredentials } from "./config";
import { buildDemoData, DEMO_SPACE_ID, type DemoData } from "./seed";

export interface DemoUsers {
  userId: string;
  partnerId: string;
}

type Admin = ReturnType<typeof createAdminClient>;

const CHUNK = 500;

/** Insert order: every table after the ones it references. */
const INSERT_ORDER: (keyof DemoData & string)[] = [
  "connections",
  "accounts",
  "categories",
  "category_aliases",
  "category_rules",
  "recurring_streams",
  "transactions",
  "transaction_events",
  "budgets",
  "goals",
  "goal_accounts",
  "holdings",
  "pension_configs",
  "forecast_settings",
  "forecast_incomes",
  "forecast_events",
  "forecast_splits",
  "account_balance_snapshots",
];

/** Delete order. Accounts cascade to snapshots, holdings, pensions, goal links and splits; categories to budgets, aliases and rules. */
const DELETE_ORDER = [
  "transactions",
  "recurring_streams",
  "goals",
  "forecast_events",
  "forecast_incomes",
  "forecast_settings",
  "category_rules",
  "category_aliases",
  "budgets",
  "categories",
  "accounts",
  "connections",
];

function must<T extends { error: { message: string } | null }>(what: string) {
  return (res: T): T => {
    if (res.error) throw new Error(`demo reset: ${what}: ${res.error.message}`);
    return res;
  };
}

async function findUserByEmail(admin: Admin, email: string): Promise<string | null> {
  // The demo project holds a handful of users, so one page is enough.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`demo reset: list users: ${error.message}`);
  const wanted = email.toLowerCase();
  return data.users.find((u) => u.email?.toLowerCase() === wanted)?.id ?? null;
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Makes sure the two household members exist as auth users and that the
 * visitor account still has the published password. A visitor could change it
 * through the Supabase API, so every entry puts it back.
 */
export async function ensureDemoUsers(): Promise<DemoUsers> {
  const creds = demoCredentials();
  if (!creds) throw new Error("NEXT_PUBLIC_DEMO_EMAIL and NEXT_PUBLIC_DEMO_PASSWORD must be set");
  const admin = createAdminClient();
  const partnerEmail = creds.email.replace("@", "+partner@");

  let userId = await findUserByEmail(admin, creds.email);
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email: creds.email,
      password: creds.password,
      email_confirm: true,
    });
    if (error) throw new Error(`demo reset: reset password: ${error.message}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: creds.email,
      password: creds.password,
      email_confirm: true,
      user_metadata: { demo: true },
    });
    if (error || !data.user) throw new Error(`demo reset: create user: ${error?.message}`);
    userId = data.user.id;
  }

  let partnerId = await findUserByEmail(admin, partnerEmail);
  if (!partnerId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: partnerEmail,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: { demo: true },
    });
    if (error || !data.user) throw new Error(`demo reset: create partner: ${error?.message}`);
    partnerId = data.user.id;
  }
  return { userId, partnerId };
}

/** A fresh project has no exchange rates; load the real daily series once. */
async function ensureFxRates(admin: Admin): Promise<void> {
  const { count } = await admin.from("fx_rates").select("*", { count: "exact", head: true });
  if ((count ?? 0) >= 200) return;
  await backfillFx(2024);
}

export async function demoSpaceExists(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("spaces").select("id").eq("id", DEMO_SPACE_ID).maybeSingle();
  return Boolean(data);
}

/** Wipes the demo household and rebuilds it from the generator. */
export async function resetDemoSpace(users: DemoUsers, now = new Date()): Promise<number> {
  const admin = createAdminClient();
  const data = buildDemoData(now, users);
  const space = data.spaces[0];
  await ensureFxRates(admin);

  await admin
    .from("spaces")
    .upsert(
      {
        id: DEMO_SPACE_ID,
        name: space.name,
        primary_currency: space.primary_currency,
        is_demo: true,
        demo_reset_at: now.toISOString(),
      },
      { onConflict: "id" },
    )
    .then(must("space"));
  // Membership stays in place through the rebuild, so a visitor who is mid-page
  // sees an empty household for a moment instead of an error.
  await admin
    .from("space_members")
    .upsert(data.space_members, { onConflict: "space_id,user_id" })
    .then(must("members"));

  for (const table of DELETE_ORDER) {
    await admin.from(table).delete().eq("space_id", DEMO_SPACE_ID).then(must(`clear ${table}`));
  }

  let rows = 0;
  for (const table of INSERT_ORDER) {
    const list = data[table] as unknown as Record<string, unknown>[];
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      await admin.from(table).insert(slice).then(must(`insert ${table}`));
      rows += slice.length;
    }
  }
  return rows;
}

/**
 * Rebuilds the sandbox when the last reset is older than DEMO_RESET_MS.
 * The timestamp is claimed first (compare-and-set on the space row), so two
 * visitors arriving together never run two resets.
 */
export async function resetDemoIfStale(users: DemoUsers): Promise<"reset" | "fresh"> {
  const admin = createAdminClient();
  const { data: space } = await admin
    .from("spaces")
    .select("id")
    .eq("id", DEMO_SPACE_ID)
    .maybeSingle();
  if (!space) {
    await resetDemoSpace(users);
    return "reset";
  }
  const cutoff = new Date(Date.now() - DEMO_RESET_MS).toISOString();
  const { data: claimed, error } = await admin
    .from("spaces")
    .update({ demo_reset_at: new Date().toISOString() })
    .eq("id", DEMO_SPACE_ID)
    .or(`demo_reset_at.is.null,demo_reset_at.lt.${cutoff}`)
    .select("id");
  if (error) throw new Error(`demo reset: claim: ${error.message}`);
  if (!claimed?.length) return "fresh";
  await resetDemoSpace(users);
  return "reset";
}
