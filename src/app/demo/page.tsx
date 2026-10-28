import { notFound } from "next/navigation";
import { after } from "next/server";
import { demoCredentials, isDemoDeployment } from "@/lib/demo/config";
import { demoSpaceExists, ensureDemoUsers, resetDemoIfStale } from "@/lib/demo/reset";
import { DemoEntry } from "./demo-entry";

export const dynamic = "force-dynamic";

/**
 * The one link visitors get. It makes sure the sandbox account is ready, kicks
 * off a rebuild when the data is older than two hours, and hands over to the
 * browser to sign in (from the visitor's own IP, so Supabase's per-address
 * sign-in limit is never shared between visitors).
 */
export default async function DemoPage() {
  if (!isDemoDeployment() || !demoCredentials()) notFound();
  const users = await ensureDemoUsers();
  if (await demoSpaceExists()) {
    after(() =>
      resetDemoIfStale(users).catch((e) => console.error("demo reset failed", e)),
    );
  } else {
    // First visit ever: build the household before anyone signs in.
    await resetDemoIfStale(users);
  }
  return <DemoEntry />;
}
