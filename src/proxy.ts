import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh and route gating.
 *
 * Normal deployments: everything but /login and /contact needs a session.
 * Demo deployments (DEMO_MODE=1): /demo signs visitors in, /login is never
 * offered (it goes to /contact), and any app page without a session goes
 * back to /demo.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
      // Lets Supabase rate-limit by the visitor's address instead of the server's
      // (takes effect once "IP address forwarding" is on in the project's Auth settings).
      global: forwardedFor ? { headers: { "x-forwarded-for": forwardedFor } } : undefined,
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path.startsWith("/login");
  const isPublic = path === "/contact";
  const go = (to: string) => NextResponse.redirect(new URL(to, request.url));

  if (process.env.DEMO_MODE === "1") {
    if (isAuthPage) return go("/contact");
    if (path === "/") return go(user ? "/dashboard" : "/demo");
    if (path === "/demo") return user ? go("/dashboard") : response;
    if (!user && !isPublic) return go("/demo");
    return response;
  }

  if (!user && !isAuthPage && !isPublic) return go("/login");
  if (user && (isAuthPage || path === "/")) return go("/dashboard");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
