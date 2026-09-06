import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * What the 360-wide phone taught us, held so it cannot be un-learned.
 *
 * The release matrix stopped at 390 until 2026-09-06. The first walk on a real
 * 360-wide device produced three defects from below that line in one session,
 * and two of them are typography: text set in a way that only works while the
 * column is wide, and labels laid out in a way that only works while there is
 * room. Both are cheap to reintroduce and neither shows up in a screenshot
 * taken at 390.
 *
 * The Playwright matrix now carries `chromium-mobile-360` and
 * `scripts/interface-audit.mjs` carries `360x800`, which is where these are
 * seen. This file is where they are held.
 */

const bubble = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);
const nav = readFileSync(
  new URL("../../artifacts/kub/src/components/layout/BottomNav.tsx", import.meta.url),
  "utf8",
);

/** Comments explain the defects; they must not be read as code that causes them. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * D-060: justification without hyphenation pays for every unbreakable word out
 * of the word spaces, and a phone-width bubble has nothing else to give.
 *
 * Measured on the DEV preview fixture with a `Range` over each rendered word,
 * against a natural space of 3.94px in this font at 14px: 63.58px (16.15x) at
 * 360, 52.00px (13.21x) at 390, 47.55px (12.08x) at 412, and still 19.08px
 * (4.85x) at 1440 on the widest bubble the product can draw. There is no width
 * at which it behaves, which is why this is an absence rather than a breakpoint.
 * With it removed the same measurement reads 3.92-3.94px — 1.00x — everywhere.
 */
test("message text is never justified", () => {
  const source = withoutComments(bubble);
  assert.doesNotMatch(
    source,
    /text-align:\s*justify|\btext-justify\b|\btext-align-last\b/,
    "message text is justified again; at 360 that opens word gaps 16 times a space",
  );
  assert.doesNotMatch(
    source,
    /shouldJustifyOrdinaryText|justifyOrdinaryText/,
    "the justification switch is back, so something is choosing to justify again",
  );
});

/**
 * D-061: the six tabs at 360 left 3.2px between two labels, in a font whose
 * space measures 3.3px, so "ПРОФИЛЬ ЗАДАЧИ АДМИНКА" read as one phrase.
 *
 * The mechanism is flex shrink: the buttons' base sizes summed past the row, so
 * they were compressed, and a compressed flex item keeps its padding while its
 * content box collapses — the labels spilled out of their own buttons. The fix
 * is to make them fit, and then the padding is a floor under the gap that free
 * space cannot take away.
 *
 * Measured at 360 (row 344px wide): labels totalled 314.1px as shipped and
 * 278.5px at 11px without the extra tracking. Narrowest label gap went 3.17px
 * to 10.25px, 390 went 9.00 to 15.25, 412 went 13.28 to 18.92, and no label
 * overflows its button at any of the three. The narrowest touch target is
 * 44.0 x 48.5px, still over the 44px floor.
 */
test("the bottom tab labels are sized to fit the narrowest phone", () => {
  const source = withoutComments(nav);

  const button = source.match(/"relative flex flex-col items-center[^"]*"/)?.[0];
  assert.ok(button, "the tab button's class string could not be found");
  const padding = button.match(/\bpx-(\d+(?:\.\d+)?)\b/);
  assert.ok(padding, "the tab button declares no horizontal padding, so nothing separates the labels");
  assert.ok(
    Number(padding[1]) <= 1,
    `the tab button is back to px-${padding[1]}; at 360 that padding cannot be paid and the labels spill out of their buttons`,
  );
  assert.match(button, /\bmin-w-\[44px\]/, "the tab lost its 44px touch floor");

  const label = source.match(/"text-\[(\d+)px\][^"]*"/);
  assert.ok(label, "the tab label's class string could not be found");
  assert.ok(
    Number(label[1]) <= 11,
    `the tab label is back to ${label[1]}px; the six labels then total 314.1px against a 344px row`,
  );
  assert.doesNotMatch(
    label[0],
    /\btracking-(wide|wider|widest)\b/,
    "the tab label widened its tracking again, which is 10px of the row across six labels",
  );

  // And the labels themselves, because a seventh tab or a longer word breaks
  // the same fit from the other side. 34 characters is what was measured.
  const labels = [...source.matchAll(/label:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(labels.length, 6, `the tab bar has ${labels.length} labels; the fit was measured for six`);
  const characters = labels.reduce((total, value) => total + value.length, 0);
  assert.ok(
    characters <= 34,
    `the tab labels total ${characters} characters; 34 is what fits 360px with its padding intact`,
  );
});
