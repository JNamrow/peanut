/**
 * Public demo sandbox.
 *
 * A deployment with DEMO_MODE=1 serves one fictional household and nothing
 * else: /demo signs visitors in, /login is unreachable, and anything that would
 * reach a bank, a provider or file storage is switched off. The sandbox is
 * rebuilt from the generator in ./seed every DEMO_RESET_MS.
 */

export const DEMO_RESET_MS = 2 * 60 * 60 * 1000;
export const REPO_URL = "https://github.com/JNamrow/peanut";

export const DEMO_BLOCKED =
  "This is the shared demo, so bank connections, syncing and uploads are off. Get Peanut on GitHub to run it with your own accounts.";

export function isDemoDeployment(): boolean {
  return process.env.DEMO_MODE === "1";
}

/** The sandbox login. Public by design: the account can only see the demo household. */
export function demoCredentials(): { email: string; password: string } | null {
  const email = process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
  return email && password ? { email, password } : null;
}

export function contactEmail(): string | null {
  return process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;
}
