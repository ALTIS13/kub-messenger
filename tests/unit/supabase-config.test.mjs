import assert from "node:assert/strict";
import test from "node:test";

import { resolveSupabaseConfig } from "../../artifacts/kub/src/lib/supabase/config.ts";

// This closes the gap recorded in CLAUDE.md: the configured check had no direct
// coverage, so turning its `&&` into `||` left the whole suite green. A build
// with a URL and no key would then pass the gate in `App.tsx`, enter the routes
// and throw inside `createClient()` instead of rendering the configuration
// screen — and a URL without a key is a realistic Coolify misconfiguration, not
// a hypothetical one.

test("a build is configured only when it has both halves", () => {
  assert.equal(
    resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://core.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
    }).configured,
    true,
  );

  // The three ways to be short of it. The middle one is the case that used to
  // reach `createClient()` and throw.
  assert.equal(resolveSupabaseConfig({}).configured, false, "nothing configured");
  assert.equal(
    resolveSupabaseConfig({ VITE_SUPABASE_URL: "https://core.example.test" }).configured,
    false,
    "a URL with no key is not a usable build",
  );
  assert.equal(
    resolveSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: "publishable" }).configured,
    false,
    "a key with no URL is not a usable build",
  );

  // An empty string is a present-but-useless value, and `Boolean("")` is false
  // rather than throwing later. Deployments do produce these.
  assert.equal(
    resolveSupabaseConfig({ VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "publishable" })
      .configured,
    false,
    "an empty URL is not a URL",
  );
  assert.equal(
    resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://core.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      VITE_SUPABASE_ANON_KEY: "",
    }).configured,
    false,
    "an empty key is not a key",
  );
});

test("either key name works, and the publishable one wins", () => {
  // The fallback is the second operator worth pinning: a deployment may define
  // whichever of the two names, and the app has to run on either.
  assert.equal(
    resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://core.example.test",
      VITE_SUPABASE_ANON_KEY: "legacy",
    }).key,
    "legacy",
    "the legacy name alone still configures a build",
  );
  assert.equal(
    resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://core.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      VITE_SUPABASE_ANON_KEY: "legacy",
    }).key,
    "publishable",
    "with both present the publishable name is the one used",
  );
  // An empty publishable value must fall through rather than win: an empty
  // string is falsy, so the legacy name is what a half-migrated deployment has.
  assert.equal(
    resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://core.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      VITE_SUPABASE_ANON_KEY: "legacy",
    }).key,
    "legacy",
    "an empty publishable value falls through to the legacy name",
  );
});

test("the url is passed through untouched", () => {
  const url = "https://core.example.test/with/a/path?and=query";
  assert.equal(resolveSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: "k" }).url, url);
});
