import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The startup scene's progress must read as progress.
 *
 * The shell verifies the connection faster than a person can read: measured on
 * the real client, all four stages completed within about 300ms — 75ms each —
 * and the scene then sat still for the remaining 1.9s of its minimum display
 * time. A flicker followed by a long hold is what "it starts jerkily"
 * describes.
 *
 * The pacing is in CSS on purpose. The startup UI carries a contract forbidding
 * `setTimeout` and `setInterval`, so the scene can never invent progress it has
 * not been told about; a JavaScript version of this broke that rule. A CSS
 * transition can only make a change appear LATER, never earlier, so it cannot
 * show a stage as done before the shell has said so.
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY IT NO LONGER DOES. The indicator was
 * four separate bars, and the stagger was per-bar `transition-delay` in
 * hand-written milliseconds — a mechanism that existed only because four
 * separate objects had to be made to look like one advancing thing. It is now
 * one recessed track with one continuous fill, where left-to-right ordering is
 * a property of the shape rather than something sequenced by hand. Those three
 * assertions therefore described a design that had been deliberately replaced,
 * and they had been failing since it was — unnoticed, because nothing ran this
 * file for several changes.
 *
 * The contracts below are the same intent against the current shape, and the
 * middle one is stronger than what it replaces: it catches a stage being given
 * the wrong amount of the track, which the old stagger check could not see.
 */

const css = readFileSync(new URL("../../windows-tauri/ui/startup.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../../windows-tauri/ui/startup.js", import.meta.url), "utf8");

test("the fill advances rather than jumping", () => {
  const fill = css.match(/\.stages::after \{([^}]*)\}/);
  assert.ok(fill, "the track's fill rule is missing");
  // The fill is revealed by clip-path rather than sized by background-size —
  // that is what confines the travelling highlight to the filled length. What
  // this test has always been about is unchanged: the length must move over a
  // shared duration rather than snap between stages.
  assert.match(
    fill[1],
    /transition:\s*clip-path\s+var\(--kub-motion-[a-z]+\)/,
    "the fill's length must transition, and on one of the shared durations",
  );
  // Revealed, not resized: the fill grows without any box being laid out
  // again, which is what keeps a 300ms run of stage changes from costing four
  // layouts. clip-path does that exactly as background-size did; `width`,
  // which is the obvious way to write this, would not.
  assert.match(fill[1], /clip-path:\s*inset\(0 calc\(100% - var\(--fill\)\)/);
  assert.doesNotMatch(
    fill[1],
    /(?:^|[^-\w])width:/,
    "the fill must not grow by resizing a box",
  );
});

test("each stage is given more of the track than the one before it", () => {
  const order = ["network_check", "tls_origin_check", "update_check", "production_navigation"];
  const fills = new Map(
    [...css.matchAll(/body\[data-stage="([a-z_]+)"\][^{]*\.stages \{ --fill: ([\d.]+)%; \}/g)].map(
      (match) => [match[1], Number(match[2])],
    ),
  );
  for (const stage of order) {
    assert.ok(fills.has(stage), `no fill is declared for the ${stage} stage`);
  }
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      fills.get(order[index]) > fills.get(order[index - 1]),
      `${order[index]} is not further along the track than ${order[index - 1]}`,
    );
  }
  // The head sits at the middle of the stage in flight — that stage has started
  // and has not finished — so the last one before completion must not already
  // be full, or arriving at "complete" would show no movement at all.
  assert.ok(
    fills.get("production_navigation") < 100,
    "the last stage in flight must leave the track something to finish",
  );
});

test("reduced motion stops the loops and collapses the durations", () => {
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\n\}/)?.[0];
  assert.ok(block, "no reduced-motion block was found");
  // The fill's transition is removed by collapsing the token it resolves to,
  // rather than by naming the rule again — which is what keeps this from
  // drifting when a rule is renamed.
  assert.match(block, /--kub-motion-emphasis:\s*1ms;/, "the fill's duration must collapse");
  // The two ambient loops are removed outright. Collapsing their duration would
  // leave them cycling every few milliseconds, which is a flicker rather than a
  // reduction, and neither carries information the scene needs.
  assert.match(block, /\.stages::after \{ animation: none; \}/);
  assert.match(block, /\.rail i \{ animation: none; \}/);
});

test("the scene still invents no progress of its own", () => {
  // The reason all of the above is in CSS. Unchanged by the rebuild, and the
  // single most important line in this file.
  assert.doesNotMatch(js, /setTimeout|setInterval/);
});
