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
function installSampler(samplesKey: string) {
  const samples: Sample[] = [];
  (window as unknown as Record<string, unknown>)[samplesKey] = samples;

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
  await page.addInitScript(installSampler, SAMPLES_KEY);

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
 */
async function distancesFromBottom(page: Page): Promise<number[]> {
  const samples = await page.evaluate(
    (key) => (window as unknown as Record<string, Sample[]>)[key] ?? [],
    SAMPLES_KEY,
  );
  return samples
    .filter((sample) => sample.rows > 0 && sample.height > sample.client)
    .map((sample) => sample.height - sample.top - sample.client);
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
    await openCapture(page);
    await page.waitForTimeout(1_200);

    await page.evaluate((key) => {
      (window as unknown as Record<string, unknown[]>)[key].length = 0;
    }, SAMPLES_KEY);

    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(1_200);

    const distances = await distancesFromBottom(page);
    expect(distances.length, "no frame was recorded after the resize").toBeGreaterThan(5);
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
