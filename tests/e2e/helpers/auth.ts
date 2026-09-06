import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

export type QaCredentials = {
  email: string;
  password: string;
};

export type QaRole = "owner" | "tech_admin" | "location_admin" | "location_staff" | "client";
export type QaAuthStateName = QaRole | "default";

export const QA_ROLES: QaRole[] = [
  "owner",
  "tech_admin",
  "location_admin",
  "location_staff",
  "client",
];

const AUTH_STATE_PATH = path.join(process.cwd(), "output", "e2e-auth-state.json");
const AUTH_STATE_DIR = path.join(process.cwd(), "output", "playwright-auth");

export function loadQaEnvValues(): Map<string, string> {
  const envFile = process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env");
  const values = new Map<string, string>();

  if (fs.existsSync(envFile)) {
    for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = line
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      values.set(key, value);
    }
  }

  return values;
}

export function loadQaCredentials(role: QaRole | "default" = "default"): QaCredentials | null {
  const values = loadQaEnvValues();
  const keys =
    role === "default"
      ? { email: "KUB_QA_EMAIL", password: ["KUB", "QA", "PASSWORD"].join("_") }
      : {
          email: ["KUB", "QA", role.toUpperCase(), "EMAIL"].join("_"),
          password: ["KUB", "QA", role.toUpperCase(), "PASSWORD"].join("_"),
        };
  const email = process.env[keys.email] || values.get(keys.email);
  const password = process.env[keys.password] || values.get(keys.password);
  if (!email || !password) return null;
  return { email, password };
}

export function findFirstAvailableQaRole(
  roles: QaRole[],
  options?: { includeDefault?: boolean },
): QaAuthStateName | null {
  for (const role of roles) {
    if (loadQaCredentials(role) || hasSavedAuthState(role)) return role;
  }
  if (options?.includeDefault && (loadQaCredentials("default") || hasSavedAuthState("default")))
    return "default";
  return null;
}

export function getAuthStatePath(name: QaAuthStateName = "default"): string {
  if (name === "default") return AUTH_STATE_PATH;
  return path.join(AUTH_STATE_DIR, `${name}.json`);
}

export function hasSavedAuthState(name: QaAuthStateName = "default"): boolean {
  return fs.existsSync(getAuthStatePath(name));
}

export async function gotoOrSkip(page: Page, pathName: string) {
  const response = await page.goto(pathName, { waitUntil: "domcontentloaded" }).catch(() => null);
  test.skip(!response, `KUB_BASE_URL is not reachable: ${test.info().project.use.baseURL}`);
}

/**
 * Positive proof that the browser is inside the authenticated shell.
 *
 * Everything here used to be inferred from the *absence* of a password field,
 * which stopped meaning anything the moment a guest at "/" was given the public
 * home instead of the login form: there is no password field on a marketing
 * page either. Every authenticated spec then ran as a guest, and the
 * "authenticated smoke" suite passed without ever signing in.
 *
 * The sidebar menu button only exists once a session is loaded, so it is the
 * marker. A helper that can only say "I did not see a login form" cannot tell
 * signed-in from signed-out, and must not be trusted to.
 *
 * That marker alone was not enough. `inert` and `aria-hidden` do not hide an
 * element, they take it out of the accessibility tree — so while the mandatory
 * update gate blocks the shell (`MainLayout` carries both), the button is drawn
 * and on screen and yet no role query can reach it. The helper called a
 * signed-in client signed out, and `critical_update` failed on a session it
 * already had.
 *
 * `desktop-app-shell` is the fallback because it survives that while staying
 * positive proof: `MainLayout` is the only thing that renders it, and `App.tsx`
 * sends anyone without a session to `/login` before `MainLayout` can mount, so
 * it cannot be on screen for a guest. `app-top-bar` was rejected for exactly
 * the property this one has to keep — `PublicPreviewCapturePage` renders
 * `AppTopBar` on a public route, so it can appear with no session behind it.
 */
async function waitForAuthenticatedShell(page: Page, timeout = 15_000): Promise<boolean> {
  const onScreen = (locator: Locator) => locator.first().waitFor({ state: "visible", timeout });

  // Raced rather than tried in turn. A fallback that only starts once the
  // primary has spent the whole budget would double the ceiling its caller
  // budgeted against the 45s test timeout. `Promise.any` settles as soon as
  // either marker appears and rejects only when both are absent.
  return await Promise.any([
    onScreen(page.getByRole("button", { name: "Меню" })),
    onScreen(page.getByTestId("desktop-app-shell")),
  ])
    .then(() => true)
    .catch(() => false);
}

/**
 * Navigates to the login form on whatever page it is given.
 *
 * A relative path needs a `baseURL`, and a page attached to the native shell's
 * WebView over the debug port has none — Chromium rejects it outright with
 * "Cannot navigate to invalid URL". That is how the Windows startup scenario
 * broke when this helper started navigating for itself: it works for a browser
 * page configured with a base and fails for the shell. Resolving against the
 * page's own origin covers both.
 */
async function gotoLogin(page: Page): Promise<void> {
  const current = page.url();
  const target = /^https?:\/\//.test(current) ? new URL("/login", current).toString() : "/login";
  await page.goto(target, { waitUntil: "domcontentloaded" });
}

export async function loginIfNeeded(
  page: Page,
  credentials: QaCredentials,
  options: { authStateName?: QaAuthStateName } = {},
) {
  const authStateName = options.authStateName ?? "default";
  await restoreAuthState(page, authStateName);

  // Timings are budgeted against the 45s per-test timeout: an over-generous
  // helper gets torn down mid-sign-in and reports a closed page instead of a
  // failed login. The happy path costs a couple of seconds; these ceilings only
  // apply when something is actually wrong.
  if (await waitForAuthenticatedShell(page, 6_000)) {
    await saveAuthState(page, authStateName);
    return;
  }

  // The form lives at /login and nowhere else. Callers all start at "/", which
  // no longer shows it, so getting there is this helper's job rather than a
  // side effect of a redirect that no longer happens.
  await gotoLogin(page);

  const emailInput = page.locator('input[type="email"]').first();
  const formVisible = await emailInput
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (!formVisible) {
    // A live session bounces /login straight back into the app, so a missing
    // form is success rather than a fault. Slower viewports reach the shell
    // after the first check above has already given up on it.
    let restored = await waitForAuthenticatedShell(page, 6_000);

    if (!restored) {
      // Third possibility, and the one that produced an intermittent failure in
      // otherwise green runs: neither, because the app is sitting on its own
      // "Загрузка длится дольше обычного" panel with a stalled session restore.
      // That panel offers "Выйти", which drops the stuck session and gives back
      // the login form — so use the escape hatch the product already provides
      // rather than waiting longer for something that is not coming.
      //
      // The button is WAITED for rather than probed once. The app shows a plain
      // "Загрузка" first and only offers the escape after its own patience runs
      // out, so a single visibility check a moment too early found nothing and
      // the run lost the test to a condition that was about to be recoverable.
      const signOut = page.getByRole("button", { name: "Выйти" }).first();
      const escapeOffered = await signOut
        .waitFor({ state: "visible", timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      if (escapeOffered) {
        await signOut.click();
        await gotoLogin(page);
        const recovered = await emailInput
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (recovered) return await signInWithForm(page, credentials, authStateName);
      }
      restored = await waitForAuthenticatedShell(page, 4_000);
    }

    expect(restored, "neither the login form nor the authenticated shell appeared at /login").toBe(
      true,
    );
    await saveAuthState(page, authStateName);
    return;
  }

  return await signInWithForm(page, credentials, authStateName);
}

/** Fills the form that is already on screen and proves the shell was reached. */
async function signInWithForm(
  page: Page,
  credentials: QaCredentials,
  authStateName: QaAuthStateName,
) {
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submit = page.locator('button[type="submit"]').first();

  let authenticated = false;
  for (let attempt = 0; attempt < 2 && !authenticated; attempt += 1) {
    await expect(emailInput).toBeEditable();
    await emailInput.fill(credentials.email);
    await expect(passwordInput).toBeEditable();
    await passwordInput.fill(credentials.password);
    await expect(submit).toBeEnabled();
    await submit.click();
    authenticated = await waitForAuthenticatedShell(page, 11_000);
  }

  expect(
    authenticated,
    "sign-in did not reach the authenticated shell; the suite would otherwise have run as a guest",
  ).toBe(true);

  // Only ever persist a state that is actually signed in. Saving unconditionally
  // is how a guest visit overwrote a role's stored session with nothing but the
  // release-catalog cache.
  await saveAuthState(page, authStateName);
}

/**
 * Signs in through the form every time, and never touches the saved state.
 *
 * For the two-device suite this is the point rather than an inefficiency. A
 * saved storage state carries one refresh token, and Supabase rotates refresh
 * tokens on use — so restoring the same state into two contexts gives them one
 * token family to fight over and produces failures no real pair of devices
 * would ever see. Two devices each sign in for themselves.
 *
 * It also skips rather than restores when only a saved state exists: this
 * helper cannot manufacture a second independent session out of one.
 */
export async function signInFreshOrSkip(page: Page, role: QaRole) {
  const credentials = loadQaCredentials(role);
  test.skip(
    !credentials,
    `QA credentials for '${role}' are required; a saved auth state cannot give two independent sessions`,
  );
  if (!credentials) return;

  await gotoLogin(page);
  const emailInput = page.locator('input[type="email"]').first();
  await expect(emailInput).toBeEditable({ timeout: 20_000 });
  await emailInput.fill(credentials.email);
  const passwordInput = page.locator('input[type="password"]').first();
  await expect(passwordInput).toBeEditable();
  await passwordInput.fill(credentials.password);
  await page.locator('button[type="submit"]').first().click();

  expect(
    await waitForAuthenticatedShell(page, 25_000),
    `sign-in as '${role}' did not reach the authenticated shell`,
  ).toBe(true);
}

export async function loginAsRoleOrSkip(page: Page, role: QaAuthStateName) {
  const credentials = loadQaCredentials(role);
  const hasState = hasSavedAuthState(role);
  test.skip(
    !credentials && !hasState,
    `QA auth state or credentials for '${role}' are not configured`,
  );

  if (credentials) {
    await loginIfNeeded(page, credentials, { authStateName: role });
    return;
  }

  await restoreAuthState(page, role);
  const authenticated = await waitForAuthenticatedShell(page, 8_000);
  test.skip(
    !authenticated,
    `Saved auth state for '${role}' is expired and credentials are not configured`,
  );
}

/**
 * Whether a saved state still holds a session that can be used.
 *
 * A saved session lasts about an hour, so any run started later than that
 * restores a dead one: the app boots, fails to refresh the token, and lands on
 * the public home, after which every test pays the full six-second shell
 * timeout before falling back to the login form it could have gone to
 * immediately.
 *
 * This is worth stating precisely, because a wrong version of it was written
 * here first: an intermittent "neither the login form nor the authenticated
 * shell appeared" failure is NOT known to be caused by this. The first attempt
 * to measure it compared a state saved for `127.0.0.1:5191` against production
 * and read the resulting public home as proof of expiry, when the helper had
 * simply — and correctly — declined to restore a state from another origin.
 * The expiry check earns its place by removing a per-run cost that is
 * measurable on its own; the flake remains unexplained.
 *
 * A minute of margin, because a session that expires mid-test is no better than
 * one that has already expired.
 */
export function hasLiveSession(entries: { name: string; value: string }[]): boolean {
  const cutoff = Date.now() / 1000 + 60;
  for (const entry of entries) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.value);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const expiresAt = (parsed as { expires_at?: unknown }).expires_at;
    if (typeof expiresAt === "number") return expiresAt > cutoff;
  }
  // No entry carried an expiry, so nothing here claims to be a session. Let the
  // caller sign in rather than guessing that some other key will work.
  return false;
}

async function restoreAuthState(page: Page, name: QaAuthStateName = "default") {
  const statePath = getAuthStatePath(name);
  if (!fs.existsSync(statePath)) return;
  const origin = new URL(page.url()).origin;
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    origins?: { origin: string; localStorage?: { name: string; value: string }[] }[];
  };
  const state = raw.origins?.find((item) => item.origin === origin);
  if (!state?.localStorage?.length) return;

  if (!hasLiveSession(state.localStorage)) {
    // Delete it rather than leave it to be retried by the next test: a stale
    // file that keeps being restored is a per-test tax with no upside.
    fs.rmSync(statePath, { force: true });
    return;
  }

  await page.evaluate((entries) => {
    for (const entry of entries) {
      window.localStorage.setItem(entry.name, entry.value);
    }
  }, state.localStorage);
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function saveAuthState(page: Page, name: QaAuthStateName = "default") {
  const statePath = getAuthStatePath(name);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  await page.context().storageState({ path: statePath });
}
