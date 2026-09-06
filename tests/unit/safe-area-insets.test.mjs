import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { atRuleTexts, stripCssComments } from "./helpers/css.mjs";

/**
 * The inset a phone reserves for its own hardware, and what it takes to
 * actually receive it.
 *
 * Three surfaces dock to the bottom edge on a phone — the tab bar, a
 * full-screen modal and the chat-list sheet — and every one of them asked for
 * the home-indicator inset by writing `pb-safe`. No such utility exists in
 * Tailwind and none was declared, so the class compiled to nothing: measured,
 * `pb-safe` occurred zero times in the 219 kB production stylesheet while
 * appearing in three components. The tab bar sat on the home indicator, which
 * is what the owner reported as "слишком низко".
 *
 * A missing utility fails silently by construction — the class name is valid
 * markup whether or not anything declares it, and nothing in the build says a
 * word — so it is worth a test rather than a reading.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = stripCssComments(readFileSync(path.join(root, "artifacts/kub/src/index.css"), "utf8"));

/**
 * The spacing utilities the application declares for itself, and the inset each
 * one has to resolve to. A name here is a promise that the class does
 * something; this test holds both ends of it.
 */
const CUSTOM_INSET_UTILITIES = new Map([
  ["pb-safe", { property: "padding-bottom", inset: "safe-area-inset-bottom" }],
]);

/** Whether a source file writes `name` as a standalone class token. */
function writesClass(text, name) {
  return text.split(/[\s"'`]+/).includes(name);
}

/** Every `.ts`, `.tsx` and `.css` file under the web sources. */
function sourceFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(tsx?|css)$/.test(entry)) found.push(full);
    }
  };
  walk(path.join(root, "artifacts/kub/src"));
  return found;
}

const sources = sourceFiles().map((file) => ({ file, text: readFileSync(file, "utf8") }));

test("every custom inset utility the markup writes is actually declared", () => {
  for (const [name, { property, inset }] of CUSTOM_INSET_UTILITIES) {
    const users = sources
      .filter(({ file, text }) => !file.endsWith("index.css") && writesClass(text, name))
      .map(({ file }) => path.relative(root, file));

    assert.ok(
      users.length > 0,
      `no component writes \`${name}\` any more — drop it from this list rather than keeping a utility nothing asks for`,
    );

    // Read through the helper rather than a regex, so the declaration is
    // delimited by its own braces and a rule further down cannot satisfy it.
    const bodies = atRuleTexts(css, new RegExp(`^@utility ${name}$`));
    assert.equal(
      bodies.length,
      1,
      `\`${name}\` is written in ${users.join(", ")} and index.css declares \`@utility ${name}\` ${bodies.length} times — at zero it compiles to nothing and the class is silently inert`,
    );

    const body = bodies[0];
    assert.ok(
      body.includes(`${property}:`),
      `\`@utility ${name}\` does not set ${property}; it declares: ${body.trim()}`,
    );
    assert.ok(
      body.includes(`env(${inset}`),
      `\`@utility ${name}\` does not read env(${inset}), so it reserves a constant instead of the device's own inset`,
    );
  }
});

test("the bottom tab bar adds the home-indicator inset to its height", () => {
  const nav = readFileSync(path.join(root, "artifacts/kub/src/components/layout/BottomNav.tsx"), "utf8");

  assert.ok(writesClass(nav, "pb-safe"), "the tab bar stopped asking for the bottom inset at all");

  // Tailwind boxes are border-box, so a flat `height: 56px` beside `pb-safe`
  // takes the inset out of the tabs instead of adding it underneath: on a 34px
  // indicator that leaves six labels and their icons 22px of row.
  const height = /height:\s*"([^"]+)"/.exec(nav);
  assert.ok(height, "the tab bar no longer sets an explicit height — re-read this test before deleting it");
  assert.ok(
    height[1].includes("env(safe-area-inset-bottom"),
    `the tab bar's height is "${height[1]}", so its safe-area padding comes out of the row rather than being added below it`,
  );
});
