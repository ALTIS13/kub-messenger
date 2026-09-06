/**
 * Resolving the public Supabase configuration, as a pure function.
 *
 * This lived inline in `client.ts` and could not be tested, because that module
 * reads `import.meta.env` at load and imports supabase-js — neither of which a
 * `node --test` process has. The consequence was recorded rather than fixed for
 * some time: mutating the `&&` in the configured check to `||` left the entire
 * suite green, while a half-configured build — a URL present and no key, which
 * is a realistic Coolify misconfiguration — would pass the gate in `App.tsx`,
 * enter the routes and throw inside `createClient()` instead of rendering the
 * configuration screen.
 *
 * Two operators decide this and both are worth a test. The `&&` says a build is
 * configured only when it has both halves. The `||` is the key's fallback: the
 * publishable name is preferred and the legacy anon name still works, so that
 * whichever of the two a deployment happens to define, the app runs.
 *
 * No imports, deliberately. That is what makes it reachable from the unit
 * suite, and the reason to keep it in its own file rather than beside the
 * client.
 */

export interface SupabasePublicEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export interface SupabaseConfig {
  url: string | undefined;
  key: string | undefined;
  /** Both halves present. A build with one of them is not "partly" usable. */
  configured: boolean;
}

export function resolveSupabaseConfig(env: SupabasePublicEnv): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  return { url, key, configured: Boolean(url && key) };
}
