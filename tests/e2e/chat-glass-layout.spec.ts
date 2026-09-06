import { expect, test, type Page } from "@playwright/test";

/**
 * The conversation runs *behind* the header and the composer, and pays for it
 * in padding.
 *
 * Translucency only reads as translucency when there is content behind it. The
 * header and the composer used to be the list's vertical neighbours, so a blur
 * over either sampled the flat page and returned the flat page — "стекло не
 * очень стеклянное". The list now fills the pane and passes under both, and its
 * padding and scroll-padding compensate for exactly what they cover.
 *
 * That padding is the whole risk. Every scroll contract in section 11 of
 * CLAUDE.md is expressed in this container's `scrollTop`, `scrollHeight` and
 * `clientHeight`, and the arithmetic only stays put because the list gains the
 * same number of pixels of client height and of padding. So this file asserts
 * the two halves separately:
 *
 *  - the list really does run behind both, which is what makes the material
 *    work — and which a well-meaning "fix" for a clipped message would undo;
 *  - nothing the reader is shown ends up under either, which is what the
 *    padding buys.
 *
 * The jump cases are the ones worth having a test for. `scrollIntoView` aligns
 * to the scrollport, and the scrollport's edges are now covered, so without
 * `scroll-padding` the browser would deliver a searched-for message to a place
 * the reader cannot see while reporting, correctly, that it had scrolled it
 * into view. That failure is silent: the element is "visible" by every ordinary
 * measure, and only its position against the chrome gives it away.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";

/** Several viewports of history, so there is something to run behind. */
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

async function openCapture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );

  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // A missing prerequisite fails loudly, exactly as the sibling scroll specs
  // do. A spec that quietly skips itself is how D-024 shipped.
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
  await page.waitForTimeout(1_500);
}

type Geometry = {
  container: { top: number; bottom: number; clientHeight: number; scrollHeight: number };
  chrome: { top: number; bottom: number };
  composer: { top: number; bottom: number };
  padding: { top: number; bottom: number };
  scrollPadding: { top: number; bottom: number };
  lastRow: { top: number; bottom: number };
  rows: number;
};

async function readGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
    const chrome = document.querySelector<HTMLElement>('[data-testid="chat-chrome-stack"]');
    const composer = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
    if (!container || !chrome || !composer) throw new Error("the conversation surfaces were not found");

    const style = getComputedStyle(container);
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
    const last = rows[rows.length - 1]?.getBoundingClientRect();
    if (!last) throw new Error("the fixture rendered no messages");
    const box = container.getBoundingClientRect();
    const chromeBox = chrome.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();

    return {
      container: {
        top: box.top,
        bottom: box.bottom,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      },
      chrome: { top: chromeBox.top, bottom: chromeBox.bottom },
      composer: { top: composerBox.top, bottom: composerBox.bottom },
      padding: { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) },
      scrollPadding: {
        top: parseFloat(style.scrollPaddingTop),
        bottom: parseFloat(style.scrollPaddingBottom),
      },
      lastRow: { top: last.top, bottom: last.bottom },
      rows: rows.length,
    };
  });
}

/** Where a programmatic jump actually delivers its target. */
async function jumpTo(page: Page, index: number, block: "center" | "start") {
  return page.evaluate(
    ({ index, block }) => {
      const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      const chrome = document.querySelector<HTMLElement>('[data-testid="chat-chrome-stack"]');
      const composer = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
      if (!container || !chrome || !composer) throw new Error("the conversation surfaces were not found");
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
      const target = rows[index];
      if (!target) throw new Error(`there is no message at index ${index}`);

      target.scrollIntoView({ behavior: "auto", block });
      // `applyMessageTopNow` backs off by 56px so the unread message is not
      // flush against the chrome. Reproduced here so the entry is measured the
      // way the application performs it.
      if (block === "start") container.scrollTop = Math.max(0, container.scrollTop - 56);

      const rect = target.getBoundingClientRect();
      return {
        target: { top: rect.top, bottom: rect.bottom },
        band: { top: chrome.getBoundingClientRect().bottom, bottom: composer.getBoundingClientRect().top },
      };
    },
    { index, block },
  );
}

test.describe("chat glass layout", () => {
  test("the conversation runs behind the header and the composer", async ({ page }) => {
    await openCapture(page);
    const geometry = await readGeometry(page);

    // Without this the chrome has nothing but the page to blur, which is the
    // defect the whole change exists to fix. Half a pixel of tolerance for a
    // fractional layout; anything more and the list is beside the chrome again.
    expect(
      geometry.container.top,
      "the list starts below the header, so the header has no messages to frost",
    ).toBeLessThanOrEqual(geometry.chrome.top + 0.5);
    expect(
      geometry.container.bottom,
      "the list stops above the composer, so the composer has no messages to frost",
    ).toBeGreaterThanOrEqual(geometry.composer.bottom - 0.5);

    // And the padding is the measured height of what covers it, not a constant.
    const chromeHeight = geometry.chrome.bottom - geometry.chrome.top;
    const composerHeight = geometry.composer.bottom - geometry.composer.top;
    expect(geometry.padding.top).toBeGreaterThanOrEqual(chromeHeight);
    expect(geometry.padding.bottom).toBeGreaterThanOrEqual(composerHeight);
  });

  test("the chrome paints over the conversation, without a z-index", async ({ page }) => {
    await openCapture(page);

    const stack = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      const chrome = document.querySelector<HTMLElement>('[data-testid="chat-chrome-stack"]');
      if (!container || !chrome) throw new Error("the conversation surfaces were not found");

      // Park a bubble's middle on the header's middle, so there is definitely
      // something behind the glass to be wrong about.
      const band = chrome.getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
      const probe = rows[Math.floor(rows.length / 2)];
      const rect = probe.getBoundingClientRect();
      container.scrollTop += rect.top + rect.height / 2 - (band.top + band.height / 2);

      const painted = document.elementsFromPoint(band.left + band.width / 2, band.top + band.height / 2);
      return {
        topmostIsChrome: painted.length > 0 && chrome.contains(painted[0]),
        messageIsBehind: painted.some((node) => node instanceof HTMLElement && node.dataset.messageId),
        chromeIndex: painted.findIndex((node) => node === chrome),
        messageIndex: painted.findIndex((node) => node instanceof HTMLElement && Boolean(node.dataset.messageId)),
      };
    });

    // Both halves matter. A message must be at this point at all — otherwise
    // the list is not running behind the header and the rest proves nothing —
    // and the chrome must be painted over it.
    expect(stack.messageIsBehind, "no message is behind the header, so it has nothing to frost").toBe(true);
    expect(stack.topmostIsChrome, "a message bubble paints over the header").toBe(true);
    expect(
      stack.chromeIndex,
      "the header is painted under the conversation it is supposed to frost",
    ).toBeLessThan(stack.messageIndex);
  });

  test("scroll-padding matches padding on both edges", async ({ page }) => {
    await openCapture(page);
    const geometry = await readGeometry(page);

    // The pair is the contract. `padding` alone keeps the reader's own
    // scrolling honest and leaves every `scrollIntoView` aiming at a covered
    // edge; `scroll-padding` alone leaves the resting position wrong.
    expect(geometry.scrollPadding.top, "scroll-padding-top drifted from padding-top").toBeCloseTo(
      geometry.padding.top,
      1,
    );
    expect(geometry.scrollPadding.bottom, "scroll-padding-bottom drifted from padding-bottom").toBeCloseTo(
      geometry.padding.bottom,
      1,
    );
  });

  test("entering the chat leaves the newest message clear of the composer", async ({ page }) => {
    await openCapture(page);
    const geometry = await readGeometry(page);

    expect(geometry.rows, "the fixture rendered nothing to measure").toBeGreaterThan(10);
    expect(
      geometry.container.scrollHeight,
      "the fixture did not overflow, so it proves nothing",
    ).toBeGreaterThan(geometry.container.clientHeight + 600);
    expect(
      geometry.composer.top - geometry.lastRow.bottom,
      "the newest message is under the composer",
    ).toBeGreaterThanOrEqual(0);
  });

  test("a jump lands the message where the reader can see it", async ({ page }) => {
    await openCapture(page);
    const geometry = await readGeometry(page);
    // Everything the list pads beyond the chrome's own height is the gap it
    // guarantees between its content and its edges — 0.5rem. A jump has to
    // clear the chrome by at least that, not merely touch it.
    const contentGap = geometry.padding.top - (geometry.chrome.bottom - geometry.chrome.top);

    // `block: "center"` is what the search, reply and pinned jumps use.
    const centred = await jumpTo(page, 24, "center");
    expect(
      centred.target.top,
      "the jump delivered the message under the header",
    ).toBeGreaterThanOrEqual(centred.band.top - 0.5);
    expect(
      centred.target.bottom,
      "the jump delivered the message under the composer",
    ).toBeLessThanOrEqual(centred.band.bottom + 0.5);

    // `block: "start"` is the first-unread entry, and it is where
    // `scroll-padding-top` earns its place. The browser aligns to the
    // scrollport, whose top edge is now behind the header; the entry's own 56px
    // of breathing room is enough to drag the message back to the header's
    // lower edge and no further, so without the scroll-padding it arrives
    // exactly flush against it — technically on screen, and wrong.
    const started = await jumpTo(page, 24, "start");
    expect(
      started.target.top - started.band.top,
      "the first unread message arrived flush against the header instead of below it",
    ).toBeGreaterThanOrEqual(contentGap - 0.5);
    expect(
      started.target.bottom,
      "the first unread message was placed under the composer",
    ).toBeLessThanOrEqual(started.band.bottom + 0.5);
  });

  test("a composer that grows keeps the newest message clear", async ({ page }) => {
    await openCapture(page);
    const before = await readGeometry(page);

    // The keyboard, a reply preview and a row of attachments all reach the list
    // the same way: the dock gets taller. It gets taller by its own padding
    // when the keyboard opens, which a content-box ResizeObserver cannot see —
    // measured, that left the newest message 296px under the composer.
    await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
      if (!dock) throw new Error("the composer dock was not found");
      dock.style.paddingBottom = "220px";
    });
    await page.waitForTimeout(600);
    const grown = await readGeometry(page);

    expect(
      grown.composer.bottom - grown.composer.top,
      "the dock did not actually grow, so this proves nothing",
    ).toBeGreaterThan(before.composer.bottom - before.composer.top + 100);

    expect(grown.padding.bottom, "the list did not follow the composer's new height").toBeGreaterThanOrEqual(
      grown.composer.bottom - grown.composer.top,
    );
    expect(
      grown.composer.top - grown.lastRow.bottom,
      "the newest message went under the grown composer",
    ).toBeGreaterThanOrEqual(0);
  });
  test("the way out of the conversation is reachable", async ({ page }) => {
    await openCapture(page);

    // D-062. The sibling test above asks whether the header is *painted* on
    // top; this one asks the question the owner actually asked, which is
    // whether a finger landing on the back button reaches the back button.
    //
    // They are not the same assertion, and this is the one that says what the
    // defect cost: on an iPhone the header is the only way out of a chat, and
    // for the whole of the glass stage a tap on it went to a message bubble
    // instead. Chromium passed throughout — `order: -1` on the list moved its
    // paint position there and does nothing at all in WebKit — so this only
    // means something while a WebKit project is in the matrix.
    const reach = await page.evaluate(() => {
      const chrome = document.querySelector<HTMLElement>('[data-testid="chat-chrome-stack"]');
      const row = document.querySelector<HTMLElement>('[data-testid="chat-control-row"]');
      const container = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]');
      if (!chrome || !row || !container) throw new Error("the conversation surfaces were not found");

      // Park a bubble under the header first. Against an empty scrollport the
      // header is trivially reachable and the test proves nothing.
      const band = row.getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
      const probe = rows[Math.floor(rows.length / 2)];
      if (!probe) throw new Error("the fixture rendered no messages");
      const rect = probe.getBoundingClientRect();
      container.scrollTop += rect.top + rect.height / 2 - (band.top + band.height / 2);

      const hit = (element: Element) => {
        const box = element.getBoundingClientRect();
        const node = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          inside: node ? element.contains(node) : false,
          landedOnMessage: Boolean(
            node?.closest("[data-message-id]"),
          ),
        };
      };

      const back = document.querySelector<HTMLElement>('[aria-label="Назад"]');
      const backVisible = Boolean(back && back.getBoundingClientRect().width > 0);
      return {
        // The whole point of running this at all.
        messageBehindHeader: Array.from(
          document.elementsFromPoint(band.left + band.width / 2, band.top + band.height / 2),
        ).some((node) => node instanceof HTMLElement && Boolean(node.dataset.messageId)),
        row: hit(row),
        back: backVisible && back ? hit(back) : null,
      };
    });

    expect(
      reach.messageBehindHeader,
      "no message is behind the header, so reaching it proves nothing",
    ).toBe(true);
    expect(reach.row.landedOnMessage, "a tap on the chat header lands on a message bubble").toBe(false);
    expect(reach.row.inside, "the chat header does not receive a tap on its own centre").toBe(true);

    // Below `md` the back button is rendered and is the only way out.
    if (reach.back) {
      expect(reach.back.landedOnMessage, "a tap on the back button lands on a message bubble").toBe(false);
      expect(reach.back.inside, "the back button does not receive a tap on its own centre").toBe(true);
    }
  });
});
