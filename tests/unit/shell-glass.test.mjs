import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The application's frame is made of the same material as its overlays, and
 * neither is written out by hand.
 *
 * `tests/unit/overlay-glass.test.mjs` holds this line for `components/ui`. This
 * file holds it for the shell: the top bar, the sidebar column, the bottom
 * navigation, the chat header and the composer. They are the surfaces content
 * *sits on*, so they take `kub-glass`; the menus that open over that content
 * take `kub-glass-strong`.
 *
 * Three separate things are asserted, because three separate things went wrong
 * while this was being built:
 *
 *  1. The surface uses the utility at all. A panel that keeps
 *     `bg-[var(--kub-surface)]` is simply not made of the material.
 *  2. Nothing competes with the utility on the same element. `.kub-glass` and
 *     `.kub-glow-soft` both set `box-shadow` and both sit unlayered in
 *     index.css, so whichever is written later in the file wins — the panel's
 *     depth would then depend on stylesheet order rather than on a decision.
 *  3. The shells behind the glass stay transparent. `--kub-ambient` is painted
 *     once, on `body`; an opaque shell over it hands every panel one flat
 *     colour to blur and the whole material collapses to paint. This is not a
 *     style preference — it is the precondition for the other two mattering,
 *     and it is invisible in a screenshot of a single panel.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/**
 * Chrome that content sits on, and that opens nothing, so it can wear the
 * material on the element itself. `-strong` here would be a heavier panel than
 * the job needs.
 */
const panels = [
  ["components/layout/AppTopBar.tsx", "kub-app-topbar-height", "kub-glass"],
  ["components/layout/BottomNav.tsx", "justify-around", "kub-glass"],
  ["components/kub/KubHeader.tsx", "border-b border-[color:var(--kub-border-color)]", "kub-glass"],
  // The tasks page's two chrome bars. Neither is sticky, so what they blur is
  // the ambient rather than passing content — which is the same thing the
  // sidebar blurs, and the reason the ambient is painted on `body` and not on
  // the scrollers.
  ["pages/tasks/TasksPage.tsx", "overflow-x-auto", "kub-glass"],
  ["pages/tasks/TasksPage.tsx", "px-3 sm:px-5 py-3", "kub-glass"],
  // The bot settings surfaces. The pane holding them is ground, so these are
  // the panels of that page the way the cards are the panels of settings.
  ["components/bots/BotSettingsPanel.tsx", "px-4 py-4 sm:px-6", "kub-glass"],
  ["components/bots/BotSettingsPanel.tsx", "grid h-auto w-full", "kub-glass"],
  ["components/bots/BotSettingsPanel.tsx", "rounded-md border border-[color:var(--kub-border-color)] p-4", "kub-glass"],
];

/**
 * Chrome that content sits on *and* that opens something `fixed`.
 *
 * These take the material as a layer instead. `backdrop-filter` makes its
 * element a containing block for fixed descendants, so with `kub-glass` on the
 * sidebar's own box the settings dialog was laid out against the 400px column,
 * scrim and all, and rendered under the top bar. Each entry is [file, the root
 * class string].
 *
 * The body that has to sit over the layer is not named here. It is found
 * structurally, as the element immediately after `<KubGlassLayer />`, because a
 * landmark taken from the body's own classes is a landmark the mutation under
 * test can delete — three mutations did exactly that and turned "the body is
 * unpositioned" into "no class string found".
 */
const layered = [
  ["components/sidebar/Sidebar.tsx", "relative flex h-full w-full flex-col"],
  ["components/chat/ChatHeader.tsx", "relative flex flex-shrink-0 flex-col"],
  ["components/chat/MessageInput.tsx", "relative flex-shrink-0"],
  ["pages/public/PublicPreviewCapturePage.tsx", "relative h-full flex-shrink-0 flex-col border-r"],
];

/** The class string of whatever the layer is painted behind. */
function bodyAfterLayer(source) {
  // An optional JSX comment may sit between the two, explaining the pairing.
  const found = source.match(
    /<KubGlassLayer[^>]*\/>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div\s+className="([^"]*)"/,
  );
  assert.ok(found, "no element follows <KubGlassLayer />, so nothing is painted over it");
  return found[1];
}

/** Chrome that covers content it is not part of. */
const covers = [
  ["components/sidebar/SidebarHeader.tsx", "absolute left-0 top-12 w-64", "kub-glass-strong"],
  ["components/chat/ChatHeader.tsx", "max-h-[min(70vh,480px)]", "kub-glass-strong"],
  ["components/kub/KubModal.tsx", "kub-modal-panel", "kub-glass-strong"],
  ["components/kub/KubTooltip.tsx", "text-[color:var(--kub-text)] border", "kub-glass-strong"],
  ["components/kub/KubFeedbackViewport.tsx", "py-2.5 pl-4 pr-3", "kub-glass-strong"],
  // The chat list's context menu, in both the shapes it takes.
  ["components/sidebar/ChatList.tsx", "w-[272px] max-w-[calc(100vw-24px)]", "kub-glass-strong"],
  ["components/sidebar/ChatList.tsx", "max-h-[82vh] w-full overflow-hidden", "kub-glass-strong"],
];

/**
 * Elevation is relative, and the two halves of that are not interchangeable.
 *
 * `--kub-raised` is an absolute colour. It answers "one step above THIS
 * surface", so it is right where the pairing is fixed and reviewable — the
 * strips that always sit on the composer and nowhere else. It is wrong for
 * anything whose ground can move, which is how the same defect landed three
 * times in a row: a field, a list row and a menu item each held a colour that
 * had been one step above its surface until that surface shifted, and each was
 * measured flush afterwards (1.002 for the row's hover, which is to say it had
 * stopped existing while still being perfectly present in the source).
 *
 * `.kub-raise-hover` is a veil laid on as a background IMAGE, so it composites
 * over whatever fill the element already has instead of replacing it. One rule
 * reads the same on the page, on a panel and inside a menu, and it cannot go
 * flush with its own background. Every hover in this zone uses it; measured, a
 * chat row moves 1.211 and a menu item inside a frosted menu 1.229, where the
 * absolute token could not have moved the menu item at all.
 */
const raised = [
  ["components/chat/MessageInput.tsx", "bg-[var(--kub-raised)]", 7],
  // The active tab pill of the bot settings panel. Radix drives it from
  // `data-[state=active]`, and `.kub-raise` is a plain class rather than a
  // Tailwind utility, so no variant can put the veil behind that attribute —
  // Tailwind emits no rule and the pill would simply have no fill. The pairing
  // is fixed and reviewable instead: this pill sits on that toolbar and nowhere
  // else, which is exactly the case the absolute token is for.
  ["components/bots/BotSettingsPanel.tsx", "bg-[var(--kub-raised)]", 1],
];

/** [file, how many hovers it carries]. Leftover elevation fills must be zero. */
const veiled = [
  ["components/sidebar/ChatListItem.tsx", 2],
  ["components/sidebar/ChatList.tsx", 1],
  ["components/sidebar/SidebarHeader.tsx", 4],
  ["components/sidebar/FolderTabs.tsx", 1],
  ["components/sidebar/NotificationBell.tsx", 6],
  ["components/sidebar/SettingsModal.tsx", 2],
  ["components/sidebar/FolderEditModal.tsx", 2],
  ["components/sidebar/FolderListModal.tsx", 1],
  ["components/sidebar/AudioSettingsSection.tsx", 1],
  ["components/sidebar/NewGroupModal.tsx", 1],
  ["components/sidebar/NewChatModal.tsx", 1],
  ["components/layout/AppTopBar.tsx", 1],
  ["components/layout/DesktopWindowChrome.tsx", 1],
  ["components/kub/KubModal.tsx", 1],
  // One, not two: the secondary variant now RESTS on the veil (`kub-raise`) and
  // hovers on a second layer of the same veil, written out because there is no
  // utility for a doubled one. Its hover is still the veil and still nothing
  // fixed, which is what this table is counting; it just cannot be found by
  // looking for the hover-only class.
  ["components/kub/KubButton.tsx", 1],
  ["components/kub/KubFilterChip.tsx", 1],
  ["components/kub/KubFeedbackViewport.tsx", 1],
  ["components/chat/ChatHeader.tsx", 5],
  ["components/chat/MessageInput.tsx", 8],
  ["components/chat/ChatInfoPanel.tsx", 20],
  ["components/chat/MessageBubble.tsx", 11],
  ["components/chat/PinnedMessage.tsx", 7],
  ["components/chat/ChatSearchBar.tsx", 4],
  ["components/chat/ChatMediaPlayback.tsx", 3],
  ["components/chat/VideoMessageRecorderModal.tsx", 2],
  ["components/chat/VoiceRecorder.tsx", 1],
  ["components/chat/TopicStrip.tsx", 1],
  ["components/chat/MessageList.tsx", 1],
  ["components/chat/GroupInviteModal.tsx", 1],
  ["components/chat/ForwardModal.tsx", 1],
  // Six, not seven. The user row was written as a card on a phone and a bare
  // line on a desktop, so it carried two hovers, one per ground —
  // `hover:bg-[var(--kub-surface-3)] sm:hover:bg-[var(--kub-surface-2)]`. The
  // veil is one rule against whatever the ground turns out to be, so the pair
  // is one class at both widths.
  ["pages/admin/UsersTab.tsx", 6],
  ["pages/admin/AuditTab.tsx", 6],
  ["pages/admin/RolesPermissionsTab.tsx", 4],
  ["pages/admin/BansMutesTab.tsx", 4],
  ["pages/admin/AdminLayout.tsx", 1],
  ["pages/admin/LocationsTab.tsx", 1],
  ["pages/admin/support/SupportQueue.tsx", 1],
  ["pages/admin/support/SupportTicketDetails.tsx", 1],
  ["pages/tasks/TasksPage.tsx", 4],
  ["pages/tasks/TaskFormModal.tsx", 4],
  ["pages/tasks/TaskAssignModal.tsx", 2],
  ["pages/bots/BotsPage.tsx", 4],
  ["components/bots/BotSettingsPanel.tsx", 2],
  ["pages/public/PublicHomePage.tsx", 1],
  ["pages/public/PublicPageShell.tsx", 2],
];

/** The class string of one surface, found by a landmark that is not the glass class itself. */
function classString(file, needle) {
  const hit = [...read(file).matchAll(/"([^"\n]{12,})"/g)]
    .map((match) => match[1])
    .find((value) => value.includes(needle));
  assert.ok(hit, `${file}: no class string containing "${needle}"`);
  return hit;
}

for (const [file, needle, expected] of [...panels, ...covers]) {
  test(`${file} (${needle}) is made of ${expected}`, () => {
    const classes = classString(file, needle);
    // `kub-glass-strong` contains `kub-glass`, so the weaker one is matched on
    // a word boundary that a `-strong` suffix breaks.
    const pattern =
      expected === "kub-glass"
        ? /\bkub-glass(?!-strong)\b/
        : /\bkub-glass-strong\b/;
    assert.match(classes, pattern, `${file} does not take its surface from ${expected}`);

    assert.doesNotMatch(
      classes,
      /\bbg-\[var\(--kub-(surface|chat-bg|bg)/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b/,
      `${file} keeps its own drop shadow beside --glass-shadow`,
    );
    assert.doesNotMatch(
      classes,
      /\bkub-glow-(soft|cyan|pink)\b/,
      `${file} keeps a glow beside --glass-shadow; both set box-shadow and only one survives`,
    );
    assert.doesNotMatch(
      classes,
      /\bbackdrop-blur\b/,
      `${file} frosts by hand instead of through the utility`,
    );
  });
}

for (const [file, rootClasses] of layered) {
  test(`${file} takes the material as a layer, not as a filter on itself`, () => {
    const source = read(file);

    assert.match(
      source,
      /<KubGlassLayer\b/,
      `${file} does not paint the material at all`,
    );

    const rootHit = classString(file, rootClasses);
    assert.doesNotMatch(
      rootHit,
      /\bkub-glass(-strong)?\b/,
      `${file} frosts the box that its overlays live in; a fixed dialog opened from here ` +
        "would be laid out against this panel instead of the viewport",
    );
    // Positioned, or `absolute inset-0` on the layer has nothing to resolve
    // against and the material lands on the wrong box.
    assert.match(rootHit, /\brelative\b/, `${file}'s root is not a positioning context`);

    // The layer is positioned, so the body has to be positioned too: two
    // positioned boxes with `z-index: auto` paint in tree order, which is what
    // keeps the content above the material without a stacking context.
    const bodyHit = bodyAfterLayer(source);
    assert.match(bodyHit, /\brelative\b/, `${file}'s body would paint under the glass layer`);
    assert.doesNotMatch(
      bodyHit,
      /\b-?z-\d/,
      `${file}'s body takes a z-index; that makes it a stacking context and clamps the ` +
        "overlays it opens",
    );
  });
}

for (const [file, needle, count] of raised) {
  test(`${file} keeps its static raised surfaces on --kub-raised`, () => {
    const source = read(file);
    const found = source.split(needle).length - 1;
    assert.equal(found, count, `${file}: expected ${count} element(s) on "${needle}", found ${found}`);
    // And none left on the token that used to serve this and no longer can:
    // --kub-surface-2 composites BELOW the chrome these sit on.
    const stale = withoutComments(source).split("bg-[var(--kub-surface-2)]").length - 1;
    assert.equal(
      stale,
      0,
      `${file}: ${stale} surface(s) still filled from --kub-surface-2, which now composites ` +
        "below the chrome they lie on",
    );
  });
}

/** Any neutral elevation fill spent on a hover, which the veil replaces. */
const LEFTOVER = /hover:bg-\[var\(--kub-(raised|surface-2|surface-3)\)\]/g;

/**
 * `.kub-raise-hover` is a plain class in index.css, not a utility Tailwind
 * knows how to compose, so a variant written in front of it — `sm:`, `md:`,
 * `group-hover:` — matches no rule and emits no CSS. Nothing warns: the build
 * passes, the class sits in the markup, and the hover is simply gone at that
 * breakpoint. This is the exact shape a search-and-replace produces when it
 * walks over `sm:hover:bg-[var(--kub-surface-2)]`, which one row in UsersTab
 * really did carry, so it is worth a line of its own.
 */
const PREFIXED_VEIL = /[A-Za-z0-9_-]:kub-raise-hover/g;

for (const [file, count] of veiled) {
  test(`${file} finds its hovers with the veil, not with a fixed colour`, () => {
    const source = read(file);
    const found = source.split("kub-raise-hover").length - 1;
    assert.equal(found, count, `${file}: expected ${count} hover(s) on the veil, found ${found}`);
    // Counting the survivors as well as the converts: a partial conversion is
    // the failure that actually happens, and one hover left behind is
    // invisible in a screenshot of the others.
    const leftBehind = (withoutComments(source).match(LEFTOVER) ?? []).length;
    assert.equal(
      leftBehind,
      0,
      `${file}: ${leftBehind} hover(s) still painted with a fixed elevation colour, which goes ` +
        "flush the moment the surface under it moves",
    );
    const prefixed = (withoutComments(source).match(PREFIXED_VEIL) ?? []).length;
    assert.equal(
      prefixed,
      0,
      `${file}: ${prefixed} veil class(es) carry a variant prefix, which Tailwind emits no rule ` +
        "for — the hover is absent at that breakpoint and nothing reports it",
    );
  });
}

test("the glass layer is a leaf that carries the material and nothing else", () => {
  const source = read("components/kub/KubGlassLayer.tsx");
  // Both fills, so a layered panel can still choose to cover content.
  assert.match(source, /"kub-glass-strong"/, "the layer cannot express a covering surface");
  assert.match(source, /"kub-glass"/, "the layer cannot express a panel surface");

  // Anchored on `absolute inset-0`, which none of the mutations below remove;
  // an anchor that included `pointer-events-none` would vanish along with the
  // very property being tested.
  const classes = classString("components/kub/KubGlassLayer.tsx", "absolute inset-0");
  // It sits over the panel's whole box and must never take a click meant for
  // the panel underneath it.
  assert.match(classes, /\bpointer-events-none\b/, "the layer would swallow clicks");
  assert.doesNotMatch(
    classes,
    /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b|\bkub-glow-(soft|cyan|pink)\b/,
    "the layer carries a second shadow beside --glass-shadow",
  );
  // A z-index here would need the host to be a stacking context, which is the
  // very thing the layer exists to avoid.
  assert.doesNotMatch(classes, /\b-?z-\d/, "the layer takes a z-index and forces a stacking context");
});

/**
 * The shells that must stay transparent, and the fill each one used to paint.
 *
 * Named individually rather than swept, so that deleting the assertion is the
 * only way to lose the coverage — a repository-wide scan would go quiet the
 * moment a file was renamed.
 */
const transparentShells = [
  ["components/layout/MainLayout.tsx", "flex flex-col h-[100dvh] w-screen"],
  ["components/chat/ChatWindow.tsx", "relative flex h-full w-full min-w-0"],
  ["components/sidebar/FolderTabs.tsx", "relative flex items-center flex-shrink-0"],
  ["pages/public/PublicPreviewCapturePage.tsx", "flex h-[100dvh] w-screen flex-col"],
];

for (const [file, needle] of transparentShells) {
  test(`${file} lets the page ambient through`, () => {
    const classes = classString(file, needle);
    assert.doesNotMatch(
      classes,
      /\bbg-\[var\(--kub-(bg|chat-bg|surface)/,
      `${file} paints over --kub-ambient, so every panel above it blurs a flat colour`,
    );
  });
}

/**
 * The tasks page is not in the list above because it does not have one shell:
 * it returns three, one per state — checking permissions, permission refused,
 * and the list itself — and every one of them painted --kub-bg across the full
 * height. `classString` finds the first match and would have reported the whole
 * page clean while two of the three states still painted over the ambient,
 * which is the shape of failure this file keeps warning about. So the roots are
 * counted, and each is asserted separately.
 *
 * This page differs from the bots page in one way worth writing down: there the
 * fill only ever showed as a strip behind the header, because both panes below
 * painted their own. Here the scroller carries no fill, so the fill really was
 * the ground under the task list. Removing it puts the list on the ambient on
 * purpose — every row brings its own surface, `kub-panel` in card mode and
 * --kub-surface in list mode, exactly as the message feed does.
 */
test("pages/tasks/TasksPage.tsx lets the page ambient through in each of its three states", () => {
  const roots = read("pages/tasks/TasksPage.tsx").match(/className="flex flex-col h-\[100dvh\][^"]*"/g) ?? [];
  assert.equal(
    roots.length,
    3,
    `expected the page's three state shells, found ${roots.length} — if a state was added or ` +
      "removed, check its root before changing this number",
  );
  for (const root of roots) {
    assert.doesNotMatch(
      root,
      /\bbg-\[var\(--kub-(bg|chat-bg|surface)/,
      `a tasks page state paints over --kub-ambient, so the header above it blurs a flat colour: ${root}`,
    );
  }
});

/**
 * The bots page has two columns, and only one of them is the material.
 *
 * Frosting both would frost the viewport edge to edge: a blur that covers
 * everything has nothing left to be seen against, and the two columns composite
 * to the same colour, so the page reads as one flat sheet again — the exact
 * outcome the material exists to avoid. The list column is chrome, so it is
 * glass; the detail pane is ground, and the settings surfaces inside it bring
 * their own.
 *
 * Found by `data-testid` rather than by a class landmark, because both panes
 * are built with `cn()` and their literal strings share `min-h-0 min-w-0` and
 * `hidden md:flex` — a needle-based lookup would report the list column twice
 * and never look at the detail pane at all.
 */
test("pages/bots/BotsPage.tsx frosts the list column and leaves the detail pane on the ambient", () => {
  const source = read("pages/bots/BotsPage.tsx");
  const pane = (id) => {
    const found = source.match(new RegExp(`<section data-testid="${id}"[^>]*>`));
    assert.ok(found, `no <section> carries data-testid="${id}"`);
    return found[0];
  };

  const list = pane("bots-list-pane");
  assert.match(list, /\bkub-glass(?!-strong)\b/, "the bot list column is not made of the material");
  assert.doesNotMatch(
    list,
    /\bbg-\[var\(--kub-(surface|bg)/,
    "the bot list column keeps an opaque fill beside the glass utility",
  );

  const detail = pane("bots-detail-pane");
  assert.doesNotMatch(
    detail,
    /\bbg-\[var\(--kub-(bg|surface)/,
    "the bot detail pane paints over --kub-ambient, so every settings panel above it blurs a flat colour",
  );
  assert.doesNotMatch(
    detail,
    /\bkub-glass\b/,
    "both bot columns are frosted, which composites the whole viewport to one flat sheet",
  );
});

/** Comments explain the measurements; only the code is under this rule. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the shell never writes the material by hand", () => {
  const files = [...new Set([...panels, ...covers].map(([file]) => file))].concat(
    "components/kub/KubGlassLayer.tsx",
  );
  for (const file of files) {
    const source = withoutComments(read(file));
    // `backdrop-blur` is not banned file-wide, and deliberately so: a scrim
    // behind a dialog and a badge over a video frame both use it legitimately,
    // and neither is a chrome surface. What the material rule forbids is a
    // *panel* frosting itself, and the per-surface assertions above already
    // reject `backdrop-blur` on the glass elements themselves.
    assert.doesNotMatch(
      source,
      /backdrop-filter\s*:|backdropFilter\s*:/,
      `${file} writes its own frosting`,
    );
    // `color-mix(in srgb, var(--token) …)` stays allowed: that is a token being
    // shaded, not a colour invented in a component. A literal rgb()/rgba() is
    // the thing this rule exists to stop.
    //
    // No `\b` in front. Tailwind arbitrary values write their spaces as
    // underscores, so the commonest way to smuggle a colour in is
    // `shadow-[0_2px_4px_rgba(0,0,0,.4)]` — and `_` is a word character, so a
    // word boundary is exactly what is missing there. A mutation putting that
    // string into KubFeedbackViewport survived the earlier `\brgba?\(`.
    // `color-mix(in srgb, …)` is still safe: `srgb` is not followed by `(`.
    assert.doesNotMatch(source, /rgba?\(/, `${file} writes its own fill`);
    // The declaration, not the word: `transition-[…,box-shadow]` names the
    // property it animates and invents no depth.
    assert.doesNotMatch(source, /box-shadow\s*:|boxShadow\s*:/, `${file} writes its own shadow`);
  }
});

/**
 * The list rows and the message bubbles are deliberately NOT glass.
 *
 * There are dozens of each on screen and each blur is a layer the compositor
 * pays for on every scrolled frame — to reveal the chat background, which is
 * the thing already behind them. The frame around them is the material; their
 * contents are not.
 */
for (const file of ["components/sidebar/ChatListItem.tsx", "components/chat/MessageBubble.tsx"]) {
  test(`${file} is not made of glass`, () => {
    assert.doesNotMatch(
      read(file),
      /\bkub-glass(-strong)?\b/,
      `${file} pays for a blur per row on every scrolled frame`,
    );
  });
}

/**
 * D-062. Rule 6 is about the *contents* of a scroller, not only its rows.
 *
 * Four chips ride inside the message list's scrolled content — the system
 * notice, the history band, the date separator and the unread separator — and
 * each wrote `backdrop-blur-sm` over a hand-mixed `--kub-bg` at 75-82% alpha.
 * That is rule 1 and rule 6 at once, and the blur bought nothing: all four are
 * block rows in the flow, so what is behind them is the chat wallpaper and
 * never a message. Rule 6's own argument, arriving at its own doorstep.
 *
 * Measured on the device with `dumpsys gfxinfo` over eight identical flings of
 * one conversation, median of three runs each side: 5.25% janky before and
 * 2.43% after, 99th percentile 36ms and 27ms, slow issue-draw commands 37 and
 * 17. Small, real, and a contract violation either way.
 *
 * They carry no fill either, and that is the second half of the entry.
 * `.kub-raise` was tried first and photographed under the floor: in the light
 * theme the veil steps DOWN, which took the date separator's `--kub-muted` text
 * to **4.30:1**, against 4.86:1 on the bare ground and 5.00:1 on the fill it
 * replaced. Rule 10's lesson in a new place — the fill was dropped and the
 * border, which costs nothing and carries the same signal, was kept.
 *
 * Each landmark is on the wrapping element and the class string that follows it
 * is the chip's own, which is what makes this findable without pinning line
 * numbers.
 */
const IN_LIST_CHIPS = [
  ["the system notice", "data-system-message"],
  ["the history band", "data-message-history-status"],
  ["the date separator", "data-message-date-separator"],
  ["the unread separator", 'data-testid="first-unread-separator"'],
];

for (const [what, landmark] of IN_LIST_CHIPS) {
  test(`${what} rides inside the conversation without frosting it`, () => {
    const source = withoutComments(read("components/chat/MessageList.tsx"));
    const at = source.indexOf(landmark);
    assert.ok(at >= 0, `${landmark} is gone, so this chip can no longer be found`);
    const after = source.slice(at);
    const classes = after.match(/className="([^"]+)"/)?.[1];
    assert.ok(classes, `no class string follows ${landmark}`);

    assert.doesNotMatch(
      classes,
      /\bbackdrop-blur(-|\b)/,
      `${what} frosts itself inside the scrolled conversation, which is rules 1 and 6 at once`,
    );
    assert.doesNotMatch(
      classes,
      /\bbg-\[color-mix\(/,
      `${what} mixes its own translucent fill; the fill existed to give the blur something to do`,
    );
    assert.doesNotMatch(
      classes,
      /(^|\s)kub-raise(\s|$)/,
      `${what} takes the veil, which on a light ground steps down and put this text at 4.30:1`,
    );
    // What separates it from the wallpaper instead. The unread separator's
    // border is the same token mixed with the pink it signals in.
    assert.match(
      classes,
      /\bborder-\[color/,
      `${what} has neither a fill nor a border, so nothing separates it from the conversation`,
    );
  });
}
