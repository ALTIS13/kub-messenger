import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Avatars used to be drawn from their originals.
 *
 * The pipeline has produced `avatar_128` and `avatar_256` all along, and the
 * picture component has always known how to use them — but only through a prop
 * that six of forty-two call sites passed, and `media_variants` would only let
 * you read your *own* profile's rows anyway, so somebody else's avatar could
 * not have used a variant even where the prop was passed.
 *
 * Measured on the administrator's user list, which is the densest avatar
 * surface in the product: 7 originals totalling 6,250 kB became 7 variants
 * totalling 20 kB.
 *
 * What this asserts is the part that matters and cannot be argued with: no
 * avatar original is fetched for a profile that has a variant.
 */
async function collectStorageRequests(page: import("@playwright/test").Page) {
  const requests: Array<{ url: string; bytes: number }> = [];
  page.on("requestfinished", async (request) => {
    if (!/storage\/v1\/object/.test(request.url())) return;
    const sizes = await request.sizes().catch(() => null);
    requests.push({ url: request.url(), bytes: sizes?.responseBodySize ?? 0 });
  });
  return requests;
}

test.describe("avatar preview sizing", () => {
  test("a dense avatar surface fetches variants and no originals", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "administrator QA credentials are not configured");

    const requests = await collectStorageRequests(page);
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users");
    // `.first()` has to be taken on the union, not on the left-hand side of it.
    // Written the other way round it only narrowed the badge, so the moment the
    // list had drawn more than one avatar the locator resolved to eight
    // elements and the case died of a strict mode violation instead of its
    // contract. Chromium happened to reach the assertion while a single badge
    // was on screen; WebKit reached it a beat later, with the avatars already
    // in — which is timing, not an engine difference.
    await expect(page.getByTestId("test-account-badge").or(page.locator("img")).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(6000);

    // What the circles are actually drawn from, read off the rendered page
    // rather than off the network.
    //
    // This used to be a request count with the HTTP cache switched off through
    // CDP, which is Chromium only: on `webkit-mobile-390` the case did not fail
    // on the contract, it failed on `browserContext.newCDPSession`. Swapping
    // one cache switch for another would not have helped either, because a
    // request WebKit answers from its cache never reaches `page.route` at all —
    // measured, three loads of one address produced one interception — so in
    // that engine a warm avatar is invisible to any network-shaped assertion
    // and an empty list of originals would have meant nothing.
    //
    // `currentSrc` is what the element resolved to, so a cached avatar counts
    // exactly like a freshly fetched one and the statement gets stronger rather
    // than weaker: not "no original was downloaded this time" but "no circle on
    // this page is drawn from an original".
    const drawnFrom = await page.evaluate(() => {
      const images = [...document.querySelectorAll("img")] as HTMLImageElement[];
      const fromBucket = images
        .map((image) => image.currentSrc || image.src)
        .filter((url) => /\/storage\/v1\/object\/public\/media\//.test(url));
      return {
        variants: fromBucket.filter((url) => /\/variants\/profiles\//.test(url)).length,
        originals: fromBucket.filter((url) => /\/media\/avatars\//.test(url)).length,
      };
    });

    const variants = requests.filter((entry) => /\/variants\/profiles\//.test(entry.url));
    const originals = requests.filter((entry) => /\/object\/public\/media\/avatars\//.test(entry.url));

    expect(drawnFrom.variants, "the page should be drawing avatars from variants").toBeGreaterThan(0);
    expect(drawnFrom.originals, "an avatar circle is drawn from an original").toBe(0);
    expect(
      originals.map((entry) => `${Math.round(entry.bytes / 1024)}KB ${entry.url.split("/").pop()}`),
      "an avatar original was downloaded to draw a small circle",
    ).toEqual([]);

    // A variant is small by construction; this guards against the day someone
    // points the variant path at the original. Only the ones actually fetched
    // on this visit can be weighed, which is why the contract above is stated
    // on the page instead.
    for (const entry of variants) {
      expect(entry.bytes, `${entry.url} is not a small variant`).toBeLessThan(120_000);
    }
  });

  test("a person can read someone else's avatar variant", async ({ page }) => {
    // The policy used to restrict `media_variants` to your own profile, which
    // is why every avatar but your own fell back to the original. The files
    // live in a public bucket, so this exposes nothing that was not already
    // fetchable — only the address of it.
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const captured = await page.waitForRequest(
      (request) => request.url().includes("/rest/v1/") && request.headers().apikey !== undefined,
      { timeout: 20_000 },
    );
    const headers = captured.headers();
    const origin = new URL(captured.url()).origin;

    const response = await page.request.get(
      `${origin}/rest/v1/media_variants?select=profile_id,variant_kind&variant_kind=in.(avatar_128,avatar_256)&limit=50`,
      { headers: { apikey: headers.apikey, authorization: headers.authorization } },
    );
    expect(response.status()).toBe(200);
    const rows = (await response.json()) as Array<{ profile_id: string | null }>;
    const mine = await page.evaluate(() => {
      const stored = localStorage.getItem("kub-auth");
      return stored ? (JSON.parse(stored)?.user?.id as string | undefined) : undefined;
    });
    expect(mine, "the probe needs a session to mean anything").toBeTruthy();
    expect(
      rows.some((row) => row.profile_id && row.profile_id !== mine),
      "only this person's own avatar variants were readable",
    ).toBe(true);
  });
});
