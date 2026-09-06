import { expect, test, type Page, type Route } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * A width descriptor has to be the truth about its candidate.
 *
 * `MediaImage` used to write its set as `${thumbUrl} 360w, ${url} 1280w`.
 * Neither number came from anywhere — both were typed in, and neither variant
 * is normally either size. Measured against production, a preview that claimed
 * `1280w` was **154px** wide. A descriptor is not a hint the browser checks; it
 * is a promise it acts on and cannot verify, so the whole selection is decided
 * by the promise and never by the file.
 *
 * Both directions cost something real:
 *
 *   - **over-declared** — the browser thinks the candidate carries more detail
 *     than it does, picks it for a box it cannot fill, and upscales; or skips
 *     it for a full-size original nobody needed, and pays the bytes.
 *   - **under-declared** — the browser thinks the candidate is too small, and
 *     reaches past a perfectly good variant for the larger one.
 *
 * So the contract asserted here is not "the descriptor is not 360w" — that
 * describes one repair rather than the rule. It is: **every declared descriptor
 * equals the intrinsic width of the resource it names**, which is checked by
 * fetching each candidate and reading its `naturalWidth`. Written that way the
 * case fails for a number that is too big and for one that is too small, and it
 * keeps failing for any future descriptor that is invented rather than measured.
 */

const IMAGE_CHATS: ReadonlyArray<{ role: "tech_admin" | "client"; chatId: string }> = [
  { role: "tech_admin", chatId: "4a342924-bd00-42cb-ab89-e6b95a4abadd" },
  { role: "client", chatId: "02a3f32e-0973-4fb0-9001-5d270cb22cca" },
];

const PICTURE = 'button[aria-label="Открыть фото"] img';
/** The rows that carry every variant address and its real width. */
const VARIANT_QUERY = /\/rest\/v1\/media_variants/;

test.describe.configure({ timeout: 150_000 });

/**
 * A request only reaches `page.route` in WebKit while no service worker
 * controls the page — measured on one address: intercepted with
 * `navigator.serviceWorker.controller` still null, invisible to the route once
 * a reload had made the worker the controller, while `page.on("request")`
 * reported it either way. The second case here rewrites a response, so it
 * needs the worker out of the way; the first is unaffected and shares the
 * setting only so both run the same page.
 */
test.use({ serviceWorkers: "block" });

async function signIn(page: Page) {
  const role = findFirstAvailableQaRole(IMAGE_CHATS.map((entry) => entry.role));
  test.skip(!role, "QA credentials are not configured");
  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role!);
  return IMAGE_CHATS.find((entry) => entry.role === role)!;
}

/**
 * Opens the conversation and walks every picture through the viewport.
 *
 * `MediaImage` renders `loading="lazy"` and this chat opens with its
 * photographs thousands of pixels above the fold, so a visit that never
 * scrolls leaves every `<img>` unresolved and every assertion below vacuous.
 */
async function openChatAndRevealPictures(page: Page, chatId: string) {
  await page.goto(`/?chat=${chatId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(PICTURE).first()).toBeVisible({ timeout: 20_000 });
  const pictures = page.locator(PICTURE);
  const count = await pictures.count();
  for (let index = 0; index < count; index += 1) {
    await pictures.nth(index).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(3000);
  return count;
}

test("every width descriptor equals the real width of the file it names", async ({ page }) => {
  const target = await signIn(page);
  const pictures = await openChatAndRevealPictures(page, target.chatId);
  test.skip(pictures === 0, "this chat has no pictures to measure");

  const measured = await page.evaluate(async (selector) => {
    const images = [...document.querySelectorAll(selector)] as HTMLImageElement[];

    /** Reads a candidate's real width by loading it on its own. */
    const intrinsicWidth = (url: string) =>
      new Promise<number>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(probe.naturalWidth);
        probe.onerror = () => resolve(-1);
        probe.src = url;
      });

    const rows: Array<{ declared: number; actual: number; candidate: string; kind: string }> = [];
    let withSrcSet = 0;

    for (const image of images) {
      const srcSet = image.getAttribute("srcset");
      if (!srcSet) continue;
      withSrcSet += 1;
      // `url 154w, url 900w` — split before each address rather than on every
      // comma, so a comma inside an address cannot invent a candidate.
      for (const entry of srcSet.split(/\s*,\s*(?=https?:)/)) {
        const [candidate, descriptor] = entry.trim().split(/\s+/);
        if (!candidate) continue;
        rows.push({
          declared: Number.parseInt(descriptor ?? "", 10),
          actual: await intrinsicWidth(candidate),
          candidate: candidate.split("/").slice(-2).join("/").split("?")[0],
          kind: /thumb/.test(candidate) ? "thumb" : /variants\//.test(candidate) ? "preview" : "original",
        });
      }
    }
    return { total: images.length, withSrcSet, rows };
  }, PICTURE);

  // Without this the case passes on a page that declared nothing at all, which
  // is the one way a descriptor contract can be satisfied vacuously.
  expect(
    measured.withSrcSet,
    "no picture declared a srcset, so no descriptor was checked",
  ).toBeGreaterThan(0);
  expect(measured.rows.length).toBeGreaterThan(0);

  // Every candidate has to have loaded, or its width proves nothing.
  expect(
    measured.rows.filter((row) => row.actual <= 0),
    "a declared candidate could not be loaded, so its width could not be checked",
  ).toEqual([]);

  // The contract. Stated as a list so a failure names the offender, the number
  // it claimed and the number it is, rather than only that a count differed.
  expect(
    measured.rows
      .filter((row) => row.declared !== row.actual)
      .map((row) => `${row.kind} ${row.candidate}: declared ${row.declared}w, actually ${row.actual}px`),
    "a width descriptor does not match the file it names",
  ).toEqual([]);
});

test("a variant with no recorded width is described by no descriptor at all", async ({ page }) => {
  const target = await signIn(page);

  // `media_variants.width` is nullable, so this is a state the product has to
  // survive rather than a hypothetical: the row carries an address and no size.
  //
  // It is also the exact shape that caught a real hole. The width used for the
  // main candidate was briefly taken from `dimensions`, which is chosen on
  // `previewWidth && previewHeight` while the URL is chosen on `previewUrl` —
  // different conditions. Null the width and the element went on showing the
  // preview while describing it with the ORIGINAL's width, and no
  // `thumbWidth < mainWidth` guard could notice, because the original really is
  // the larger number. Stripping the width here is what makes that visible.
  let rewritten = 0;
  await page.route(VARIANT_QUERY, async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) {
      await route.fulfill({ response });
      return;
    }
    const stripped = body.map((row: Record<string, unknown>) => {
      if (row?.variant_kind !== "image_preview") return row;
      rewritten += 1;
      return { ...row, width: null, height: null };
    });
    await route.fulfill({ response, json: stripped });
  });

  const pictures = await openChatAndRevealPictures(page, target.chatId);
  test.skip(pictures === 0, "this chat has no pictures to measure");
  expect(rewritten, "no preview row was stripped, so nothing was tested").toBeGreaterThan(0);

  const state = await page.evaluate((selector) => {
    const images = [...document.querySelectorAll(selector)] as HTMLImageElement[];
    return images.map((image) => ({
      hasSrcSet: image.hasAttribute("srcset"),
      hasSizes: image.hasAttribute("sizes"),
      src: (image.getAttribute("src") ?? "").length > 0,
      painted: image.complete && image.naturalWidth > 0,
    }));
  }, PICTURE);

  expect(state.length).toBeGreaterThan(0);
  // Nothing may be guessed: with no width to declare there is no honest
  // descriptor, so the set and the sizes that steer it both go.
  expect(
    state.filter((entry) => entry.hasSrcSet).length,
    "a srcset was declared for a variant whose width is unknown",
  ).toBe(0);
  expect(
    state.filter((entry) => entry.hasSizes).length,
    "sizes was left behind without a srcset to steer",
  ).toBe(0);
  // And the picture still has to be a picture: `src` alone is correct, so
  // dropping the set must cost the resolution hint and nothing else.
  expect(state.every((entry) => entry.src), "a picture was left with no src").toBe(true);
  expect(state.filter((entry) => entry.painted).length).toBeGreaterThan(0);
});
