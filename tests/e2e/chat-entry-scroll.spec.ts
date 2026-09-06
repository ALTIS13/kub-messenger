import { expect, test, type Page } from "@playwright/test";

/**
 * D-037: entering a chat must not show the reader the wrong place first.
 *
 * A freshly mounted message list starts at `scrollTop = 0`, which is the top of
 * the loaded history. Every correction used to be deferred by at least one
 * `requestAnimationFrame` from a passive effect, so the browser painted that
 * uncorrected commit before the correction ran. Measured against a real chat on
 * production data, three frames were painted at the top of a 3683px history —
 * 2790px from the bottom, for 88ms — and the list then snapped down. That is
 * what "дёргается интерфейс вверх и вниз на мгновение" is describing.
 *
 * The anchoring itself is a contract (CLAUDE.md section 11) and is unchanged:
 * same target, same rules, same guards. What changed is the frame it lands on,
 * so this test asserts on frames rather than on the final position — a test of
 * the settled position passes just as well while the correction is visible,
 * which is exactly the state this defect was in.
 *
 * The sampler records what each frame painted rather than what it looked like
 * before layout — see `installSampler`, which is where that distinction is paid
 * for and where the measurement behind it is written down.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const SAMPLES_KEY = "__letscubeEntryScrollSamples";
/**
 * When the page itself was told its viewport had changed.
 *
 * `page.setViewportSize` reaches the renderer as a device-metrics override, and
 * Chromium applies that override to layout BEFORE the document runs its resize
 * steps. Traced at 1920 with a timestamp on every reading:
 *
 *   3489 raf top=3469 h=4505 c=1036 inner=1080x1920
 *   3524 raf top=3469 h=4505 c=856  inner=900x900   <- layout already resized
 *   3536 raf top=3469 h=4505 c=856  inner=900x900   <- and again
 *   3543 resize inner=900x900                       <- the page is told here
 *   3548 ro-fire n=2
 *   3548 ro  top=3649 h=4505 c=856  inner=900x900   <- corrected, same frame
 *
 * Two frames were laid out at the new size while no resize event and no
 * ResizeObserver notification had been delivered to the page. Nothing the
 * application could do would place the list in those two frames: it has not
 * been told, by any API, that anything moved. A real window resize does not
 * split this way — the size change, the resize steps and the observer
 * broadcast all belong to the same rendering lifecycle.
 *
 * So the resize test counts frames from this timestamp on, and everything the
 * page could act on is still counted: the resize event and the observer
 * broadcast land in the same frame, 5ms apart above, so the very frame in which
 * the correction is due is inside the window.
 */
const RESIZES_KEY = "__letscubeViewportResizes";

/**
 * Enough messages that the history is several viewports tall.
 *
 * The defect is invisible in a chat that fits on screen: with nothing to scroll,
 * `scrollTop = 0` is already the bottom and no correction is needed. A fixture
 * that did not overflow would pass against the broken code.
 */
const MESSAGES = Array.from({ length: 48 }, (_, index) => ({
  sender: index % 3 === 0 ? "Максим" : "Аня",
  text:
    `Строка ${String(index + 1).padStart(2, "0")} — синтетический текст для проверки того, ` +
    "что список открывается сразу в нужном месте, а не доезжает туда после первого кадра.",
  time: "09:0" + (index % 10),
  own: index % 3 === 0,
}));

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Строка 48", time: "09:09", unread: 0 }],
  messages: MESSAGES,
};

type Sample = { t: number; rows: number; top: number; height: number; client: number };

/**
 * Records what each frame actually painted, before the app has booted.
 *
 * Injected rather than polled: the whole defect lives in the first few frames
 * after the list mounts, and anything that samples from the test process would
 * arrive long after they had been painted.
 *
 * Two readings per frame, and the second one is the reason this spec can be
 * trusted at 360. `requestAnimationFrame` runs BEFORE style, layout and
 * ResizeObserver delivery of its own frame, so a reading taken there is the
 * state before any correction that frame is about to make. The component's own
 * observer then corrects the position after layout and before the paint, which
 * means the rAF reading can describe a frame nobody ever saw. That is D-039,
 * an entry the defect register has already had to withdraw once for this.
 *
 * Measured at 360x800 across twelve entries: the rAF reading alone reported
 * three frames over 40px — 728px and 1092px among them — while a ResizeObserver
 * registered after the component's own, and therefore delivered after its
 * correction, reported none at all in 79 deliveries.
 *
 * So each frame's reading is overwritten by anything the sampler sees later in
 * that same frame, and the surviving value is pushed at the start of the next
 * one. A misplacement that the frame corrects before painting disappears; one
 * that is still there when the browser paints does not, however briefly it
 * lasts. The observer is attached a task after the list first has rows, so the
 * component's own observer is registered first and is delivered first.
 */
function installSampler([samplesKey, resizesKey]: [string, string]) {
  const samples: Sample[] = [];
  (window as unknown as Record<string, unknown>)[samplesKey] = samples;

  // Registered before the application boots, so the first resize the page is
  // ever told about is recorded whatever else does or does not listen for it.
  const resizes: number[] = [];
  (window as unknown as Record<string, unknown>)[resizesKey] = resizes;
  window.addEventListener("resize", () => resizes.push(Math.round(performance.now())));

  const read = (): Sample | null => {
    const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    if (!element) return null;
    return {
      t: Math.round(performance.now()),
      rows: element.querySelectorAll("[data-message-id]").length,
      top: Math.round(element.scrollTop),
      height: element.scrollHeight,
      client: element.clientHeight,
    };
  };

  let pending: Sample | null = null;
  let attaching = false;
  let observer: ResizeObserver | null = null;

  const attach = () => {
    if (observer) return;
    const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    const content = element?.firstElementChild;
    if (!element || !content) return;
    observer = new ResizeObserver(() => {
      const late = read();
      if (late) pending = late;
    });
    observer.observe(content);
    observer.observe(element);
  };

  const tick = () => {
    if (pending) {
      samples.push(pending);
      pending = null;
    }
    const now = read();
    if (now) {
      pending = now;
      if (!attaching && now.rows > 0) {
        attaching = true;
        // A task, not this frame: the component registers its observer from a
        // passive effect, and one registered before it would be delivered
        // before its correction — which is the very reading being avoided.
        window.setTimeout(attach, 0);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function openCapture(page: Page) {
  // The fixture guard refuses a message stamped later than "now", so the clock
  // is pinned exactly as the sibling spec pins it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  await page.addInitScript(installSampler, [SAMPLES_KEY, RESIZES_KEY] as [string, string]);

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // Same rule as the meta-placement spec: a missing prerequisite fails loudly.
  // A spec that quietly skips itself is how D-024 shipped.
  if (!ready) {
    if (process.env.KUB_ALLOW_PREVIEW_FIXTURE_SKIP === "1") {
      test.skip(true, "preview fixture route unavailable and skipping was explicitly allowed");
      return;
    }
    throw new Error(
      response
        ? "The preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked."
        : "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked.",
    );
  }
}

/**
 * How far each painted frame sat from the bottom.
 *
 * A frame with no rows yet is not a frame of the conversation, and a history
 * that does not overflow cannot be away from the bottom, so both are dropped —
 * their presence would only dilute the measurement.
 *
 * `since` drops frames painted before a moment the caller names; see
 * `RESIZES_KEY`. It defaults to counting everything.
 */
async function distancesFromBottom(page: Page, since = 0): Promise<number[]> {
  const samples = await page.evaluate(
    (key) => (window as unknown as Record<string, Sample[]>)[key] ?? [],
    SAMPLES_KEY,
  );
  return samples
    .filter((sample) => sample.t >= since && sample.rows > 0 && sample.height > sample.client)
    .map((sample) => sample.height - sample.top - sample.client);
}

/** The scrollport as it stands right now, for the before/after of a resize. */
async function conversationMetrics(page: Page): Promise<{ content: number; client: number }> {
  const metrics = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    if (!element) return null;
    return { content: element.scrollHeight, client: element.clientHeight };
  });
  expect(metrics, "the conversation did not mount").not.toBeNull();
  return metrics!;
}

test.describe("chat entry scroll", () => {
  test("no painted frame shows the list away from the bottom on entry", async ({ page }) => {
    await openCapture(page);
    await page.waitForTimeout(1_500);

    const distances = await distancesFromBottom(page);
    expect(distances.length, "the sampler recorded no frame with a scrollable conversation").toBeGreaterThan(5);

    // 40px, and the number is not arbitrary. The bubble whose last line is
    // nearly full reflows on its own once the text has wrapped — D-032 measures
    // that at 22px, and it was 24px here — and that reflow happens without a
    // React commit, so only the ResizeObserver can catch it. It does, inside the
    // same frame and before the paint, which is why it stays under the bound.
    // The defect this guards produced 2790px.
    const worst = Math.max(...distances);
    expect(worst, `a frame was painted ${worst}px from the bottom`).toBeLessThanOrEqual(40);

    // And the very first frame that had a conversation in it was already right,
    // which is the property the fix actually establishes: the placement happens
    // in a layout effect, so no uncorrected frame is ever painted.
    expect(distances[0], "the first painted frame of the conversation was not at the bottom").toBeLessThanOrEqual(40);
  });

  test("content that grows under a pinned list is not painted out of place", async ({ page }) => {
    // Narrowing the window rewraps every bubble, so the conversation grows
    // taller with no React commit behind it — only a ResizeObserver can see it.
    // That callback runs after layout and before paint, so correcting there
    // costs nothing and is never seen; deferring it by a frame, which is what it
    // used to do, paints the gap first. Same defect as the entry, different
    // trigger, and this is the one the reader meets while simply resizing.
    //
    // The width is narrowed and the height is held, and both halves of that are
    // load-bearing.
    //
    // This test used to go from 1920x1080 to 900x900 in one step and claimed the
    // rewrap as its mechanism. Measured, it had neither. The conversation column
    // is capped, so its content is 4505px tall at every scrollport width from
    // 480 to 1520 — 1920 and 900 both land in that range and NOTHING rewraps.
    // What did change was the scrollport's height, 1036 to 856, which is the
    // keyboard mechanism of D-058 and already has its own test at a 4px bound.
    // The 180px it intermittently reported was that height change and never the
    // reflow this test is named after.
    //
    // 800 wide, because the sweep says the wrap only moves below a scrollport of
    // about 480: at a 1920 window the scrollport is 1520 and the content 4505,
    // at an 800 window it is 440 and the content 5597. The desktop layout is
    // kept, so the chrome above the list does not change and the scrollport
    // keeps its height. 320 for the phone projects, which are already narrower
    // than 800 and rewrap between 360 and 320.
    await openCapture(page);
    await page.waitForTimeout(1_200);

    const size = page.viewportSize();
    expect(size, "the project has no viewport to narrow").not.toBeNull();
    const before = await conversationMetrics(page);

    await page.evaluate(([samples, resizes]) => {
      (window as unknown as Record<string, unknown[]>)[samples].length = 0;
      (window as unknown as Record<string, unknown[]>)[resizes].length = 0;
    }, [SAMPLES_KEY, RESIZES_KEY]);

    await page.setViewportSize({
      width: size!.width >= 800 ? 800 : 320,
      height: size!.height,
    });
    await page.waitForTimeout(1_200);

    // The premise, asserted rather than assumed, because the version of this
    // test that assumed it spent months measuring something else.
    const after = await conversationMetrics(page);
    expect(
      after.content - before.content,
      "the conversation did not grow, so the reflow this test is named after did not happen",
    ).toBeGreaterThan(40);
    expect(
      after.client,
      "the scrollport changed height, so this is the keyboard mechanism and not the reflow",
    ).toBe(before.client);

    const acknowledged = (
      await page.evaluate(
        (key) => (window as unknown as Record<string, number[]>)[key] ?? [],
        RESIZES_KEY,
      )
    )[0];
    expect(
      acknowledged,
      "the page never received a resize event, so no frame here can be attributed to the application",
    ).not.toBeUndefined();

    const distances = await distancesFromBottom(page, acknowledged);
    expect(
      distances.length,
      "no frame was recorded after the page was told its viewport had changed",
    ).toBeGreaterThan(5);
    const worst = Math.max(...distances);
    expect(worst, `a frame was painted ${worst}px from the bottom after the reflow`).toBeLessThanOrEqual(40);
  });

  /**
   * D-058, and the mechanism rather than the symptom.
   *
   * On Android the WebView SHRINKS when the keyboard opens — it is not laid over
   * the page. So the height of this scrollport is the only box that moves:
   * measured on the device, `window.innerHeight` and `visualViewport.height`
   * both went 748 to 482 together, the computed keyboard inset stayed honestly
   * at 0, the composer stayed at 70px and the content's `scrollHeight` stayed at
   * 4467. `scrollTop` was left at 3719 while the maximum rose to 3985, so the
   * newest three messages went behind the composer and the newest bubble sat
   * 242.1px under its top edge.
   *
   * Shrinking the viewport height with the width held fixed is that mechanism
   * exactly: nothing rewraps, the content keeps its height, and only the
   * scrollport loses some. The width is held from the project's own viewport so
   * this runs honestly at every width in the matrix, 360 included.
   */
  test("the newest messages survive the viewport losing the keyboard's height", async ({ page }) => {
    await openCapture(page);
    // Past the entry lock, and that is not padding.
    //
    // Chat entry arms a 4200ms bottom lock with settle timers behind it, and
    // while it is armed those timers re-pin the list for their own reasons. A
    // shrink measured inside that window looked corrected — sampled every frame,
    // the list really did sit 266px out and a settle timer pulled it back 432ms
    // later — so the window is exactly long enough to hide the defect from a
    // test while a reader who has been in the chat for five seconds still meets
    // it. Waiting the lock out is what makes this measure the mechanism.
    await page.waitForTimeout(5_200);

    const size = page.viewportSize();
    expect(size, "the project has no viewport to shrink").not.toBeNull();

    const before = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!element) return null;
      return {
        distance: element.scrollHeight - element.scrollTop - element.clientHeight,
        client: element.clientHeight,
        content: element.scrollHeight,
      };
    });
    expect(before, "the conversation did not mount").not.toBeNull();
    expect(before!.distance, "the fixture did not start at the bottom").toBeLessThanOrEqual(4);

    // 266px is the keyboard measured on the device. Nothing depends on the
    // exact number; what matters is that only the height changes.
    await page.setViewportSize({ width: size!.width, height: Math.max(240, size!.height - 266) });
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!element) return null;
      return {
        distance: element.scrollHeight - element.scrollTop - element.clientHeight,
        client: element.clientHeight,
        content: element.scrollHeight,
      };
    });

    expect(after!.client, "the scrollport did not shrink, so this proves nothing").toBeLessThan(before!.client);
    expect(
      after!.content,
      "the content changed height too, so a shrunken scrollport is not what was tested",
    ).toBe(before!.content);
    expect(
      after!.distance,
      `the reader was left ${after!.distance}px from the bottom after the viewport shrank`,
    ).toBeLessThanOrEqual(4);
  });

  test("a reader up in the history is not dragged down when the viewport shrinks", async ({ page }) => {
    // The other half of the same contract, and the reason the fix is guarded by
    // `isAtBottomRef` rather than by anything new. A reader who scrolled up did
    // not ask to move, and the keyboard opening is not a request to.
    await openCapture(page);
    // Past the entry lock for a second reason here: while it is armed
    // `handleScroll` asserts "at bottom" without measuring, so a reader parked
    // in the history inside that window is not one the component believes in.
    await page.waitForTimeout(5_200);

    const size = page.viewportSize();
    expect(size).not.toBeNull();

    const parked = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!element) return null;
      // A wheel event is what tells the component a person is reading, and it is
      // the same signal the release handler listens for.
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 900);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return element.scrollTop;
    });
    expect(parked, "the fixture is too short to scroll away from the bottom").toBeGreaterThan(100);
    await page.waitForTimeout(500);

    const top = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      return element ? element.scrollTop : null;
    });

    await page.setViewportSize({ width: size!.width, height: Math.max(240, size!.height - 266) });
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      return element ? element.scrollTop : null;
    });

    expect(
      Math.abs((after ?? 0) - (top ?? 0)),
      `the reader was moved ${Math.abs((after ?? 0) - (top ?? 0))}px by a viewport change they did not ask for`,
    ).toBeLessThanOrEqual(4);
  });

  test("the entry lands at the bottom and stays there", async ({ page }) => {
    // The settled contract, kept separate on purpose. The frame-level test above
    // says the correction is not seen; this one says it still happens, so a
    // change that simply stopped scrolling could not pass both.
    await openCapture(page);
    await page.waitForTimeout(1_500);

    const settled = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!element) return null;
      return {
        distance: element.scrollHeight - element.scrollTop - element.clientHeight,
        scrollable: element.scrollHeight - element.clientHeight,
      };
    });

    expect(settled).not.toBeNull();
    expect(settled!.scrollable, "the fixture did not overflow, so it proves nothing").toBeGreaterThan(600);
    expect(settled!.distance).toBeLessThanOrEqual(4);
  });
});
