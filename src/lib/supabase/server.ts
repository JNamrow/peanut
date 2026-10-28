import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/** Cookie-bound client for server components / actions. Respects RLS. */
export async function createClient() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  // Forward the visitor's address so Supabase rate-limits per visitor, not per
  // server (needs "IP address forwarding" enabled in the project's Auth settings).
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
      global: forwardedFor ? { headers: { "x-forwarded-for": forwardedFor } } : undefined,
    },
  );
}
