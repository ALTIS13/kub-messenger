import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// docs/deploy/nginx.conf is copied to /etc/nginx/conf.d/default.conf by
// docs/deploy/Dockerfile, so this file is what actually serves app.letscube.ru.
const conf = readFileSync(new URL("../../docs/deploy/nginx.conf", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../docs/deploy/Dockerfile", import.meta.url), "utf8");

test("the served nginx config is the one this test reads", () => {
  // Without this the rest of the file could pass while production is served by
  // something else entirely.
  assert.match(
    dockerfile,
    /COPY docs\/deploy\/nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/,
    "the Dockerfile must install this exact config",
  );
});

// nginx's add_header is inherited from the enclosing block ONLY while the child
// declares none of its own; a single add_header in a location silently drops
// every inherited one. That is the trap this test exists for: adding a
// Cache-Control to a location would otherwise remove Alt-Svc from it without
// any error, and the documents a client fetches first — index.html, sw.js,
// manifest.json — are exactly the ones with their own headers.
test("every location that sets a header still clears the HTTP/3 advertisement", () => {
  const ALT_SVC = 'add_header Alt-Svc "clear" always;';
  assert.ok(conf.includes(ALT_SVC), "the server block must clear Alt-Svc");

  // Split into location blocks by brace depth rather than by regex: a regex
  // over `location ... { ... }` cannot see nesting and would silently pair the
  // wrong braces.
  const blocks = [];
  for (const match of conf.matchAll(/location\s+([^{]+?)\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < conf.length && depth > 0; i += 1) {
      if (conf[i] === "{") depth += 1;
      else if (conf[i] === "}") depth -= 1;
    }
    blocks.push({ name: match[1].trim(), body: conf.slice(match.index + match[0].length, i - 1) });
  }
  assert.ok(blocks.length >= 6, `expected the known location blocks, found ${blocks.length}`);

  const offenders = blocks
    .filter((b) => /add_header/.test(b.body) && !b.body.includes(ALT_SVC))
    .map((b) => b.name);
  assert.deepEqual(
    offenders,
    [],
    `these locations set headers of their own and so no longer clear Alt-Svc: ${offenders.join(", ")}`,
  );
});

test("nothing re-advertises an alternative service", () => {
  // The point of the clear is undone by a single h3 advertisement anywhere.
  assert.doesNotMatch(
    conf.replace(/^\s*#.*$/gm, ""),
    /Alt-Svc\s+"(?!clear")/,
    "Alt-Svc may only ever be sent as `clear` from here",
  );
});
