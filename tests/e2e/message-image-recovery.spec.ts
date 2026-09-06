import { expect, test, type Page, type Route } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * A picture in a chat must survive one failed request.
 *
 * The owner reported media that would not load until the page was reloaded.
 * Everything behind it measured clean — the objects are served, the variant
 * rows are `ready`, and a whole session of chat switching renders every picture
 * from its variant. What was not clean is what a bubble does after a single
 * failure: `MediaImage` latched an error box and never rendered an `<img>`
 * again, so the preview variant that arrived a moment later had nothing to load
 * into. Measured before the fix, one aborted request left the bubble reading
 * "Не удалось загрузить изображение" 28 seconds later in the same chat, and only
 * F5 cleared it.
 *
 * Two recoveries are asserted here, the two the video bubbles in the same file
 * already had:
 *
 *   1. a failed *variant* hands the bubble back to the original;
 *   2. a failed *first request* is recovered rather than latched.
 *
 * Both are asserted on rendered pixels (`naturalWidth`), not on the absence of
 * the error text, so a bubble that quietly renders a broken image cannot pass.
 *
 * Two things about the shape of this file were learned by measurement, and both
 * are load-bearing:
 *
 * **The pictures have to be brought into the viewport.** `MediaImage` renders
 * `loading="lazy"`, and this chat opens at the bottom with its photographs
 * around five thousand pixels above the fold — measured, `top: -5138`. A visit
 * that never scrolls therefore issues *no image request at all*, in either
 * engine, and both cases here used to fail on their own "nothing was tested"
 * guards rather than on the contract. Playwright's `toBeVisible()` does not
 * mean "in the viewport", so it cannot stand in for this.
 *
 * **Nothing here may disable the HTTP cache through CDP.** That is Chromium
 * only, and it is why both cases failed outright on `webkit-mobile-390`. The
 * substitute is not another cache switch: it is registering the interception
 * *before the first visit*, while the cache of a freshly made context is still
 * cold, so the requests under test are real network trips the first time they
 * happen. That matters more in WebKit than the CDP call ever did — measured, a
 * request answered from WebKit's cache never reaches `page.route` at all (three
 * loads of one address, one interception), so a route registered after a warm
 * visit silently intercepts nothing.
 */

// Chats whose pictures all have a `ready` preview and thumb, so the recovery
// under test is never waiting on a variant that does not exist.
const IMAGE_CHATS: ReadonlyArray<{ role: "tech_admin" | "client"; chatId: string }> = [
  { role: "tech_admin", chatId: "4a342924-bd00-42cb-ab89-e6b95a4abadd" },
  { role: "client", chatId: "02a3f32e-0973-4fb0-9001-5d270cb22cca" },
];

/**
 * Anything served out of the media bucket.
 *
 * Deliberately wider than a message's own objects: a variant does not live
 * under the owner's id at all — it is `media/variants/messages/...` — so a
 * pattern shaped like the original's path matches no variant and quietly
 * intercepts nothing. Each test narrows this itself.
 */
const MEDIA_OBJECT = /\/storage\/v1\/object\/public\/media\//;
/** Only a message's own variants. An avatar's are another surface's business. */
const MESSAGE_VARIANT = /variants\/messages\//;
const IMAGE_ERROR_TEXT = "Не удалось загрузить изображение";

// Signing in, opening a chat and walking every picture through the viewport
// does not fit the suite's default budget. The waits are the assertion here.
test.describe.configure({ timeout: 150_000 });

/**
 * Both cases here work by breaking a request, so both need the request to
 * reach `page.route` — and in WebKit a request does not, once a service worker
 * controls the page.
 *
 * Measured, on one page and one address: while `navigator.serviceWorker
 * .controller` was still null the image was intercepted; after a reload made
 * the worker the controller, the same request was reported by `page.on
 * ("request")` and never handed to the route. Chromium intercepted both. That
 * is the whole reason these two cases failed on `webkit-mobile-390` with
 * "nothing was tested" while the pictures on screen were perfectly fine: the
 * suite was breaking requests that no longer passed through it.
 *
 * Blocking the worker costs this spec nothing. `sw.js` returns early for every
 * Supabase address (`if (isSupabaseUrl(url)) return;`) and for anything
 * cross-origin, so it never serves, caches or rewrites a media object — the
 * pictures under test take the same path either way.
 */
test.use({ serviceWorkers: "block" });

/**
 * The pictures in the message stream, and whether they actually have pixels.
 *
 * Scoped by the bubble's own control rather than by URL, so avatars — which
 * live in the same bucket and have their own fallback rules — cannot decide
 * the result either way.
 *
 * `unpaintedInViewport` is the owner's report stated as a number: a bubble
 * whose box is laid out at the right size while nothing has been drawn into it
 * is the empty rectangle from the screenshot, and it is invisible to a `broken`
 * count because an image that never finished is not `complete` either.
 */
async function readMessagePictures(page: Page) {
  return await page.evaluate(() => {
    const images = [...document.querySelectorAll('button[aria-label="Открыть фото"] img')] as HTMLImageElement[];
    const painted = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0;
    const inViewport = (image: HTMLImageElement) => {
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
    };
    return {
      total: images.length,
      painted: images.filter(painted).length,
      // Asked for and answered with nothing. A picture still below the fold is
      // not complete at all and is neither painted nor broken.
      broken: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      unpaintedInViewport: images.filter((image) => inViewport(image) && !painted(image)).length,
      fromVariant: images.filter((image) => /variants\//.test(image.currentSrc || image.src)).length,
    };
  });
}

async function signIn(page: Page) {
  const role = findFirstAvailableQaRole(IMAGE_CHATS.map((entry) => entry.role));
  test.skip(!role, "QA credentials are not configured");
  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role!);
  return IMAGE_CHATS.find((entry) => entry.role === role)!;
}

async function openChat(page: Page, chatId: string) {
  await page.goto(`/?chat=${chatId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('button[aria-label="Открыть фото"] img').first()).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Walks every picture through the viewport, which is what a reader scrolling
 * the conversation does and what a lazy image waits for.
 *
 * Indexed rather than iterated over a captured list because scrolling loads
 * older history, so the collection can grow while this runs.
 */
async function bringPicturesIntoView(page: Page) {
  const pictures = page.locator('button[aria-label="Открыть фото"] img');
  const count = await pictures.count();
  for (let index = 0; index < count; index += 1) {
    await pictures.nth(index).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(900);
  }
  return count;
}

test("a picture whose variant fails falls back to the original", async ({ page }) => {
  const target = await signIn(page);

  // Registered before the first visit, so every variant request under test is a
  // cold, real network trip. Breaking them all leaves the originals — which are
  // not variants and are not intercepted — as the only way a bubble can paint,
  // so a picture with pixels at the end of this is proof of the fallback.
  let abortedVariants = 0;
  await page.route(MEDIA_OBJECT, async (route: Route) => {
    if (MESSAGE_VARIANT.test(route.request().url())) {
      abortedVariants += 1;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await openChat(page, target.chatId);
  const pictures = await bringPicturesIntoView(page);
  test.skip(pictures === 0, "this chat has no pictures, so there is no fallback to exercise");
  await page.waitForTimeout(6000);

  expect(abortedVariants, "no variant request was intercepted, so nothing was tested")
    .toBeGreaterThan(0);
  const after = await readMessagePictures(page);
  expect(await page.getByText(IMAGE_ERROR_TEXT).count()).toBe(0);
  expect(after.total).toBeGreaterThan(0);
  expect(after, "a picture was asked for and came back with no pixels").toMatchObject({ broken: 0 });
  // The bubble must have gone back to the original rather than sitting on a
  // variant address that answered nothing.
  expect(after.fromVariant, "a bubble is still pointed at a variant that failed").toBe(0);
  expect(after.painted).toBeGreaterThan(0);
});

test("a picture whose first request fails recovers when its variant arrives", async ({ page }) => {
  const target = await signIn(page);

  // Kill exactly one of a message picture's requests — a blip, a dropped
  // connection, a rate limit — and leave everything else alone.
  //
  // Which address that first request carries is deliberately not assumed. The
  // case was written when a bubble painted before its variants were known, so
  // its first request was for the original; with `loading="lazy"` the variant
  // is resolved long before the picture reaches the viewport, and measured
  // against production every message request is now a variant and no original
  // is fetched at all. Pinning the original made the case unfireable in both
  // engines. What has to hold is the same either way: one failure must not
  // leave a permanently empty bubble.
  let killed = false;
  let killedWasVariant = false;
  await page.route(MEDIA_OBJECT, async (route: Route) => {
    const request = route.request();
    const url = request.url();
    // A message's own media, told apart from an avatar living in the same
    // bucket by the chat id its name carries — a message variant keeps that id
    // in the path too.
    const isThisChatsPicture = url.includes(target.chatId);
    if (!killed && request.resourceType() === "image" && isThisChatsPicture) {
      killed = true;
      killedWasVariant = MESSAGE_VARIANT.test(url);
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await openChat(page, target.chatId);
  const pictures = await bringPicturesIntoView(page);
  test.skip(pictures === 0, "this chat has no pictures, so there is no failure to recover from");
  // Long enough that the variant query has answered many times over. What this
  // pins is permanent, not slow: the error box outlived 28 seconds of waiting
  // in the same chat with no reload.
  await page.waitForTimeout(9000);

  expect(killed, "no picture request was intercepted, so nothing was tested").toBe(true);
  const after = await readMessagePictures(page);
  expect(await page.getByText(IMAGE_ERROR_TEXT).count()).toBe(0);
  expect(after.total).toBeGreaterThan(0);
  expect(after, "a picture was asked for and came back with no pixels").toMatchObject({ broken: 0 });
  expect(
    after.unpaintedInViewport,
    `a picture is laid out but empty after one failed ${killedWasVariant ? "variant" : "original"} request`,
  ).toBe(0);
  expect(after.painted).toBeGreaterThan(0);
});
