# The interface material

What LETSCUBE's surfaces are made of, and the rules that keep them one material
rather than a set of similar-looking fills. Written after the stage that
introduced it, because seven of the rules below were learned by breaking
something first, and every one of them is cheaper to read than to rediscover.

The source of truth is `artifacts/kub/src/index.css`. This file explains it; it
does not duplicate it. Where the two disagree, the stylesheet is right and this
file is stale.

## The tokens

Defined per theme in the `.dark` and `.light` blocks. Light is not dark with
different numbers — the two grounds behave differently and the values reflect
that, which is noted at each one.

| Token | What it is |
| --- | --- |
| `--glass-fill` | Chrome that content sits on: sidebars, headers, panels |
| `--glass-fill-strong` | Anything covering content it is not part of: menus, dialogs, toasts, tooltips |
| `--glass-line` | The lit top edge. This, more than the border, is what makes a panel read as a sheet of something |
| `--glass-blur` | What turns "translucent" into "frosted" |
| `--glass-shadow` | Ambient pool, contact shadow, and the inset highlight, in one value |
| `--kub-ambient` | The layered light on the page. Not decoration — see rule 2 |
| `--kub-inset` | What a field, a well or a track is cut into |
| `--kub-raised` | A fixed step above a **known** surface |
| `--kub-raise-veil` | A step above **whatever it is laid on** — see rule 5 |
| `--kub-sink-veil` | A step below it: a control that is present but not offered |
| `--kub-rule` | A line **between** things inside a sheet, as against the edge **of** one — see rule 11 |

And two utilities, `.kub-glass` and `.kub-glass-strong`, which carry the whole
material so that what the application is made of is one edit rather than a
search. Plus `.kub-raise` / `.kub-raise-hover` for the veil.

Colours that carry **words** have their own tokens — `--kub-danger-text` and
`--kub-accent-text` — because a colour legible as a border or a filled button
is not necessarily legible as a sentence. Fills, borders and icon shapes keep
`--kub-danger` and `--kub-cyan`: those answer a 3:1 requirement they already
meet.

## The twelve rules

### 1. Never write the material by hand

No `backdrop-filter`, no `rgba()` fill, no shadow in a component. Only the
utilities. The moment one panel writes its own, the material stops being one
thing and starts being a family resemblance.

### 2. Translucency needs something behind it

A blur over one flat colour returns that same flat colour. `--kub-ambient` is
the condition for everything else, not a decoration on top of it.

The corollary bites more often: **an opaque fill behind a translucent panel
cancels it.** A page root painting `bg-[var(--kub-bg)]` under a glass header
leaves the blur nothing to sample. The fix is to remove the fill, never to add
more blur. This was found three times — the bots page, the tasks page, and both
main shells.

And a second corollary, which is what finally made the material look like
glass: **a ground is not content.** Chrome sitting *beside* the thing it is
made of glass for reveals only the page, and a blurred page is a page. The chat
header and composer were siblings of the message list in a flex column — below
it, never behind it — so their blur sampled a flat fill and returned it. They
now overlay the list, which runs the full height behind them, and the list
compensates with their *measured* height. Frosted text under the header is the
difference between a translucent panel and glass.

Three things that change costs when chrome overlays content:

- **`scroll-padding` is the half that breaks silently.** Without it
  `scrollIntoView` carries a target to the edge of the scrollport, which is now
  covered: the browser reports success and the message sits under the header.
  Padding and scroll-padding move together, on both sides.
- **Do not reach for `z-index` to fix the paint order, and do not reach for
  `order` either.** Positioned siblings with `z-index: auto` paint in tree
  order, so the list covered the header — but a `z-index` on the header makes
  it a stacking context and traps the fixed dialogs inside it, which is rule 3
  arriving by another road. `order: -1` on the list was the first answer and it
  was wrong: see rule 12. What works is tree order — render the list first and
  the chrome after it.
- **A `ResizeObserver` watches the content box by default**, so a composer that
  grows by its own padding — which is how the mobile keyboard inset is
  applied — does not register. Measured: the dock grew to 390px, the padding
  stayed at 94, and the last message went 296px under the composer. Use
  `border-box`.

### 3. `backdrop-filter` is a containing block for `position: fixed`

An element with a backdrop-filter becomes the reference for fixed descendants.
Glass on the root of a 400px sidebar made a dialog and its scrim lay out inside
that column while the chat panel beside it stayed undimmed.

If a surface has fixed descendants, put the material on a **sheet behind** it,
where it has no descendants to capture. `KubGlassLayer` is that sheet.

### 4. An SVG fill cannot be glass

`backdrop-filter` has no effect on one, so a `<rect>` can only ever be an opaque
colour standing in for a pane. Both Windows startup scenes had this. The pane
has to be a real element behind the drawing.

### 5. Elevation is relative; most tokens are absolute

This one cost three rounds. A field, then a chat row, then a menu item, each
painted with a colour that sat one step above the surface beneath it — until
that surface moved and the two went flush. A chat row under the cursor measured
a ratio of **1.002** against the row beside it: the hover had stopped existing.

None of those values was the cause. Each absolute token answers "one step above
*this* surface" and stops answering the moment it is used on another. A fourth
token would have worked until the fifth surface appeared.

`--kub-raise-veil` answers "one step above whatever is under me". It is applied
as a background **image**, which is the whole trick: it composites over the
`background-color` already there instead of replacing it, so one rule reads
correctly on the page, on a panel and inside a menu, and it cannot go flush with
its own ground.

Use `--kub-raised` only where the pair is fixed and a reviewer can confirm it by
looking at two values. Use the veil for anything standing against a surface that
might move.

`--kub-sink-veil` is the same idea downwards, and it exists because **`opacity`
is not a way to be disabled.** The product faded disabled controls with six
different values of it across 79 places, and on a translucent panel opacity
shows the wallpaper straight through the control: measured 2.23:1 in the dark
theme and 1.94:1 in the light one, against a threshold of 4.5. Sinking gives
7.73:1 and 5.02:1. A disabled control still has to be read; it just must not be
offered. This is the one elevation that does **not** reverse between themes — a
well is darker than its surface in both.

Note: it carries **no transition**, deliberately. `background-image` does not
interpolate — from `none` to a gradient is a discrete swap, confirmed in a
browser — so a transition there buys no fade, while a `transition` shorthand
outside any layer beats Tailwind's `@layer utilities` and replaces the
transition of everything it is applied to. A fade would have to be an opacity
transition on a pseudo-element.

### 6. Nothing that scrolls or repeats

A blur is a layer per element per frame. Message bubbles, list rows, feed cards:
the chrome around them, yes; the content, no. What is behind a bubble is the
chat background, so it would pay for revealing nothing.

### 7. Measure contrast from photographed pixels

Not from the token values. Make the text transparent, screenshot the backdrop,
decode the PNG — then blur, alpha and ambient are all in the number. Threshold
4.5:1 for text, both themes.

The worst backdrop a translucent panel can composite to is a solid white field
in the dark theme and a solid black one in the light theme; a blur cannot make a
uniform field lighter or darker than itself, so that really is the limit.

Contrast measurements answer whether text on a surface is legible. They cannot
tell you whether the surface is **visible** — the first version of this material
was correct, measured, and composited to within two values of the opaque fill it
replaced. Look at it as well.

### 8. The elevation direction reverses between themes

On a dark ground a nearer surface is lighter. On a light ground the panel is
already close to white, so a nearer one is told by going down towards the page.

And the light theme's separation is not won on its panels: its page sits nine
values from them where the dark theme's sits two hundred and fifty. Two rounds
went into raising the light fill and then making its shadow actually clear the
panel edge, and both only reached "barely visible". Moving the ground down
doubled the step under every panel at once without touching one of them.

The pre-paint bootstrap colour is written outside any stylesheet in two places
(`src/lib/themeRuntime.ts` and `index.html`) because it runs before CSS is
applied. Moving `--kub-bg` means moving those too, or there is a flash of the
old colour on every cold start. `tests/unit/theme-bootstrap-parity.test.mjs`
enforces it.

### 9. Prove a test by mutation, and prove the mutation applied

Compare the file's SHA-256 before and after the substitution — not the presence
or absence of anchor text, which gives a false "applied" on an insertion. If the
anchor is not unique, the harness must **refuse** to judge rather than guess.

Two specific traps found here, both of which produced a green test over broken
behaviour:

- Matching a bare property name also matches its vendor prefix, so deleting
  `backdrop-filter` left an assertion satisfied by `-webkit-backdrop-filter`.
- A parser that reads a stylesheet without blanking comments will read a
  sentence *about* a token as a declaration of it. Writing prose about a token
  was therefore a way to break the test guarding it.

### 10. The application's own classes are in `@layer components`, below utilities

`.kub-panel`, `.kub-glass`, `.kub-glow-*`, `.kub-interactive`, `.kub-field`,
`.kub-switch` and the rest live in `@layer components`. Utilities live in
`@layer utilities`, which is declared after it, so **a utility on an element
carrying one of these classes wins**, which is what everyone writing markup
already assumed.

They used to sit outside every layer. Unlayered CSS beats everything inside a
layer regardless of specificity and source order, so a utility touching a
property one of these classes also set was silently dead. Two defects came from
it before it was understood as one thing:

- The raise utilities set a `transition` shorthand, which replaced the
  transition of everything they were applied to. A hover that paired
  `transition-all hover:scale-125` went from easing to snapping.
- `.kub-panel` sets `background`, `box-shadow` and the `border` shorthand, so a
  task card's selected state — a fill, a ring and a border colour, all written
  as utilities — never reached a pixel. Selected and unselected composited to
  the same `rgb(16,39,67)`: a ratio of **1.000**.

The move is `tests/unit/cascade-layers.test.mjs`, which also holds the two
things it rests on: that the installed Tailwind still declares `components`
before `utilities`, and that its `transition-*` utilities still read
`--tw-duration` / `--tw-ease`.

Three things are worth knowing before editing the stylesheet.

**The theme blocks stay unlayered.** `.dark`, `.light` and
`.light .bots-management-surface` declare custom properties and nothing else.
No utility declares `--kub-*` or `--tg-*`, so there is no cascade to lose.

**The element half of the touch-target floor stays unlayered too.** A class is
opt-in: whoever writes `kub-field` on a box can also write the height they want,
and a utility that disagrees should win. `select`, `input[type="checkbox"]`,
`input[type="radio"]` and the `label:has(…)` rows are the opposite — they exist
so a control nobody tagged is still reachable by a finger, which only works
while nothing silently outranks them.

**`.kub-interactive` bridges its tokens into Tailwind's own variables.** It
declares no `transition-property`; the property always comes from a
`transition-*` utility beside it, and the pair only ever worked because the
class outranked the utility. Inside the layer the utility's
`transition-duration: var(--tw-duration, var(--default-transition-duration))`
wins, so the class sets `--tw-duration` and `--tw-ease` as well as the
longhands. Measured: 0.14s / `cubic-bezier(.2,.8,.2,1)` before and after,
collapsing to 0.001s under reduced motion both times — and a `duration-*`
written beside it now wins, which it did not before.

Two rules follow from the move, and both are enforced:

- **A glow is a box-shadow.** `.kub-glow-cyan|pink|soft` and a `shadow-*`
  utility on the same element are two answers to one property; the utility now
  wins and replaces the brand halo with a generic black drop shadow. Six
  surfaces carried both and were rendering the glow; the `shadow-*` was removed
  from each. Rule 1 says the same thing from the other direction.
- **A utility that finally works can still be wrong.** The ops report's warning
  and error callouts wrote a tinted fill that had never rendered. Photographed
  in the light theme once it did, `--kub-muted` on the 8% wash measured
  **4.52:1** and **4.39:1** against **5.59:1** on the untinted panel — the
  second under the floor. The fill was dropped and the border colour, which
  costs nothing and carries the same signal, was kept.

### 11. A border belongs to what you aim at, not to what you look at

One blue line of one weight used to be drawn around the panel, around the card
inside the panel, around the field inside the card and around the chip beside
the field — 276 perimeters and 109 single sides from one token. When everything
is outlined the outline stops being a message, and nested boxes of equal weight
are the thing that reads as dated. Three jobs were being done by one
declaration:

- the **edge** of a sheet, and of chrome pinned against a scroll area, which has
  to hold against arbitrary content passing under it: `--kub-border-color`;
- a **rule** between two blocks that share one surface and scroll together:
  `--kub-rule`, a third of the edge's weight;
- a **nested box** inside a sheet: no perimeter at all, separated by a step of
  material.

Photographed on real pages, the old token as a rule measured a step of 59 in the
dark theme against a sheet edge of 89, and 56 in the light theme against an edge
of **46** — a divider inside a panel was heavier than the panel's own outline.
`--kub-rule` gives 29 and 36, still visible hairlines.

For the 69 boxes that lost their perimeter, what separates them went from a fill
step of 11 (dark) and 14 (light) to **27** and **26**, with a worst case of 26
and 23 — the border did the work before and the material does it now. The
threshold is not invented: 23 is the step by which a panel in this theme stands
off the page (rule 8), so a nested box clearing it is as visible as a panel is.

Four things keep their perimeter, and each is a measurement or a signal rather
than a preference:

- **A well.** A box filled from `--kub-inset` already has a step and it goes
  down; in the dark theme that step measures 18–20 against the panel holding it,
  under the floor. The same wells measure 36–44 in the light theme and would
  have been fine — one value cannot be right in both, and the darker theme
  decides it.
- **A target.** A field, a segment, a task row. Removing the line also removes
  the channel its hover, selection and disabled states speak in — and a resting
  step equal to the hover step is rule 5's 1.002 all over again.
- **A covering surface.** A menu, a toast, a floating pill has to stand on a
  backdrop nobody chose, so it cannot be separated by a step relative to it.
- **A line that means something.** `border-dashed` for empty or deleted, a tone
  on `KubBadge` and `KubNotice`, a media frame, and any variant whose name is
  `outline`.

Two failure modes belong to doing this in bulk, and both happened here. Removing
a width and leaving the colour gives a declaration that draws nothing and looks
deliberate. Adding a resting veil to something that already veils on hover
deletes the hover. `tests/unit/edge-vocabulary.test.mjs` holds both, along with
the named exceptions.

### 12. `order` does not move paint order in WebKit

The chrome overlays the conversation, and which of the two paints on top is the
whole effect. Both are positioned boxes with `z-index: auto`, so the answer is
tree order — and the header came first in the markup. `order: -1` on the list
was what moved it underneath.

`order` re-orders painting for flex items in Chromium. **WebKit does not apply
it to positioned boxes at all.** Reduced to two divs in a flex column, with the
chrome absolutely positioned first and the list `position: relative; order: -1`
second, Chromium paints the chrome on top and WebKit paints the list on top;
with the list `position: static` both agree. The layout is identical in every
case — same box, same offsets — and only the painting differs, which is why
nothing about the geometry gave it away.

What it cost: for the whole of this stage the chat header did not exist on any
iPhone. Measured on WebKit 26.4 at 390x844, the header's own box was at top 0
with height 56 and byte-identical geometry to Chromium, no ancestor carried a
backdrop-filter, and the topmost element at the centre of the header was a
message bubble. The back button's own centre hit-tested to a bubble, and the
header's menu could not be opened at any width, 1440 included. On a phone that
header is the only way out of a conversation.

Three things follow.

- **Tree order is the mechanism.** The list is rendered first and the chrome
  after it. It costs reading order — the conversation is read before its
  header — and that is the cheapest price on offer.
- **The alternatives were measured, not assumed.** A `z-index` on the chrome,
  or an `isolation` on the column, makes a stacking context and clamps every
  `fixed` overlay in the subtree: this header's menu and modals, the composer's
  camera and video recorder, a bubble's context menu. Whichever of the two
  chrome boxes then lost would have its full-screen dialog covered by the
  other, and on a phone the header's menu opens exactly where the composer is.
  A negative `z-index` on the list is worse still: measured, the list stops
  being the hit-test target in both engines.
- **The matrix had six Chromium viewports and no WebKit.** That is the reason a
  defect this size survived six deploys. `webkit-mobile-390` is now in
  `playwright.config.ts`; with the pre-fix source restored exactly, all seven
  Chromium checks pass and WebKit fails two, which is the proof that the engine
  is the variable and no width of Chromium substitutes for it.

## Where the material is not used, on purpose

- **Message bubbles and list rows** — rule 6.
- **Anything carrying a danger fill with guaranteed-contrast text on it.** The
  signal comes before the surface, and the foreground colour is only guaranteed
  against the undiluted fill.
- **`card.tsx`** — content, not chrome, and it repeats down a scrolling page.
- **The media viewer's frame** — glass would tint the photograph.

## Fallback

`@supports not (backdrop-filter: blur(1px))` gives opaque fills. A translucent
panel over unblurred content is unreadable, which is worse than no effect at
all. The fallback cannot match the composited values, so what it preserves is
the **relationship**: strong is the lighter of the two in the dark theme,
because that is what "above" means there, and a menu must not read as a recess
in the panel it opens over.
