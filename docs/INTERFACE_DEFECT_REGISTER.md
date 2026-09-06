# LETSCUBE Interface Defect Register

Deliverable of queue item 18 in `docs/PRODUCTION_PRIORITY_TRACKER.md` — the
interface audit and polish stage.

The stage itself is scheduled after the public home plan closes. This register is
open early because defects were found while capturing the product previews from
the shipping components, and evidence is cheapest to record at the moment it is
observed.

D-001 to D-003 and D-006 to D-007 were pulled forward and fixed on 2026-09-01,
because they were contaminating the product imagery that the public home is about
to publish. The remaining entries belong to the stage.

Rules for entries: a reproduction, the exact surface with `file:line`, what is
actually wrong, and the observable consequence. No entry without evidence.

Status legend: `[ ]` open, `[~]` fix in progress, `[x]` fixed with a regression
test.

---

## D-001 `[x]` Incoming message bubbles have no background at all

**Severity:** high. Every incoming message in the product, in both themes.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:927`, also
`:1134` and `artifacts/kub/src/components/chat/TypingIndicator.tsx:6`.

**Defect:** all three read `var(--kub-message-in)`. That custom property is
**never defined**. `artifacts/kub/src/index.css` defines `--kub-message-out` for
both themes (`:148` dark, `:281` light) and `--kub-surface` (`:131`, `:264`), but
there is no `--kub-message-in` anywhere in the repository. An undefined custom
property makes `background-color` resolve to nothing, so the bubble is
transparent and only its border remains.

**Evidence:** sampled from the captured light-theme phone preview —

| Sample | RGB |
| --- | --- |
| Chat wallpaper, empty area | `244, 248, 251` |
| Inside an incoming bubble | `244, 247, 253` |
| Inside an outgoing bubble | `130, 143, 157` |

The incoming bubble is indistinguishable from the wallpaper behind it; the
outgoing bubble, which uses a defined `color-mix` on `--kub-cyan`, is not.

**Consequence:** incoming messages read as text floating on the wallpaper inside
a thin outline rather than as bubbles. It is a large part of why the chat looks
unfinished. The selected-message highlight at `:1134` mixes against the same
undefined token, so selection is also weaker than intended.

**Fixed** 2026-09-01. `--kub-message-in: var(--kub-surface)` is now defined in
both theme blocks, which is the token the bubble tail already resolved to. Same
sample after the fix: incoming bubble `251, 255, 255` against a `244, 248, 251`
wallpaper. Covered by `tests/unit/theme-token-contract.test.mjs`, which asserts
that every referenced theme token is defined and that both message-surface
tokens differ from the chat background in each theme.

---

## D-002 `[x]` The bubble tail is a different colour from its own bubble and lands on the avatar

**Severity:** high. Every last-in-group message.

**Surface:** `artifacts/kub/src/index.css:433-456` (`.bubble-out::after`,
`.bubble-in::after`), applied at
`artifacts/kub/src/components/chat/MessageBubble.tsx:1130-1131`.

**Defect:** three problems in one element.

1. **Colour mismatch.** The incoming tail is filled with `--tg-message-in`,
   which `index.css:217` and `:350` alias to `--kub-surface` — a *defined*
   token. The bubble it belongs to is filled with the *undefined*
   `--kub-message-in` (D-001). The tail is therefore opaque while its own bubble
   is transparent. Sampled tail: `248, 252, 255` against a `244, 247, 253`
   bubble interior.
2. **It overlaps the avatar.** The tail is positioned `left: -8px` outside the
   bubble box, and the incoming avatar sits immediately to the left, so the
   triangle is drawn on top of the avatar circle.
3. **It has no border.** The bubble carries
   `border border-[color:var(--kub-border-color)]`; the tail is a bare CSS
   border-triangle, so the outline visibly breaks where the tail attaches.

**Consequence:** a light wedge that appears to overlap the bubble and clip into
the avatar. This is the element a reader notices first and cannot explain.
Reported by the user against the captured previews on 2026-09-01.

**Fixed** 2026-09-01. The triangles are removed. A 9px triangle in a 6px row gap
cannot avoid the avatar, and a CSS border triangle cannot carry the bubble's own
border, so the element could not be made correct in place. The end of a group is
now expressed by squaring the bubble's corner on the sender's side
(`rounded-bl-none` / `rounded-br-none`), which reads the same, matches the fill
and border exactly, and cannot collide with anything. The two `--tg-message-*`
aliases existed only to colour those triangles and were removed with them. The
contract test asserts the rules and the classes do not come back.

---

## D-003 `[x]` The group read receipt is illegible at its rendered size

**Severity:** medium.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:828`.

**Defect:** the receipt renders Phosphor's `Checks` glyph
(`artifacts/kub/src/components/kub/icons.ts:228`) at `size={11}`. At that size
the two overlapping ticks merge into a pair of thin diagonal strokes that read
as a small arrow or a double slash rather than as checkmarks. The sibling
single-message delivery indicator on the same row uses `size={13}`
(`:806-814`), so two related indicators are drawn at different sizes.

**Consequence:** users cannot tell what the mark means. Reported by the user as
"a small arrow with no logical meaning" on 2026-09-01.

**Partly fixed** 2026-09-01. The receipt now renders at 13px, matching the
single-message delivery indicator on the same row. The glyph choice itself is
still Phosphor `Checks`; whether that reads as a receipt at any size is a design
question for the stage, and D-004 covers the label beside it.

---

## D-004 `[x]` The read count reads as a bare fraction with no unit or affordance

> **Closed 2026-09-04.** Batch 6 added the chip's markup on 2026-09-02 but it
> was invisible on screen — see the closing note at the end of this file. The
> boundary that makes it a control landed 2026-09-04.

**Severity:** medium.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:817-831`,
label from `artifacts/kub/src/lib/groupReadReceipts.ts:62-65`.

**Defect:** the compact label is `${readCount}/${totalRecipients}`, rendered as
plain text immediately after a `tabular-nums` timestamp with a `gap-0.5`. It is
a `<button>` that opens the receipt list, but nothing about it looks
interactive. The accessible name is correct
(`groupReadReceipts.ts:67-72`, "Прочитано всеми: 3 из 3"), so the information
exists but only for assistive technology.

**Consequence:** a sighted user sees `15:02 ⁄⁄ 3/3` and cannot decode it, and
does not discover that it is clickable.

---

## D-005 `[x]` The message meta row packs up to six elements without a hierarchy

> **Closed in fix batch 6**, which also corrected this entry's premise: the
> sizes already formed a scale and what was missing was grouping.

**Severity:** low, but it is the general reason the bubble looks crude.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx:794-840`.

**Defect:** the row can contain a pin icon (12 px), an "изм." label (10 px), the
timestamp (10 px, min-width `2.75rem`), then either a 13 px delivery icon or an
11 px icon plus a text fraction, then a 20 px actions button. Three different
icon sizes and two different type sizes sit at `gap-0.5` inside the bubble
padding, with no grouping.

**Consequence:** the densest part of the bubble is also the least organised, and
it is what the eye lands on after the message text.

---

## Notes on scope

D-004 and D-005 are design decisions rather than defects with a single correct
answer, so they stay with the stage.

The fixes recorded above were verified by regenerating the product previews and
re-sampling the pixels, not by reading the diff. Anything that changes how
messages render should be verified the same way.

The contract test written for D-001 immediately found D-006 and D-007, which had
been live on public pages. It is worth running that class of check over the other
design systems in the repository during the stage.

---

## D-006 `[x]` Muted text on the live public pages had no colour

**Severity:** medium. `/privacy` and `/bots/docs` are public and already deployed.

**Surface:** `artifacts/kub/src/pages/public/BotDocsPage.tsx` (8 occurrences) and
`artifacts/kub/src/pages/public/PrivacyPage.tsx` (1).

**Defect:** both referenced `--kub-text-muted`, which does not exist. The defined
token is `--kub-muted`. As with D-001 the declaration resolved to nothing, so
every paragraph meant to be secondary inherited the full-strength text colour and
the pages lost their typographic hierarchy.

**Fixed** 2026-09-01 by using the defined token. Found by the contract test
written for D-001, not by inspection.

---

## D-007 `[x]` Registration separator referenced an undefined token

**Severity:** low.

**Surface:** `artifacts/kub/src/components/auth/RegisterForm.tsx`.

**Defect:** the `/` separator was coloured with `--kub-border-strong`, which is
not defined anywhere, so it rendered at inherited colour instead of as a muted
divider.

**Fixed** 2026-09-01 by using `--kub-muted`. Also found by the contract test.

---

## D-008 `[x]` A wrapped message always pushes its time onto a separate line

> **Closed in fix batch 5** (`06298ff`, 2026-09-02). The `singleLineText`
> condition described below no longer exists. The text that follows is the
> original report, kept as written; do not read it as current.

**Severity:** medium. Every message long enough to wrap, which is most of them.

**Surface:** `artifacts/kub/src/components/chat/MessageBubble.tsx`, inside
`MeasuredTextWithMeta`: `const singleLineText = lineRects.length <= 1;` feeding
`canInline = singleLineText && available >= footerRect.width + gap`.

**Defect:** the measurement already computes whether the meta fits after the
last rendered line. The additional single-line condition overrides that result,
so a message that wraps to two or more lines can never keep its time inline even
when its last line ends well short of the bubble edge. The bubble then gains a
row that is empty except for a right-aligned timestamp.

**Consequence:** a conversation alternates between compact bubbles and bubbles
with a nearly empty extra row, which is the main reason a normal chat reads as
untidy. Reported by the user against the product previews on 2026-09-01.

**Not fixed here.** Removing the condition is a one-line change, but
`MeasuredTextWithMeta` carries hysteresis (`inlineBlockedRef`) precisely to stop
placement oscillation, and the surrounding contracts include chat scroll
anchoring and history prepend stability. It needs the chat regression suite that
belongs to this stage rather than a drive-by edit. Two related savings were
taken already: the timestamp no longer reserves a fixed `2.75rem` it never uses,
and D-003 aligned the receipt icon size.

The product previews avoid the case by using concise fixture replies, which is a
content choice for imagery and not a workaround for the defect.

## D-009 — an unreleased platform announced release progress it did not have

**Where:** `artifacts/kub/src/components/public/PlatformShowcase.tsx`, the status
line under each platform heading. Every viewport, both themes, all catalog
states.

**Defect:** the status line was keyed on the platform state alone, and
`unavailable` was labelled `Готовим выпуск`. That state covers two different
situations: a published platform between releases, and a platform with no
published catalog at all. macOS and iOS are the second kind — no manifest, no
build, no schedule — and were told to a logged-out visitor as a release being
prepared.

**Consequence:** one screen carried three statements about macOS at once — the
heading status `Готовим выпуск`, the button `В разработке`, and the summary
`macOS и iOS в разработке`. The first contradicts the other two and invents
progress, which the product rules for this surface forbid.

**Fixed.** `statusLabel()` returns `В разработке` whenever `catalogPublished` is
false, before consulting the state. `tests/e2e/public-home.spec.ts` now asserts
that neither unreleased section contains `готовим выпуск`; reverting the guard
turns that test red.

**Found by review, not by eye.** The component file is untouched by the change
that reported it — splitting `готовим к выпуску` from `в разработке` in the
summary is what turned a long-standing conflation into a visible contradiction.

---

# Audit pass, 2026-09-02

Entries from here on come from `scripts/interface-audit.mjs`, which measured the
five release viewports across both themes on seven surfaces: 70 cells, 426 raw
findings, 0 unreachable. The raw report is `output/audit/browser-report.json`
with a screenshot per cell.

Raw findings are not entries. 426 collapsed to 48 distinct (defect, element)
groups, and each group below was then confirmed by hand before being written
down. Three candidate groups were rejected as harness faults rather than
recorded, and the harness was fixed and pinned with a test for each: scripted
focus not matching `:focus-visible`, screen-reader-only labels counted as
clipped text, and a decorative image bleeding past a full-screen container.

## D-010 — keyboard focus is invisible on every primary button

**Severity:** P1. For a keyboard-only user this does not merely make a task
harder; it removes the ability to know which control is about to be activated.

**Where:** `artifacts/kub/src/components/kub/KubButton.tsx` with
`artifacts/kub/src/index.css`. Observed on the primary action of four surfaces —
`Войти` (login), `Отправить и открыть чат` (support), `Создать бота` (bots),
`Новая` and `Создать задачу` (tasks) — at all five viewports and in both themes.

**Reproduction:** open `/login`, press Tab four times to reach `Войти`, and
compare the computed `outline` and `box-shadow` before and after. They are
identical: `outline: none 3px rgb(5, 11, 24)` and
`box-shadow: … 0px 4px 24px -8px` in both states, while `document.activeElement`
is the button.

**Cause.** `KubButton` asks for the ring with
`focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]`, which Tailwind
v4 implements as a `box-shadow`. The `primary` and `accent` variants also carry
`kub-glow-soft` / `kub-glow-pink`, plain classes in `index.css` that set
`box-shadow` outright. Both are single-class specificity, so source order
decides and the glow wins. The ring is requested, composed, and then overwritten.

**Not a lint-level miss.** The classes are present and look correct in review;
only the computed style shows the ring never renders. That is why this needed a
measuring harness rather than a reading.

## D-011 — the accent colour fails contrast in the light theme

**Severity:** P1. It is the colour of the primary button's own label, so the
most important control on each surface is the least legible.

**Where:** `--brand-blue: #427fc2` in `artifacts/kub/src/index.css`, reached
through `--kub-cyan` and `--kub-action-primary-background`. Light theme only.

**Measured:**

| pair | ratio | needs |
| --- | --- | --- |
| brand blue on `--kub-bg` `#F4F8FC` | 3.90:1 | 4.5:1 |
| brand blue on `--kub-surface` `#FFFFFF` | 4.16:1 | 4.5:1 |
| button label `#F4F8FC` on brand blue | 3.90:1 | 4.5:1 |
| brand blue on the dark `--kub-bg` `#050B18` | 4.73:1 | passes |

**Surfaces:** `Войти` and its label, `Забыли пароль?`, `Зарегистрироваться`
(login), `Политикой конфиденциальности` (support and login), `Все платформы` and
the `LETSCUBE` eyebrow (public home), `Правовые документы` (privacy). Five
viewports, light theme.

**Note for the fix.** The palette already contains a shade that passes:
`--kub-cyan-hover: #2d6fac` measures 5.27:1 on white and 4.94:1 on `--kub-bg`.
The dark theme passes as it is and must not be dragged along by a shared token
change.

## D-012 — avatar monograms are unreadable on every palette colour

**Severity:** P1. At 1.19:1 the letter is not low-contrast, it is invisible.

**Where:** `getAvatarColor` in `artifacts/kub/src/components/ui/ChatAvatar.tsx`.
Both themes, every viewport, anywhere an avatar has no image.

**Measured.** The monogram is `text-white` over a generated pastel background.
All ten palette colours fail, and all ten pass with a dark foreground:

| background | white | black |
| --- | --- | --- |
| `#FFEAA7` | 1.19:1 | 17.58:1 |
| `#F7DC6F` | 1.36:1 | 15.42:1 |
| `#98D8C8` | 1.62:1 | 12.99:1 |
| `#96CEB4` | 1.78:1 | 11.78:1 |
| `#4ECDC4` | 1.93:1 | 10.85:1 |
| `#85C1E9` | 1.94:1 | 10.80:1 |
| `#DDA0DD` | 2.07:1 | 10.15:1 |
| `#45B7D1` | 2.35:1 | 8.95:1 |
| `#BB8FCE` | 2.65:1 | 7.93:1 |
| `#FF6B6B` | 2.78:1 | 7.57:1 |

Ten of ten fail with white; ten of ten pass with black. The palette was chosen
for dark text and is being drawn with light text.

## D-013 — controls below the touch target on the mobile viewports

**Severity:** P2, with a caveat that keeps it honest.

**Where:** 30 distinct elements across `login`, `support`, `tasks`, `messenger`,
`privacy` and `public-home`, at `390x844` and `412x915`, both themes.

**Split before fixing.** Not every one of these is a defect. Inline links inside
running prose are exempt from the target-size requirement, and several findings
are exactly that — `Зарегистрироваться` at 14px, `Политикой конфиденциальности`
at 15px, `privacy@app.letscube.ru` at 16px sit inside sentences. The ones that
are real are the standalone controls:

- form inputs at 20px high (`login`, `support`, `tasks`, and the messenger's
  sidebar search)
- checkboxes at 16px (`support`, `tasks`)
- the password reveal toggle at 16px (`login`)
- the `Забыли пароль?` trigger at 16px (`login`)
- the `Карточки` view switch at 30px (`tasks`)

The register records both halves so the fix batch cannot quietly widen into
restyling prose links.

## Rejected, with the harness fixed

Kept here because a rejected candidate is evidence about the audit's own
reliability, and because each one would otherwise be rediscovered.

1. **Primary buttons reported as having no focus indicator.** The harness used
   `node.focus()`; browsers deliberately do not match `:focus-visible` for
   scripted focus. It now tabs with the keyboard. D-010 survived that fix and is
   real; the same finding on secondary controls did not.
2. **Screen-reader-only labels reported as clipped text**, three on the tasks
   page. `sr-only` is clipped on purpose. Visually-hidden nodes are excluded.
3. **The login page's mascot reported as a 461px clipping defect** at every
   viewport. A decorative image bleeding past a full-screen container is a design
   choice; clipping is now only reported when text or a control is what gets cut
   off.

Each fix is pinned by a test in `tests/unit/interface-audit-harness.test.mjs`.

## D-014 — both accents miss contrast on surfaces in the dark theme

**Severity:** P2. A near-miss rather than an invisible letter, but a real one,
and it is the reason the "dark theme is fine" conclusion in D-011 was wrong.

**Found by the contract, not by eye.** D-011 checked the accents against the
page background, where the dark theme passes at 4.73:1, and concluded the dark
theme needed nothing. The test written for D-011 also checks `--kub-surface`,
which is what cards and panels are painted with, and there the brand blue
measures 4.36:1 and the brand magenta 4.38:1 — both under 4.5:1.

**Fixed** by lightening each along its own hue by the smallest step that clears
every surface: `--kub-cyan` to `#4d8bd0` and `--kub-pink` to `#f04a92`.

---

# Fix batch 1, 2026-09-02

Three systemic defects closed. Each fix is pinned by a test, and each test was
mutation-checked: the fix was reverted and the test watched go red.

**D-010 — fixed.** The focus indicator is an outline rather than a Tailwind
ring, because a ring is a `box-shadow` and the variant glow classes set
`box-shadow` at equal specificity. An outline is a separate property that a
box-shadow cannot overwrite. Pinned by
`tests/e2e/interface-focus-visibility.spec.ts`, which tabs with the keyboard and
compares the computed style before and after — restoring the ring makes it fail
with the D-010 message. Confirmed in the rendered page: `focus-invisible`
findings went from every login and support cell to none.

**D-011 and D-014 — fixed.** Light theme: `--kub-cyan` `#2d6fac` (4.94:1 on the
background, 5.27:1 on white), hover `#2b5e91`; `--kub-pink` `#c03068`. Dark
theme: `--kub-cyan` `#4d8bd0`, `--kub-pink` `#f04a92`. The blue shades were
already in the palette rather than invented. Pinned by
`tests/unit/theme-accent-contrast.test.mjs`, which reads the tokens out of
`index.css` and follows `var()` indirection to a colour, so a token change is
what it measures. Four mutations fail it, including reverting either accent.

**D-012 — fixed.** `avatarInkFor` in `artifacts/kub/src/lib/avatarInk.ts` picks
the higher-contrast ink per background instead of forcing white. Pinned by
`tests/unit/avatar-monogram-contrast.test.mts`, which reads the palette out of
the component so a new colour is covered automatically, and which also asserts a
dark background still gets light ink — without that, hardcoding dark ink would
pass. Four mutations fail it.

**Still open:** D-013 (touch targets), and D-004, D-005, D-008 from the earlier
pass.

**Verification.** Re-running the harness over the public surfaces after the fix
leaves 0 contrast and 0 focus findings where there were 4 to 6 per light cell
and 1 per surface respectively. 631/632 unit tests, typecheck and production
build clean; the single failure is the pre-existing `android-release-signing`
fixture, untouched by this branch.

# Fix batch 2, 2026-09-02 — D-013 touch targets

**The field that looked tappable and was not.** `KubInput` paints a 44px field
and the `<input>` sat inside it at its intrinsic 20px, vertically centred. Proved
by tapping rather than by measuring: a click 4px below the field's visible top
edge left focus on `body`, while a click in the middle focused the input. The
control looked like a 44px target and answered only in its middle 20px, so a
mobile user missing it low or high hit nothing at all.

**Fixed** with `h-full` on the input. Pinned by a test in
`tests/e2e/interface-focus-visibility.spec.ts` that taps the top and bottom
edges and asserts the input takes focus; removing `h-full` makes it fail. The
test taps rather than measures on purpose — a min-height would satisfy a
measurement while leaving the dead zone.

**Password reveal toggle**, login and register: a 16x16 button inside a 44px
field, the hardest thing on the form to hit. The icon stays 16px; the button now
carries a 44px box with a negative margin so the field's height is unchanged.

**`Забыли пароль?`**: a standalone action 16px tall. It is not a link inside a
sentence, so it is held to the target size; padding grows the hit area without
changing the type size.

**Deliberately not changed.** `Зарегистрироваться` and
`Политикой конфиденциальности` sit inside running sentences, where the target
size requirement does not apply. Enlarging them would mean restyling prose, and
the batch was scoped to keep that out.

**Harness correction found by this batch.** The first re-audit still reported
the fields at 42px, because the missing two pixels are the wrapper's own border.
The check now measures the effective tappable box — a control that fills a
bordered wrapper counts as that wrapper — with tests in both directions: a
filled 44px field is not a finding, and a small control inside a large wrapper it
does not fill still is.

**Result.** The login surface went from 6 touch-target findings to 2 on mobile
and 0 on desktop, and the 2 that remain are the exempt prose links.

**Still open:** the header links and the logo link at 28-32px on the public
surfaces, the support form's checkbox at 16px, and the tasks view switch at
30px, plus D-004, D-005 and D-008 from the earlier pass.

## D-015 — the shared button size scale is below the touch target

**Severity:** P2, but the widest entry in this register: it is one component,
used everywhere.

**Where:** `sizeClass` in `artifacts/kub/src/components/kub/KubButton.tsx`.

| size | height | meets 44px |
| --- | --- | --- |
| `sm` | 32px | no |
| `md` | 40px | no |
| `lg` | 48px | yes |
| `icon` | 36px | no |

Three of the four sizes are under the target, and `size="sm"` alone appears 118
times across 41 files. Every one of those is an undersized target on a phone.

**Deliberately not fixed in the touch-target batch.** Raising the scale changes
the height of most buttons in the product, which is a visible design change and
would have turned a scoped batch into a restyling. It needs its own decision and
its own before/after review.

**The option worth reviewing first** is to keep every size exactly as it looks
and grow only the hit area on coarse pointers, so desktop layout is untouched
and a phone gets a real target. That keeps the visual scale, which is the part
the owner chose, and fixes the part that is measurably wrong.

**Local consequences accepted for now.** The privacy page's `Версия для печати`
is a `KubButton size="sm"` and stays 32px until this is decided; its neighbour
`Задать вопрос` is a plain link and was raised to 44px in fix batch 2.

# Fix batch 3, 2026-09-02 — the rest of D-013 on the public surfaces

**Shared public header**, which serves the home, privacy and support pages: the
logo link was a 28px target and the navigation links and the sign-in action were
32px. All now carry a 44px box; the marks and labels keep their size.

**Privacy table of contents**: 22 entries at 32px. These are standalone
navigation rather than links inside a sentence, so they are held to the target
size; the type size is unchanged and only the row height grows. That one change
accounts for most of the page's cluster.

**Footer contacts** on every public page: two `mailto:` links at 16px, again
standalone rather than inline in prose.

**Two more harness corrections, both found by re-auditing rather than by
reading.** A control that fills a bordered wrapper now counts as that wrapper —
the fields were still being reported at 42px because the missing two pixels are
the wrapper's border. And a control wrapped in a `<label>` is now measured by
the label, because a label toggles its control natively: the support form's 16px
consent checkbox sits inside a padded row that is the real target, and calling
it undersized would have led to inflating a checkbox that was already fine. Both
directions are tested, including a bare checkbox with no label, which is still
reported.

**Result on the public surfaces at 390x844**, findings before and after this
stage: home 5 → 0, privacy 22 → 1, support 12 → 1, login 6 → 2. Everything that
remains is either an exempt link inside a sentence or the `KubButton size="sm"`
deferred to D-015.

# Fix batch 4, 2026-09-02 — D-015 closed for touch, scale untouched for pointers

**Fixed**, and with a correction to what this register proposed. The entry
suggested growing the hit area with an overlay so the layout would not move at
all. Thinking it through further, two adjacent 32px controls would then have
overlapping 44px hit areas and one would start stealing the other's taps —
worse than the defect. The rule raises the real height instead, and is scoped to
`@media (pointer: coarse)`: a finger gets a real target, a cursor sees exactly
what it saw before. The size scale, which is the part that was chosen, is
untouched on a pointer device.

**Both halves are pinned**, in `tests/e2e/interface-focus-visibility.spec.ts`.
One test asserts a small button reaches 44px under `hasTouch`, the other asserts
the same button stays under 44px with a fine pointer. Testing only the first
would pass equally well if the scale had been raised for everyone, which is the
change that was deliberately not made. Both mutations fail: removing the rule
breaks the touch half, applying it to every pointer breaks the other.

**A harness correction this exposed.** The audit measured phone viewports with a
mouse, so `(pointer: coarse)` never matched and it would have reported this fix
as having changed nothing. Mobile viewports now emulate touch.

**Result at 390x844 with touch**: privacy 1 → 0, home 0, and the only findings
left anywhere on the public surfaces are links inside sentences, which the target
size requirement does not cover.

**Still open:** D-004, D-005 and D-008 from the earlier pass, and the
shell-specific audit of Windows and Android.

# Shell audit, 2026-09-02 — Android

Run inside the real Android WebView rather than against an emulated viewport.
A debug build of the branch was installed under a suffixed applicationId, the
WebView's DevTools socket was forwarded over adb, and the same checks the
browser audit uses were evaluated in the shell itself.

**The device confirms the D-015 fix on real hardware.** `(pointer: coarse)`
matches and `(any-hover: hover)` does not, so the touch rule is active rather
than merely emulated, and the primary action measures 48px in the shell.

**Findings: two**, both the links inside sentences that the target size
requirement does not cover. Everything else on the login surface is clean in the
shell.

**Keyboard insets behave.** Focusing a field takes the viewport from 748 to 482
and the layout resizes with it, so the form is not left behind the keyboard: the
primary action moves from a bottom edge of 483 to 402 and stays fully visible.
No defect.

**Capture stopped on the second phone.** Its first screenshot caught an unrelated
video call in a floating window. The image was deleted rather than kept or
described, and the audit continued on the other device and through the DevTools
bridge, which reads the page rather than the screen. Nothing personal from either
device is recorded anywhere.

**Cleanup:** the debug package is uninstalled from both phones, both still report
`com.kub.messenger 0.1.2`, the port forward is removed and `build.gradle` is
reverted.

# Shell audit, 2026-09-02 — Windows

## D-016 — outside the messenger the desktop window cannot be moved or closed

**Severity:** P1. It affects the login screen, which every desktop user sees
before anything else, and it removes control of the window rather than making it
awkward.

**Where:** `windows-tauri/src-tauri/tauri.conf.json` sets `"decorations": false`,
so the application draws its own title bar. That bar is `AppTopBar`, and
`AppTopBar` is rendered only by `MainLayout` — the authenticated messenger.

**Reproduction, confirmed by doing it rather than by reading the code.** Open the
Windows application while signed out. The window's top edge carries no title bar
and no minimise, maximise or close control. Dragging from the top strip does not
move the window: it stays exactly where it was. The only ways out are Alt+F4, the
taskbar, or the window edges for resizing.

**Surfaces affected:** login, register, the loading screen, the retryable
loading error, and the ban screen — everything the messenger shell does not
render.

**Fixed** with `DesktopWindowChrome`, which renders nothing outside the Windows
shell and nothing where `AppTopBar` is already present, so the messenger keeps
exactly one title bar. Its glyphs mirror `AppTopBar`'s so the two cannot drift
apart.

## The rest of the Windows shell

The updater surface behaves: with an update available the pill reads
`Доступно обновление` with `Обновить` and `Позже`, and it sits inside the content
area rather than over a control. No finding.

The window is `resizable: true`, so edge resizing worked throughout, which is why
the missing chrome was a loss of control rather than a trap.

## D-017 — the entry document has no cache policy, so clients keep running an old build

**Severity:** P1, and not an interface defect at all — it was found by trying to
verify one. It can leave every client on an old build indefinitely.

**How it surfaced.** After deploying the D-016 fix, the Windows shell still
would not let the window be dragged. The fix was live: fetching the deployed
bundle and rendering it with a stubbed desktop bridge showed
`desktop-window-chrome` present, 32px tall, with three buttons. The shell was
simply running an older `index.html`.

**Measured:**

| resource | Cache-Control |
| --- | --- |
| `/` (index.html) | *absent* |
| `/assets/index-*.js` | `public, immutable, max-age=31536000` |
| `/sw.js` | `no-cache, no-store, must-revalidate` |

`index.html` names the hashed asset filenames, so it is the document that
decides which build a client runs. With no directive its freshness falls to a
browser heuristic, typically a fraction of the time since `Last-Modified`, and a
client can keep loading the previous bundle long after a deploy.

**The configuration already reasons this way one block further down**, where
`/sw.js` carries the comment "must NEVER be cached, otherwise updates stick".
The entry document needed the same treatment and had been missed.

**Fixed** with an explicit `Cache-Control: no-cache` on `index.html`, which
costs nothing in traffic because the assets it names stay immutable. Pinned by
`tests/unit/web-cache-policy.test.mjs`, including a check that the SPA fallback
does not reintroduce a long cache for the documents it serves; deleting the
block fails it.

**Observed in passing during the same deploy:** for a short window the served
`index.html` referenced an asset that returned 404, and it resolved by itself on
the next poll. That is the rolling replacement briefly serving a new document
with the previous replica's assets. Recorded rather than acted on — it is
transient and self-correcting, but worth knowing before reading a 404 as an
outage.

# Fix batch 5, 2026-09-02 — D-008 closed

**Fixed.** The single-line condition is gone from `canInline`. Whether the meta
fits was already a measurement — `available` is the room left after the *last*
rendered line, however many lines there are — and the extra condition sat on top
of it refusing every wrapped message. A bubble whose last line ended well short
of the edge still grew a row containing nothing but a right-aligned timestamp.

**Why the register held it back, and why that is now settled.** The concern was
oscillation, since `MeasuredTextWithMeta` carries `inlineBlockedRef` to stop
placement flapping. It cannot loop: the guard above the calculation flips to
anchored and sets that ref the first time an inline footer fails to land on the
last text line, so a given message changes its mind at most once. A test asserts
placement is unchanged across two further settling periods.

**Tested against the DEV preview capture route** with an injected fixture, so
the messages are deterministic and no production conversation is involved.
Passes at `1440x900` and `390x844`. Restoring the single-line condition fails it
with the D-008 message.

**One limitation, recorded rather than papered over.** The anchored branch is
asserted as an invariant instead of by constructing a message that must take it.
Bubbles are `w-fit`, so with normal wrapping the last line is never the widest
and a wrapped message essentially always has room — the anchored case cannot be
built reliably from text. What is asserted instead is the property that matters
either way: an inline time never overlaps the words it sits beside. An earlier
draft of this test measured room against the bubble's outer edge rather than the
text's right limit inside it, which is a different quantity from the one the
component decides on; that assertion was removed rather than left in looking
meaningful.

**Chat contracts re-checked:** scroll anchoring, history anchoring, footer
stability and read synchronisation all pass.

# Fix batch 6, 2026-09-02 — D-004 and D-005

Both were recorded as design decisions rather than defects with a single correct
answer, so both changes are deliberately restrained and the before and after
were put in front of the owner rather than asserted.

**D-004 — fixed.** The read count was a `<button>` that opened the receipt list
and looked like more text: a bare `3/3` after a timestamp. Its accessible name
was already correct, so the information existed for assistive technology and for
nobody else. It now sits in a faint chip with its check icon and carries a focus
outline, so it reads as one pressable unit. No word was added to a row that is
already crowded.

**D-005 — addressed by grouping, not by resizing.** Reading the row properly
first showed the premise needed correcting: the sizes already form a coherent
scale — 12px flags, 13px status, 20px actions, one type size throughout — so
three icon sizes is a hierarchy rather than an accident. What was missing was
separation. A single step of extra space now divides the flags that can precede
the time, the pin and `изм.`, from the status cluster of time and delivery,
which belong together. Nothing is resized, moved or removed.

**Verified by regenerating the previews and looking at the pixels**, as this
register requires of anything that changes how messages render, not by reading
the diff.

**A test correction this exposed.** The footer-width contract matched a literal
`className="…"` on the time element. Composing that class with `cn()` — which
the conditional spacing needs — made it fail on a change that kept every
property it exists to protect. It now reads the element and checks
`tabular-nums` and `shrink-0` within it; removing either still fails it.

## D-018 — the auth screen offered a scrollbar with nothing to scroll to

**Severity:** P2, reported by the owner, who saw it in the browser and in both
native shells.

**Where:** `.kub-auth-shell::after` and `.kub-auth-mascot` in
`artifacts/kub/src/index.css`.

**Measured.** `.kub-auth-shell` scrolls on purpose so the form stays reachable on
a short window or with a keyboard up. Two decorative layers were absolutely
positioned inside it and hung past its bottom edge, so that overhang counted as
scrollable area:

| viewport | scrollable | 18% of the height |
| --- | --- | --- |
| 1440x900 | 162px | 162px |
| 1440x700 | 126px | 126px |
| 390x844 | 152px | 152px |

The match is exact, which identified `inset: auto -12% -18% 40%` on the glow.
The remaining 24px on a desktop and 48px on a phone were the mascot's
`bottom: -1.5rem` / `-3rem`.

**Two wrong guesses, recorded because they cost time and might be repeated.**
The first was that `overflow-x: hidden` was forcing `overflow-y` to `auto`; the
shell sets `overflow-y: auto` explicitly and deliberately. The second was that
the mascot alone was responsible — hiding it changed nothing, because the glow
was four times larger. The arithmetic, not the reasoning, found it.

**Fixed** by taking both decorative layers out of the shell's scroll area with
fixed positioning. Neither is interactive and neither needs to scroll with the
form, and their painted position is unchanged.

**Both directions are pinned** in `tests/e2e/interface-focus-visibility.spec.ts`:
nothing scrolls at three viewports where the form fits, and a 400px-tall window
still scrolls far enough to reach the sign-in button. Returning either layer to
absolute positioning fails it. Removing the scroll entirely would be the obvious
over-correction and would strand the button on a short window, which is why the
second half exists.

# Fix batch 7, 2026-09-02 — the status chip, and two tones it exposed

The chip is `KubBadge`: 69 uses across 16 files, so one component carries every
status in the product. That leverage is why it came first when converting the
interface to the approved design.

**The pairing that failed.** The label was painted in the tone over an 18% tint
of the same tone. Measured across the three surfaces a badge sits on, that
ranged 3.17:1 to 5.55:1, and the audit caught `Активна` at 2.62:1.

**Removing the tint alone was not enough**, which is worth recording because it
was the obvious fix. On `--kub-surface-3` the tone as a label still measures
4.05:1 (cyan), 4.18:1 (pink) and 3.82:1 (danger) — all under 4.5:1. So the label
takes the interface text colour, which passes on every surface, and the tone
moves to the dot and border, where the requirement is 3:1 and every tone clears
it.

**That makes the dot load-bearing.** With a neutral label, a thin border would be
the only carrier of meaning, so the dot is on by default for coloured tones. It
also means status is never signalled by colour alone: there is a dot, a border
and a word.

**Two tones the contract then caught, neither noticed by eye.** In the light
theme `--kub-online` `#4FAE4E` measured 2.80:1 on white and 2.62:1 on the page,
and `--kub-warn` `#C2870A` measured 2.55:1 on `--kub-surface-3` — both under the
3:1 an indicator needs. Darkened along their own hues to `#3C8B3C` and
`#A8760A`. The dark theme's tones all pass unchanged.

**Pinned** by `tests/unit/status-badge-contrast.test.mjs`, which reads the tone
list out of the component and the colours out of `index.css`, so a new tone or a
changed token is covered without editing the test. Five mutations fail it:
painting the label in the tone, restoring the tint, dropping the default dot,
and reverting either light-theme tone.

# Fix batch 8, 2026-09-02 — the staff area's targets

The same two defects the public surfaces had, in the area the owner asked to be
reviewed, fixed as shared rules rather than per screen.

**Icon-only actions** — back arrows, row menus, clear buttons — were 28-32px
across `AdminLayout`, `AuditTab`, `BansMutesTab` and `UsersTab`. They now carry
`.kub-icon-action`, which keeps the dense 32px on a pointer device and gives a
coarse pointer the full 44px. Same bargain as D-015: the scale the design chose
is untouched where it shows, and a finger gets a real target.

**Search fields** repeated the D-013 shape: a 20px input floating inside a 40px
box, so the visible field answered only in its middle. The box is now 44px and
the input fills it.

**A test correction, recorded because it reported a fix as missing.** The first
version of the contract located the search field by the placeholder word
"Поиск" and did not find `AuditTab`'s, which is labelled "Имя или @никнейм" — so
it failed on a field that was already fixed. It now locates fields by what they
are, an input stretched inside a styled box, and checks every one it finds.

Pinned by `tests/unit/touch-target-system.test.mjs`; four mutations fail it,
including inflating the resting size for every pointer, which is the change
deliberately not made.

# Fix batch 9, 2026-09-02 — the last measured findings, everywhere

The batch that takes the whole matrix to zero. Before it: 52 findings on the
staff area, 44 on the client surfaces. After it, measured on the deployed build
at `abca555`: **160 cells — five viewports, both themes, sixteen surfaces —
0 findings, 0 unreachable.**

## D-019 — a sentence painted in the tone it is tinted behind

The inline notice set its text in `--kub-warn` on a wash of `--kub-warn`.
Measured on the live staff area, 3.74:1 for a warning and 3.98:1 for a success
figure, both under the 4.5:1 a sentence needs. A source scan found **76
instances** of the pairing across the product, so this was never one screen's
mistake — it was the house style.

`KubNotice` applies the rule D-011 settled for the badge: the sentence takes
`--kub-text`, which passes on every surface, and the tone moves to a 4px rail
and the border, where 3:1 applies and every tone clears it. The rail is what
keeps a notice reading as a warning once its sentence is neutral.

The staff area is converted here; the client surfaces are a later batch. The
trend percentage lost its green for the same reason — the bar directly beneath
it already carries that meaning at 3:1.

**Deliberately not converted:** the icon chip in `RecentActivity`. It holds an
icon, not a sentence, so 3:1 applies, and it measures 3.74:1 to 4.71:1 across
the three surfaces in both themes. The live harness, which applies the right
threshold per element, never flagged it either.

**Pinned** by `tests/unit/notice-contrast.test.mjs`. Four mutations fail it,
including hand-rolling the pairing back into a staff screen and removing the
rail — a tone nobody can see is a deletion, not a fix.

## D-020 — native controls nobody had tagged

Selects were 40px, and a 16px tick box inside a `flex items-center` label made
a 20px-tall row. Both are now covered **by element** rather than by an opt-in
class, so a select or tick box added tomorrow is correct without anyone
remembering. The reach is deliberately narrow — two element types whose intent
is universal — and the rule is touch-only, so the pointer scale is untouched.

The same sweep tagged the controls that had been missed by class: the sidebar
and folder actions, the tasks tab strip, the support filters, and the last
`p-2 rounded-lg` icon buttons in `ChatHeader` and `TasksPage`.

**The switch needed a structural change, not a class.** It was a 44x24 target
because the button *was* the track. The two are now separate: the track keeps
its designed 24px, and `.kub-switch` gives the control around it a full-height
target on a coarse pointer.

**Pinned** by `tests/unit/touch-target-system.test.mjs`, each rule in both
directions — a test that only checked the coarse half would pass equally well if
the whole scale had been inflated, which is the change deliberately not made.

## D-021 — a destructive button's label at 3.76:1

White on `--kub-danger`, measured on the live invites screen. It could not be
fixed by darkening the tone: the same token is the dot on a badge and the rail
on a notice, where a light red is what clears 3:1 against a dark surface. One
value cannot be both, so the fill became its own token —
`--kub-action-danger-background`, mirroring what `--kub-action-primary-*`
already did.

**Found beside it, same class:** the accent button was white on `--kub-pink`
at 3.43:1 in the dark theme. Its label now takes `--kub-bg`, which is exactly
how the primary action already makes a bright fill work, so the brand magenta is
unchanged.

Both dropped `hover:brightness-110`. Brightening a fill that only just passes
walks straight back into the failure; hover is now a declared colour.

**Pinned** by `tests/unit/action-button-contrast.test.mjs`, which reads the
filled actions out of the stylesheet rather than listing them, and checks the
hover value as well as the resting one.

## D-022 — an invisible tooltip made the messenger wider than the phone

The bubble was laid out permanently at `opacity: 0`. At 390px the one on the
sidebar's right-most button pushed the page to 393px, which the harness reported
as clipped content — the visible symptom of something nobody could see.

It now leaves the flow entirely until shown. `display` is what changes, so the
fade survives through `transition-behavior: allow-discrete` and
`@starting-style`. Two things came free: on a touch device, where hover does
not exist, the bubble is never laid out at all; and `:focus-within` means the
keyboard reaches it, which hover alone never did.

**Pinned** by `tests/unit/motion-contract.test.mts`, which now also refuses a
shared class that hard-codes a duration beside its tokens — the earlier version
accepted a rule with one token and one literal.

## A harness correction, not a product fix

Three reported links on `login` and `support` were **not defects**. Both WCAG
target-size criteria exempt a link inside a sentence: its height is set by the
line box of the surrounding text, and padding it to 44px would break the
paragraph. All three were of exactly that kind.

The exception's *limit* is what the test pins: a link alone in its container is a
button in all but name, gets no exemption, and is still reported. Widening the
exception to swallow it turns
`tests/unit/interface-audit-harness.test.mjs` red.

## Evidence

- Local dev server, full release matrix: 160 cells, 0 findings, 0 unreachable.
- Deployed production `https://app.letscube.ru` at `abca555`, two viewports
  and both themes: 64 cells, 0 findings, 0 unreachable.
- The deployed stylesheet hashes identically to the locally verified build
  (`index-Dme-bWla.css`), so the CSS measured here is byte-for-byte the CSS
  that shipped.
- Nine mutations checked across the four defects; all turn the suite red.
- Unit suite 686/687. The one failure is the pre-existing
  `android-release-signing` fixture, unrelated to the interface and already
  tracked separately.

# Stage 2, 2026-09-02 — bringing the staff screens to the approved design

The measured half is closed; this is the half the owner actually asked for:
"привести всё приложение" to the standard of the approved canvas. It is not
defect-driven, so each change below names the decision it implements rather
than a finding.

## Filters that say what they are doing

The users tab kept five selects open above the list at all times, and the
journal four. They cost the list the space it needed — on a phone the journal's
took the top third of the screen before a single entry was visible — and, worse,
an inactive select looks like an active one, so a filtered list read exactly
like the full one.

Filters now collapse behind a button carrying their count, and what is on shows
as chips that each remove themselves. New shared primitives: `KubFilterButton`,
`KubFilterChip`, `KubFilterSummary`. The remove control is a real button with
its own accessible name, so a filter can be dropped by keyboard and a screen
reader hears which one.

**Three counts were removed for being untrue, not added.**

1. `Условия отсеяли 0 пользователей`. After a server-side search the number in
   memory is the count of what matched, not of what was removed, and the
   unfiltered total is not there at all.
2. `Найдено 0 из 0` is true and useless; `5 из 5` invites the reader to look
   for a difference that is not there. Each branch now says only what it knows.
3. `Найдено 1 из 340` would be a lie on the users tab, where the search runs on
   the server and the other five filters run in the browser over one loaded
   page — 339 of those were never examined. When there is more than one page the
   line says so.

## States the screens did not have

A spinner in an empty panel says something is happening and nothing about what
is coming, and the layout jumps by the full height of the list when data lands.
`KubSkeletonRows` holds the final dimensions instead, with `aria-busy` and a
label because a shimmer is silent to a screen reader. Applied to the users tab,
the journal, invites and the sanction history.

`KubNoResults` replaces "Никого не найдено", which left a person to work out
that they were looking at a filtered list, which condition was responsible, and
how to undo it. It names the condition and offers to drop it.

The shimmer takes its own token rather than joining `MOTION_MS`: it is an
ambient loop, not a reaction to anything a person did, and the approved
interaction contract should not be widened to hold it. Under reduced motion the
movement goes and the block stays.

## One ambiguity the tests caught on production

With a single filter on, "Снять «X»" and "Сбросить всё" are the identical
action, and the empty state put them side by side under the summary line's own
reset. The production e2e run could not decide which button it meant — the test
reporting a real ambiguity rather than a test problem. The empty state now
offers the named one when there is one filter, and the reset otherwise.

## Evidence

- `tests/e2e/admin-user-filters.spec.ts`, four behaviours, green on the local
  build and on production.
- Ten mutations checked across the two batches; all turn the suite red,
  including a chip that hides itself without widening the list, a reset that
  forgets the search field, a skeleton that collapses to nothing, a skeleton
  silent to a screen reader, and either invented count coming back.
- Interface audit after the rebuild: users, journal, invites and bans measure
  0 findings at both viewports and both themes, including the filtered and
  empty states measured directly rather than at rest.
- The audit's own sweep does not reach a control that only exists while a field
  has text; measuring the filtered state directly found two 18px clear buttons
  that the resting sweep could not see.

# Stage 2, batch 3, 2026-09-02 — the rest of the staff screens, and a real defect underneath

## The list goes first

Locations, invites and roles each kept a creation form permanently expanded in a
left column, and in all three the list a person had come to read began below the
fold. Creating is occasional; reading is constant. `KubCreateSection` closes the
form and moves focus to its first field on open — without that the fields appear
somewhere below the button and a keyboard user has to hunt for them, which is
the usual reason a disclosure ends up worse than what it replaced.

The roles screen also carried three explainer cards across its top on every
visit, about 130px before the list. Deleting them would cost a first-time
administrator real help, so `KubHelpNotes` opens them by default and remembers
once someone closes them — per browser and per person, which is the right scope
for a statement about what one reader already knows.

## Copy removed for saying nothing

- "Административная роль" on every administrator row in locations, repeating
  what the badge beside it said — and it was the string being truncated.
- "Глобальная: нет · Локация: нет · Роль в локации: нет", three columns of an
  invite row to say what one phrase now says once.
- The metric cards' ordinals, 01 to 08, in tabular numerals beside the one
  figure on each card that means something.

## Clipping and a chart that overstated

Locations' assignment row went to four columns from 768px inside a panel about
590px wide, so a name got roughly 155px and came out as "Maxim Ko…", while a
role badge held a fixed 180px it never needed. Three selects and a button never
fitted one row at any width the panel reaches; they are two per row now.

The support queue's filters were sliced mid-word at the 350px column edge, and a
scroller with its bar hidden gives no sign anything is off to the right. They
wrap.

**A day with no registrations was drawn as a 3% bar.** On a 200px chart that is
a visible stub reading as a small number rather than as none, which is the one
thing a chart must not do. It draws nothing now. The 10% floor for non-zero
values stays: that makes a real value visible rather than inventing one.

## D-023 — a stalled session load locked people out of signing in

Found while chasing an intermittent e2e failure, whose page snapshot on
production showed the app sitting on its own "Загрузка длится дольше обычного"
panel.

`supabase.auth.getSession()` refreshes a stale token internally, and that
request can fail to come back. `loading` then stays true — and because the boot
gate covered **every** route, `/login` rendered the loading screen too. The one
route that can rescue the situation was unreachable; the only way through was
the "Выйти" button on the loading screen, which is a poor thing to require of
someone who just wants to sign in.

An auth route now renders on its own once the boot has been stuck for four
seconds. Measured on production in exactly this state, the form arrives in 4.6
to 4.9 seconds; a healthy `getSession()` settles in a few hundred milliseconds,
so nobody with a working session sees a form flash.

**Two wrong turns are recorded because they cost time and could be repeated.**

1. The first diagnosis of the flake blamed an expired saved auth state. The
   measurement behind it compared a state saved for `127.0.0.1:5191` against
   production and read the resulting public home as proof of expiry, when the
   helper had simply — and correctly — declined to restore a state from another
   origin. The expiry check written for that wrong reason is kept, but on its
   own merits: restoring a dead session costs a six-second timeout per test.
2. An earlier version of the recovery test stubbed **both** token grants, so the
   password grant the helper falls back to was stubbed too and the test passed
   for the wrong reason. Only the refresh grant is held open now.

## Evidence

- `tests/e2e/auth-boot-recovery.spec.ts` and `auth-helper-recovery.spec.ts`
  reproduce the stall deliberately. Three mutations turn the first red,
  including restoring the old all-routes gate and setting the grace to zero,
  which would flash the form on every healthy boot.
- `tests/e2e/admin-create-sections.spec.ts`, four behaviours; five mutations
  turn it red, including a form that opens without moving focus and an explainer
  that forgets it was closed.
- `tests/unit/e2e-auth-state.test.mts` pins the session-expiry rule including
  its margin: a session with five seconds left dies mid-test and counts as dead.
- Interface audit, full matrix on the deployed build: 64 cells, 0 findings, 0
  unreachable.
- One test was relocated rather than fixed: the auth-callback ordering contract
  matched the literal `if (loading || loadingError)` and went red when that
  condition was rewritten, reporting a regression in a contract that had not
  moved. It now asserts what it means.

## D-024 — the timestamp drifted into the middle of wrapped bubbles

**Reported by the user with a screenshot**, 2026-09-03. Desktop and mobile, both
themes, every wrapped message.

A bubble takes its width from its longest line, and the time flowed inline after
the last word. On a message whose final line is short, the time therefore landed
in the middle of the bubble. Measured on a 560px bubble: **348px, 328px and
157px** from the right edge, against 13px for a single-line message.

Fixed by pinning the meta to the bubble's bottom right and reserving its width
at the end of the last line with an invisible spacer. All cases now measure 13px.

Two pieces of reasoning in that code had gone stale and were removed:

- A guard flipped a message to a separate meta row whenever the footer was not
  vertically on the last text line. That question was about a footer in the text
  flow; with the footer positioned it has no meaning, and asking it anyway sent
  every short single-line message to its own row.
- The fit test asked how much room remained to the RIGHT of the last line. For
  an own message that is always zero — the bubble is pinned to the right edge
  and grows leftwards. Measured, a 150px message with a 29px timestamp inside a
  536px allowance was refused. It now asks whether the last line and the meta
  fit inside the width the bubble may reach.

Contract: `tests/e2e/message-meta-placement.spec.ts`, and
`tests/unit/message-bubble-meta-stability.test.mjs` rewritten around the
property rather than the removed latch. Both mutations turn it red.

**The e2e had been skipping on every run.** Its fixture stamps messages at 10:02
and the app refuses a message stamped later than "now", so before 10am the
capture route threw and the spec skipped itself. Its clock is pinned now.

## D-025 — hover actions overlapped the message they act on

**Reported by the user with a screenshot**, 2026-09-03.

The action cluster used `-right-20`, putting its right edge 80px past the
bubble while the group itself is about 92px wide — so it sat roughly 12px *over*
the message. Anchored to the bubble's edge instead, it now measures 7px of clear
air, and reads as one pill rather than three separately bordered circles.

The reaction row in the context menu was cramped at 32px and its "more
reactions" control showed the vertical ellipsis — the glyph that already means
"more actions" on the button beside every message. It is 40px (44 on a coarse
pointer) with a plus.

## D-026 — every message re-renders and re-measures on any change

Not user-visible as a defect in itself; it is the cost behind "the interface is
not smooth".

Measured on production against a CPU throttled 4x, standing in for a slower
machine: **switching chats dropped 22-72 frames of 124-348, with worst frames of
299-423ms and 786-1177ms of blocking.** Scrolling and typing measured clean at
60fps in the same runs, and at full speed everything measures clean — so this
bites people on modest hardware, not on this workstation.

Two contributions were found and one is fixed:

- **Fixed.** `document.fonts.ready` was read from every bubble's measurement
  effect. Counted directly: 291 reads across four chat switches, against 0 with
  the promise shared for the page; a CPU profile put it at 304ms of self time,
  the second largest non-idle entry, and it no longer appears in the profile.
  The ResizeObserver also watched five nested nodes per bubble, so one resize
  produced five measurements per message; it watches the two that can change
  independently. Contract:
  `tests/unit/message-bubble-measurement-cost.test.mjs`.

  **Stated plainly: this removed real work but did not measurably move frame
  timing.** Repeated throttled runs vary by a factor of nine on this machine,
  and the before/after distributions overlap.

- **Open, and the structural cause.** `MessageBubble` is not memoised and
  `MessageList` renders every message through `.map`, so any state change
  re-renders every bubble on screen — each then re-running a layout measurement
  that forces `getBoundingClientRect` and `getClientRects`. The profile still
  shows 173ms in `getBoundingClientRect` alone after the fix above.

  `React.memo` alone will not help: every callback prop is an inline arrow
  created per message per render, so no comparison would ever hit. Doing this
  properly means stabilising those handlers, and `MessageList` carries the
  critical scroll-anchoring contracts — so it needs its own change with its own
  verification pass, not a patch appended to a batch of visual fixes.

## D-027 — every message changed height a frame after it appeared

Reported as "лаги и визуальные баги при перелистывании", 2026-09-03. Found by
the critical contract `loading older messages preserves the visible history
anchor`, which had been skipping on every run until 2026-09-02.

Measured on production, on a chat of 100 messages: **304 height changes after
mount and 1865px of total growth.** Every one was the timestamp's placement
flipping from inline to a row of its own, adding 12-15px. The same churn broke
the reader's place when older history was prepended: the anchor drifted 1147px
while the content grew 6469px, against a contract that allows 3px.

Four causes, all fixed, and the order they were found in matters because each
one hid the next:

1. **The measurement ran after paint.** It went through
   `requestAnimationFrame`, so the first frame showed one layout and the second
   another. It now measures synchronously in the layout effect.

2. **The fit test read a width that depended on its own answer.**
   `parsePixelValue` accepted anything `parseFloat` would take, so a computed
   `max-width: 100%` came back as 100 *pixels*; `getMaxContentWidth` then fell
   back to the bubble's CURRENT width — the one quantity that differs between
   the two placements. Inline made the bubble narrow, the narrow bubble said the
   meta did not fit, anchored made it wide, the wide bubble said it did. It
   measures the row now, whose width is the same either way.

3. **The initial guess was written for the old layout.** A message longer than
   56 characters started with a meta row and dropped it a frame later — painted
   at 81px, settled at 59px. Inline is what the measurement almost always
   chooses now that the meta is positioned and its space reserved.

4. **A bubble mounting inside a prepended page was measured against a row that
   reported zero width**, which says the meta can never fit. Every prepended
   message therefore appeared with a row it did not need: measured, 706px of
   list height vanished at t=303ms and took the anchor with it. The measurement
   now declines to answer on a width that cannot be real and waits for the next
   pass.

The anchor restore was also made to hold. It ran once, at the moment React
committed the prepended page — the one moment the heights are guaranteed to be
wrong. It now repeats until four consecutive frames need no correction, bounded
by the safety timeout that already existed, and it is released by real input so
it never drags a reader back.

That release needed a distinction: the wheel that scrolls to the top of the
history IS the gesture that asks for the older page, so releasing on any input
cancelled the hold before it ran — the anchor still drifted exactly 445px,
identically across runs, and that reproducibility is what gave it away.

The contract passes on production. Scrolling back through a fully loaded chat
measured 0 drifts over 24px in 18 steps and no empty frames.

## D-028 — a chat lurched on entry, because a narrow row collapsed every bubble

Reported as "очень сильно дёргает при заходе", 2026-09-03. Reproduced on a
seeded chat of 1368 messages — the size is what made it visible.

Measured on entry: the view moved 9,734px while the content's height collapsed
from **26,366px to 10,464px** with the same hundred messages rendered. The
scroll is set against the tall version, so the reader is thrown.

The cause was the action lane added earlier the same day. `100%` in that width
cap is the message ROW, and the row is not its final width for the first frames
after a chat opens: measured at 142px in one sample, which took the lane term to
38px and wrapped a short message into **thirteen lines instead of four**.

Floored, the same entry measures a 1,290px settle rather than a 15,902px
collapse, and the first bubble renders 142x36 on one line instead of 40x281 on
thirteen.

**The second half of the report is not reproduced.** "Сверху вниз перелистывает
в рандомные моменты" did not appear in any of: sitting still for 45s scrolled
up (0 unrequested moves), three messages arriving from the other participant
while scrolled up (the reader kept their place; the gap from the bottom grew
from 4,200px to 4,403px, which is correct), leaving and returning to the tab, or
resizing the window. Recorded as open rather than treated as fixed by the entry
change.

The QA owner's chat `a04cccda` now holds 1368 messages for further work on this.

## D-029 — media previews load the full file, not a preview-sized one

Requested 2026-09-03: message media previews, and the gallery in particular,
should load a compressed version for preview rather than the original.

Investigated and largely fixed on 2026-09-04. The answer was neither of the two
guesses: the pipeline already produces everything needed and the message and
gallery paths already ask for it. The waste was in **avatars**.

What was measured first. The pipeline produces `image_thumb` (360px),
`image_preview` (1280px), `video_poster`, `video_720p`, `avatar_128` and
`avatar_256`; coverage is 124 of 127 image messages. `MessageBubble` already
takes `previewUrl` with a `srcSet` offering the 360px thumb, and the gallery
already takes `thumbUrl`. So the message surfaces were fine.

Avatars were not, for two compounding reasons:

1. `UserAvatar` could use a variant only through an optional `avatarVariant`
   prop, and six of forty-two call sites passed it.
2. It would not have helped anyway: the RLS policy on `media_variants` allowed
   reading only your **own** profile's rows, so somebody else's avatar could
   never resolve to a variant.

Measured on the administrator's user list, the densest avatar surface, with the
HTTP cache disabled: **7 avatar originals totalling 6,250 kB became 7 variants
totalling 20 kB**. Avatar originals average 734 kB against 2,717 bytes for
`avatar_128`. On a single private chat the page went from 215 kB to 87 kB.

Fixed in three parts. `20260904000000_avatar_variants_readable.sql` lets any
non-banned account read the two avatar variant kinds — which exposes nothing,
since the files are in the public `media` bucket and the profile's avatar URL
is already world-readable; message variants stay scoped to chat membership.
`lib/avatarVariantStore.ts` lets an avatar ask for itself, coalescing a whole
frame's ids into one query and remembering "this profile has none". And the
picture now waits for that answer before falling back to the original, because
starting the original while the answer is in flight downloads both — which is
how the first attempt still fetched 128 kB after the variant was already
working.

Still open, and smaller: `ChatAvatar` for a group chat has no profile to ask
about, so a group's own picture is still its original. Group avatars have no
variants in the pipeline today, so this needs the pipeline, not the client.

## D-030 — notifications read as one undifferentiated stream

Requested 2026-09-03, to be taken up after the profile decoration work: the
notification surfaces should carry more of the meaning they already have.

What the owner asked for, in their own terms: notifications that are more
interactive and better looking; colour that distinguishes one kind from
another; a preview when the message that triggered it carries an attachment;
and an urgent task from an administrator standing out — red was the example —
so that "у пользователя всё не смешивается в кашу". The stated goal is the
micro-moments that keep one thing from reading like another, not decoration for
its own sake.

Not yet investigated. What to establish before changing anything: which
notification kinds actually exist today and what each one already knows about
its subject (the notification centre groups them, so the data may already be
there); whether task priority and the administrator origin reach the client on
the notification itself or only on the task; and what the message payload
carries about an attachment, since a preview needs a variant URL rather than
the original — which ties this to D-029.

The colour work must stay inside the existing token palette and keep contrast
in both themes; an urgent red that only reads on a dark background would fail
the same audit that produced this register. Motion and feedback belong to the
approved shared-motion plan rather than to a second system built beside it.

## D-031 — the pre-paint theme script never ran

Found 2026-09-03 while investigating an unrelated console error in the
notification centre's e2e run, and confirmed against production before any of
that day's changes: `https://app.letscube.ru` threw
`SyntaxError: Unexpected token '.'` on every page load.

`THEME_INIT_SCRIPT` in `artifacts/kub/src/lib/themeRuntime.ts` is a template
literal that emits the inline bootstrap. It contained
`/letscube-night\/([01])/`, and inside a template literal a lone backslash is
consumed by the string — so the emitted regex was
`/letscube-night/([01])/`, whose inner slash closes the literal early. The
whole script failed to parse. Measured: `new Function(THEME_INIT_SCRIPT)`
threw the production message verbatim.

Two consequences, both of which had been observed and neither explained:

1. There was no pre-paint theme at all. Every load painted the default and
   then corrected itself once the application mounted.
2. The Android shell's night marker was never read. The WebView does not pass
   night mode through to the media query, which is why the shell writes
   `letscube-night/1` into the user agent — and that branch was unreachable.
   This is the most likely explanation for the open "Android cold launch is
   light" item; a reload has always been fine because by then the React path
   applies the theme.

Why nothing caught it: `tests/unit/theme-bootstrap-parity.test.mjs` compared
index.html against `THEME_INIT_SCRIPT` and they matched — being identically
broken. Parity proves the copies agree, not that either one works.

Fixed by doubling the backslash in the template literal and regenerating the
HTML copy. The parity suite now also parses both copies with `new Function`
and asserts the emitted pattern equals the marker the shell writes; all three
mutations of the shipped regression — both copies broken, either one alone —
turn it red. `tests/e2e/theme-bootstrap.spec.ts` drives a browser with the
night marker in the user agent and the system set to light, and asserts the
marker wins.

Still to confirm on a device: the Android cold-launch run, which is where the
symptom was reported.

## D-028 continued — four more triggers ruled out, and why the earlier ones could not have found it

Re-investigated 2026-09-04. Still not reproduced. What changed is that the
earlier attempt's method was found to be blind to the most plausible mechanism,
and that mechanism was then measured directly and found not to occur either.

**The earlier attempt counted the wrong thing.** It counted moves of
`scrollTop`. The leading hypothesis from a full reading of `MessageList.tsx`
does not move `scrollTop` at all: browser scroll anchoring is switched off on
both the scroller and the content (`[overflow-anchor:none]`, lines 650 and 656)
and the custom anchoring runs only during a history prepend. So if a bubble
above the viewport shrinks by N pixels, everything below slides up by N and the
reader is carried *down* the history with `scrollTop` unchanged. That is
"сверху вниз", and it would have measured as zero moves.

Measured directly instead: scrolled up in a 1 367-message chat, then sampled
four times a second for three minutes — `scrollTop`, `scrollHeight`, and the
`data-message-id` of whatever sits under a fixed point in the middle of the
viewport. **Zero events.** Nothing moved, nothing resized, and the message under
the probe never changed. That also covers the 60-second media-variant refresh
interval, which the earlier 45-second observation stopped one tick short of.

Also ruled out, each by measurement:

- Scrolling up with the keyboard during the entry lock and then waiting for the
  whole ladder of settle timers: the reader stayed 3 832 px from the bottom and
  the down-arrow was correctly showing.
- The same with the wheel: 3 741 px, arrow showing.
- The other participant marking the chat read while the reader is scrolled up —
  the hypothesis being that the receipt re-keys every outgoing bubble's
  measurement and shrinks the content above. `chat_members.last_read_at` was
  updated for the other member mid-measurement; nothing moved. Weaker evidence
  than the others, because it was not confirmed that the receipt produced a
  visible change on this account.

Real findings from the reading, which stand whether or not they are the
reported symptom:

- `handleScroll` (line 370) sets `isAtBottomRef.current = true` **without
  measuring** for as long as the entry lock is armed, and nothing resets it
  until the next scroll event after the lock expires. An assertion that outlives
  the condition that justified it.
- `releaseScrollControl` was wired to `onPointerDown`, `onTouchStart` and
  `onWheel` but not to the keyboard, so PageUp, Home, the arrows and space
  scrolled the list without telling the component the reader had taken over.
  Fixed, as a consistency fix and labelled as one: removing the fix again does
  not change any measurement that could be taken here, so no test claims it
  does. Every other input device released the hold; the keyboard now does too.
- `pendingJumpRef` in `ChatWindow.tsx` is cleared only on success, and the retry
  effect runs on every `messages` identity change, so a jump that failed
  minutes ago can fire when its target finally mounts. Not observed; recorded.

The entry lock's duration and its ladder of eight timers were doubled in
`07b5a0d` (2026-06-23) from 1 800 ms and five timers to 4 200 ms and eight.
That commit most enlarged the window in which the list moves itself, and is the
first place to look if the symptom is reported again.

What would settle it: the symptom needs to be caught while it happens. The
probe above — `scrollTop` plus the message id under a fixed point, sampled per
frame — is the instrument, and it is drift rather than a jump that it is
looking for.

## D-013 closed — two were already fixed, and the third had been fixed into a different defect

Re-measured 2026-09-04 with the register's own harness (`PAGE_CHECKS` from
`scripts/interface-audit.mjs`, imported rather than reimplemented) at 390x844
and 412x915, both themes, with touch emulation. The three items the earlier
passes left as "Still open" were checked rather than assumed, and only one of
them was still real.

**Header links and the logo link — already fixed.** Measured on `/`,
`/download`, `/privacy` and `/support`: the logo link 28x44, «Конфиденциальность»
147x44, «Войти» 80x44. Fix batch 3 put `min-h-11` on all of them in
`PublicPageShell.tsx`; the "still open" note predates that batch and was simply
stale.

**The support form's checkbox — already fixed.** The input measures 24x24 and
its `<label>` row — which is the real target, because a label toggles its own
control — measures 324x106. Closed by the coarse-pointer rules in `index.css`
together with the harness's label correction.

**The tasks view switch — the target was fixed, and the fix left a visual
defect.** The 30px is long gone: the segments carry `kub-button`, so D-015's
coarse-pointer rule grows them to 44px on a phone without anyone touching this
page. What that rule could not reach was the track around them, pinned at `h-9`.
Measured with touch: segment 168..212 (44px) inside a track 165..205 (36px) — an
**11px overhang**, with the active segment's filled pill visibly breaking out
through the rounded bottom border. On a cursor the same control is correctly
nested, 30px inside 36px, which is the designed scale and why nobody saw it.

This is precisely the mistake `KubSwitch` documents — a fixed decorative size
sitting on the element that has to grow — so it takes the same fix: `h-9` became
`min-h-9`, the designed height as a floor rather than a clamp. After: 44px
segment inside a 50px track with a 3px inset on a finger, unchanged at 30/36 on
a cursor.

The hit area was deliberately **not** grown past the track. Fix batch 4 rejected
overlay hit areas, and a segmented control has two targets sharing one track, so
each segment has to be 44px itself and the track has to follow.

**What the test asserts, and why it is containment rather than height.** Under
the mutation that restores `h-9`, the `>= 44` height assertion still *passes* —
the segment really is 44px, just in the wrong place. Overhang is the load-bearing
assertion. Both mutations turn it red in the right direction: restoring `h-9`
fails the touch case only, and inflating the track for every pointer fails the
cursor case only.

Harness re-measure after the fix: **0 touch-target findings across all 20
cells**. D-013 is closed.

Noted so a later reading does not mistake it for a finding: the tasks search
input measures 42px inside a 44px bordered wrapper, and the harness correctly
counts 44 — the missing 2px is the border.


## A note on how to read this register

Added 2026-09-04, after it cost an assignment.

This file is append-only: an entry keeps its original text forever and a fix is
recorded in a `# Fix batch N` section at the end. That is good for history and
bad for anyone reading top to bottom — D-008's entry still said "**Not fixed
here**" nine hundred lines above the batch that closed it, and work was
commissioned against three defects of which two were already done.

The checkbox in an entry's heading is the answer. `[x]` means closed, with a
pointer to where. Before acting on an entry, check its box and search the file
for its identifier: the last mention is the current state, not the first.

## D-004 closed — the chip shipped as markup and was invisible

Batch 6 recorded this as fixed on 2026-09-02, "verified by regenerating the
previews". It could not have been: the product previews contain no own group
message, and the chip only ever renders on an own message —
`getGroupReadReceiptInfo` returns null for anyone else's — so it was never in
the pictures that were checked.

Measured on 2026-09-04 against the surface it actually sits on, which is always
the tinted own bubble (`--kub-cyan` at 22% over `--kub-surface`): the faint fill
alone came to **1.07:1 in dark and 1.11:1 in light**, against the 3:1 that a
control boundary asks for. Rendered and looked at: "3/3" read as bare text after
the timestamp — the original defect, unchanged.

Fixed with a border in the accent already used for this chip's hover and focus,
so no new colour enters the product: **3.78:1 dark, 3.90:1 light**. The chip
grew 40→42px wide, its height and the bubble's 173x55 are unchanged, so the
footer measurement D-008 depends on is undisturbed.

The test that now protects it computes the ratio from `index.css` rather than
looking for a class name. That distinction is the whole point: a test that
searched for a class would have passed against the invisible chip, exactly as
the previews did. Removing the boundary — the state that actually shipped —
turns it red with the measured ratio in the message.

## The meta-placement contracts had gone back to skipping silently

The four tests in `tests/e2e/message-meta-placement.spec.ts` are the only thing
standing behind D-008, D-024 and D-027. They need the DEV capture route, and
when it was not served they skipped themselves — so a run of the suite reported
success while enforcing none of it. That is the hazard D-024 recorded ("the e2e
had been skipping on every run"), returned in a new form, and it was live
through this whole stage: every run of that spec against the ordinary dev server
reported `4 skipped`.

Absence of the prerequisite is now a failure that says what to set, and skipping
must be asked for with `KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1`. The dev-server recipe
sets `VITE_PUBLIC_PREVIEW_FIXTURE=1` so the ordinary path runs them: 5/5 pass.

## D-032 — a nearly-full last line still grows the bubble, 180ms after paint

Found 2026-09-04 while closing D-004, and deliberately not fixed. **Closed
2026-09-05 — see "D-032 and D-041 closed" at the end of this file.**

A message whose last line is nearly full takes the inline branch anyway, because
`getMaxContentWidth` measures the row and so over-estimates on purpose. The
reserve spacer then wraps and the bubble grows **+22px at t≈1999ms, 180ms after
first paint at 1820ms**. The time still ends up bottom-right and the history
anchor contract passes on the real chat, so this is a late reflow rather than an
anchor break.

Not fixed because the fix means re-reading a declared `max-width`, which is the
exact thing that caused D-027's feedback loop, and because D-024 calls the
over-estimate "the safe direction". Note that the existing stability test cannot
see this: it samples bubble index 1 only and compares a boolean.

## D-033 — a chat id alone reached a group's picture, for about an hour

Introduced by me in `0e6c5da`, found and closed in `64eb2cb` the same night.
Recorded because the reasoning that produced it looked sound in review.

The chat avatar variant row was scoped to chat members, with the argument that
a public row "would newly tell any authenticated non-member that a given chat
id has a picture, and where to get it, since the variant path is derivable from
the chat id alone". The scope was applied to the row. The bytes are served by
storage, and the check that would have caught this — fetching the variant as an
anonymous client — was not run until after the deploy:

    GET /storage/v1/object/public/media/variants/chats/<chat-id>/avatar_128.webp
    -> HTTP 200, anonymous

What actually holds a group photo private is that its original is written to
`chat-avatars/{chat_id}/avatar-{uuid}.png` and `chats`, the only place that name
appears, is readable through `Chat members can view chats` alone — so a chat id
was **not** sufficient. The derivable variant path made it sufficient.

Closed by deriving the variant folder from a hash of the source path, so it is
as hard to find as the original. Six objects already written to derivable
addresses were deleted first; the public URL went 200 -> 400. Their blobs remain
on disk (~45 kB, six files under `variants/chats/<uuid>/avatar_{128,256}.webp`)
because `storage.protect_delete()` correctly refuses direct row deletion and the
deletion was done through the database rather than by handling a service key —
**orphan cleanup is outstanding** and needs the Storage API with
`SELFHOST_SERVICE_ROLE_KEY`, which the operator supplies.

The lesson worth keeping: a policy on a metadata row is not a policy on the
object it addresses. For anything served from a public bucket, the access check
is the fetch, not the row.

## D-034 — the media variants worker retried, forever, work that could never succeed

Pre-existing, found 2026-09-04 while verifying D-033's deploy. Diagnosed and
fixed the same day; the fix is unpushed and undeployed at the time of writing.

`letscube-worker` logged `mediaVariantsWorker storage download failed`
(`StorageApiError`, status 400) exactly twice per 60-second tick — 826 times in
the seven hours before it was noticed, and it resumed at the same rate after
each redeploy.

**The path shapes were a red herring.** The 115- and 128-character
`media_path` values in the first measurement convert perfectly well: of 30 live
image messages with a 128-character path, 27 have both variants, and every
115-character path in the table is `ready`. `resolveStoragePath` was never
wrong. Two entirely separate causes were hiding behind one symptom.

### Cause 1 — two objects that are genuinely gone

Two live video messages carry `media_bucket`/`media_path` NULL and a
`media_url` on **`nhogbeojfnbjcfipitrh.supabase.co`** — the hosted Supabase
project this deployment moved off. `resolveStoragePath` reads the bucket and
key out of the URL and ignores the host, so the worker asked the self-hosted
`media` bucket for a key that only ever existed on the old project. Proven from
the storage service's own log:

    "error":{"raw":"{\"httpStatusCode\":404,\"userStatusCode\":400,
    \"resource\":\"…/1778030470210.mp4\",\"code\":\"NoSuchKey\"…}"

Storage answers a missing object with **HTTP 400 over a 404 body**, which is why
the log said 400 and why 400 read as a puzzle rather than as "gone". Twelve rows
point at the old host in total; ten are already deleted, two are live. The bytes
are not on this server and are not recoverable in code.

### Cause 2 — three objects whose bytes are not a picture

Three live image messages had `status='failed'` rows and **no log line at all**,
because a generation failure is recorded and never logged. Their objects exist —
68 bytes each, all three with the same eTag, replaced in place at
2026-09-03T21:33Z. Parsed on disk:

| chunk | length | CRC |
|---|---|---|
| IHDR | 13 (1x1, 8-bit, grey+alpha) | ok |
| IDAT | 11 | **wrong** |
| IEND | 0 | ok |

libpng refuses a critical chunk whose checksum does not match, so sharp raises
`vipspng: libpng read error` — reproduced locally against a byte-identical
reconstruction, which converts fine once the CRC is repaired. sharp's error is a
bare `Error` with no `code`, so it sanitized to `variant_generation_failed`,
indistinguishable from a transient failure. Six `media_variants` rows were being
deleted and re-inserted every 60 seconds, silently, since the objects were
replaced.

### Why either one lasted

The worker keeps no queue. Every tick it re-scans `messages` and asks
`media_variants` **only which kinds are `ready`** — so a row it had already
failed on looked exactly like a row it had never seen. Nothing could ever leave
the candidate set.

### The fix

A failure is now the worker's memory. Two codes describe the source rather than
the moment — `source_missing` (storage has no such object) and
`source_unreadable` (the bytes will not decode) — and a kind carrying one of
them, against the same bucket and path, is not attempted again. The download
path records a missing source instead of only warning about it, and warns once
rather than every minute. Everything else — a timeout, a 5xx, an upload the
service refused — is unchanged and still retried on the next tick, so the fix
cannot strand a picture that a later attempt would have converted. Replaced
media has a different source path, so the recorded verdict does not carry over
to it.

`safeStorageFailureDetails` now also carries the service's own `statusCode`.
The old log printed `{name, status:400}` and nothing else, which is precisely
why 826 warnings never said "not found".

No migration: `media_variants.error_code` has no CHECK constraint, and both
existing failure shapes re-record themselves as terminal on the first tick after
deploy. Expected production effect: four new rows for the two orphaned videos,
three messages' rows relabelled, two log lines, then silence.

Tests are in `tests/server/media-variants-terminal-failures.test.mjs` and drive
a real tick against a stubbed PostgREST and Storage, because the contract is
about the *second* pass. Ten mutations were run, including restoring
`status = 'ready'` to the candidate query and suppressing every failure rather
than the terminal ones; each was caught.

Not fixed, on purpose: the 19 objects that do exist needed no repair — 16 of
them converted on their own between the two measurements, because a 720p
transcode is slow, not because anything was stuck. The remaining three cannot be
converted by any code: their stored bytes are corrupt, and those three messages
already show nothing in the client regardless of variants. Repairing or removing
them is a data decision for the owner.

Profile and chat avatars were unaffected throughout — all 7 profiles and all 3
groups have their variants — but the avatar loader had the identical latent
defect and is covered by the same change.

## D-035 — every variant the worker uploaded carried a doubled max-age

Mine, from the media caching stage, found 2026-09-04 while verifying D-033 and
fixed in `43ec239`. The most useful entry here, because the source read
correctly the whole time.

`uploadVariant` passed the finished directive to the storage client's
`cacheControl` option. That option takes **seconds**: for a Buffer body the
client writes ``headers["cache-control"] = `max-age=${options.cacheControl}` ``
itself. So every variant this worker produced was served with

    Cache-Control: max-age=max-age=31536000, immutable

an unparseable delta-seconds. That is worse than sending nothing — a client
that cannot parse `max-age` does not cache, so the saving the whole caching
stage was written to buy was not being collected on anything the worker made.

Scope, measured on production rather than reasoned about:

| uploaded by | body | header before the fix |
|---|---|---|
| worker variants | Buffer | **`max-age=max-age=31536000, immutable`** |
| user / chat / bot avatars | Blob | `max-age=31536000, immutable` |
| message media | Blob | `max-age=31536000, immutable` |

Only the Buffer path was wrong: a Blob is sent as a form field the service reads
verbatim. The existing profile and message variants read correctly **only**
because the earlier backfill re-uploaded them through the raw API, which is
precisely what kept this hidden — the objects a source reviewer would have
sampled were the repaired ones.

Fixed by sending seconds through `cacheControl` and the real directive through
`headers`, which the client applies last. The six chat variants were regenerated
and re-checked on the wire. The test drives the real client and asserts the
header it emits, and pins the broken shape too, since a source scan is what
missed this.

Worth carrying forward: **for anything whose value a library reformats, the
assertion belongs on the wire, not on the argument.**

### D-034 — closed in production, 2026-09-04

Deployed as `388c6be`. Verified on the running worker rather than in the test
suite:

| | before | after |
|---|---|---|
| `storage download failed` in the log | 20 per 10 min | **0 per 3 min** |
| anything at all beyond healthz | two warnings a tick | nothing |

The failures are now recorded instead of repeated. `media_variants` carries
`source_missing` on 4 rows / 2 messages (the two videos whose bytes only ever
existed on the hosted project the app moved off) and `source_unreadable` on 6
rows / 3 messages (the 68-byte PNGs whose IDAT chunk fails its CRC — verified
independently by walking the chunks: signature valid, IHDR ok, **IDAT
mismatch**, IEND ok).

Five messages remain without a preview and always will: those two videos have
no bytes on this server, and those three images cannot be decoded by anything,
so they show nothing in the client regardless. That is now a fact in the data
with a reason attached, rather than a warning repeating every sixty seconds.

Two of the mutations were re-run independently before deploying: removing the
memory of a terminal failure fails 3 tests, and forgetting *which* source a
failure was about — so replaced media would never be retried — fails 1.

## D-036 — the decorative lattice paints a rule on the block's own edge

Reported by the owner on 2026-09-04 from a screenshot crop: near the edit
pencil, rules that should form a corner do not converge. Partly fixed the same
day; the mechanism is now measured rather than reasoned about.

**What was proven.** `.kub-grid-subtle` paints a 56px lattice with
`linear-gradient(colour 1px, transparent 1px)`, which puts its rule at the TOP
of every tile, and a background is anchored to the element's own padding box.
With no `background-position` there is therefore a rule at y=0 and at x=0 —
on the element's own edge, sharing it with whatever border sits there.

Measured on a standalone reproduction of the profile panel (header with
`border-b`, then the summary block carrying the class), read out of the live
DOM rather than judged by eye:

```
headerBottomBorderAtY   57
summaryPaddingBoxTopY   57      gap 0
latticeLinesAtY         57, 113
```

A 1px cyan rule and a 1px border occupy the same edge. That is what reads as
lines failing to meet.

**Fixed** by offsetting the lattice half a tile, so no rule lands on an edge of
the block that draws it. Same reproduction, both offsets measured: `0` gives
lines at 0 and 56 and hits the top edge; `28px` gives 28 and 84 and hits
neither. Mutation-tested — restoring the zero offset fails the test.

**What is NOT fixed, deliberately.** Each element still starts its own lattice,
so two adjacent blocks that both carry the class still cannot align with each
other. Making them share one requires the grid to live on a single ancestor
with the blocks transparent, which is a structural change larger than this
defect justifies. No two of the four surfaces that carry the class are
currently adjacent, so nothing depends on it today.

`.kub-grid-bg` has the same zero offset and is left alone on purpose: it is used
only on `min-h-screen` shells, where the edge in question is the viewport's and
there is no border to collide with. A test records that as a decision.

**Still unconfirmed:** whether this is the exact thing the owner photographed.
The crop was too small to identify the surface, and two earlier guesses at it
(the settings profile header, then a pair of adjacent lattices) were both
wrong. The mechanism above is real and measured either way.

## D-037 — the list jerks up and down on every chat entry

Reported by the owner on 2026-09-04: "пролаг при заходе в чат, каждый раз
происходит (дёргается интерфейс вверх и вниз на мгновение)".

Not yet reproduced or diagnosed. The shape — a visible settle immediately after
paint — points at the entry anchoring in `MessageList.tsx`: the list paints,
then scrolls to the bottom or to the first unread message, and the correction is
visible rather than instantaneous.

**Do not "fix" this by removing the scroll.** Section 11 of `CLAUDE.md` makes
the anchoring itself a contract: no unread means the bottom, unread means the
first unread, search and notification jumps land on the exact message, a history
prepend preserves the anchor, and fast upward scrolling must never snap. The
defect is that the correction is *seen*, not that it happens.

Worth measuring first: how many scroll writes happen between first paint and
settle, whether the list is scrolled before or after images and variants have
reserved their space, and whether `getMediaAspectStyle` is reserving the right
box for every media row. D-032 already records a bubble that grows 22px 180ms
after paint, which would move the anchor under exactly these conditions.

## D-038 — a sent message appears near the composer before it reaches the list

Reported by the owner on 2026-09-04: "при отправке сообщения оно появляется
где-то в районе модуля ввода текста и с пролагом попадает в чат".

Not yet reproduced. The description is a position error rather than a timing
one — the bubble is painted somewhere near the composer and then arrives in the
stream — which is the signature of a row rendered before the list has scrolled
to it, or of an entrance transform being seen against a list that is itself
moving.

The message entrance animation was changed the same day (`c2a8d1b`): it is now
opacity plus a 4px lift on new messages only, replacing an unconditional
`translateY(6px) scale(0.98)` that played on every mount. **Check whether that
change is implicated before looking anywhere else** — 4px is far too small to
explain "near the composer", but the interaction between the entrance and the
scroll-to-bottom is the obvious place to start, and if the two compound the fix
belongs in one of them rather than in both.

## D-037 and D-038 closed — one mechanism, measured frame by frame

Diagnosed and fixed 2026-09-04. Both reports are the same defect seen at two
moments, and neither is about where the list ends up.

**Every correction of the scroll position was scheduled with
`requestAnimationFrame` from a passive `useEffect`, so it ran after the browser
had painted the commit that made it necessary.** The first painted frame was
therefore always the uncorrected one. Measured on the real chat against
production data, a Vite dev server on a dedicated port with a QA account, every
scroll write intercepted and the container's geometry sampled per animation
frame:

### D-037 — entry

`ChatWindow` renders a spinner while a chat loads, so `MessageList` unmounts and
remounts on every entry and its container starts at `scrollTop = 0`, which is the
top of the loaded history.

| t (ms) | scrollTop | scrollHeight | distance from bottom |
|---|---|---|---|
| 403.8 | 0 | 3538 | **2808** |
| 471.4 | 0 | 3538 | **2808** |
| 492.0 | 42 | 3562 | **2790** |
| 495.4 | 2832 | 3562 | 0 |

Three painted frames, 88ms, at the top of the history, then a snap of 2790px.
Two screencast frames 85ms apart show it: the conversation opens on its oldest
loaded day and the next composited frame is at the newest message.

Thirteen scroll writes were issued in the first 4.6 seconds. The first was
`behavior: "smooth"` from the message-count effect — and it never delivered
anything, because Chromium's smooth scroll eases in: it covered 42px of 2808 in
88ms before an instant write from another path overtook it. The remaining eight
were the `[120, 320, 680, 1200, 1750, 2600, 3600, 4150]` settle timers, all of
which found the position already correct.

### D-038 — send

| t (ms) | rows | last row top | container bottom | row bottom |
|---|---|---|---|---|
| 3.6 | 54 | 592.8 | 806 | 781.5 |
| 90.6 | 55 | 681.5 | 830 | **865.8** |
| 138.1 | 55 | 678.5 | 830 | 862.8 |
| 141.1 | 55 | 621.5 | 830 | 805.8 |

For three frames and 50ms the sent bubble was painted 36px *below* the bottom
edge of the list — clipped, hard against the composer — and then jumped 57px up
into the stream. That is "появляется где-то в районе модуля ввода текста и с
пролагом попадает в чат", photographed. The composer shrinking back to one line
in the same commit moved the container's own bottom edge 24px at the same
moment.

**The entrance animation from `c2a8d1b` is ruled out as the cause.** Measured,
it applies correctly and its transform is 4px against a 61px displacement. It
did, though, hide a second defect of its own: the bubble faded in at t=68ms,
finished at t=182ms, and **faded in again from opacity 0 at t=231ms** — the
moment the optimistic `tmp:` row was replaced by the server row. Two React keys,
two DOM nodes, two plays of the animation. A message you had just sent blinked.

### The fix

The placement now happens in a layout effect — after React has written the DOM
and before the browser paints — so the first frame is already the settled one.
Nothing about the anchoring changed: same targets, same guards, same settle
timers, same older-history hold. `scrollToBottom` still exists for the deferred
passes and for the scroll-to-bottom button, where smooth is a user action.

The `ResizeObserver` correction moved inside the callback too. That callback runs
after layout and before paint, which is the only place that can catch the bubble
reflowing 22px on its own (D-032) — no React commit describes it. Deferred by a
frame it was painted first and corrected after, and that was the last visible
step on entry.

The entrance is now tracked by `messageEntranceKey` — `client_message_id`, the
one value the optimistic row and the server row share — so the swap no longer
counts as an arrival. `advanceMessageEntrance` takes the rendered ids separately,
because its idempotency cache has to key off what React rendered while arrival
has to key off what survives the swap; collapsing the two puts the double play
straight back.

### After

Same measurements, same server, same account:

| | before | after |
|---|---|---|
| entry: worst painted distance from bottom | 2790px | 24px, corrected inside the same frame |
| entry: painted frames away from the bottom | 3 | 0 |
| entry: smooth scroll writes | 1 | 0 |
| send: first frame with the new row | 61px out, 36px clipped | 0px |
| send: entrance animation plays | 2 | 1 |

Verified at 1440x900, 1920x1080 and 390x844.

### What was ruled out, and what could not be measured

`getMediaAspectStyle` reserves nothing for an image whose message carries no
width/height metadata: `MediaVideo` passes a 16/9 fallback, `MessageImage`
passes none, so `aspectStyle` is `undefined`, `hasReservedAspect` is false, and a
`loading="lazy"` image with `width: 100%` and no height occupies 0px until its
bytes arrive and then jumps to as much as 340px. It is a real unreserved-height
path and it would aggravate any of this, but it is **not** the cause: the wrong
frame is painted before any image has been asked for. It could not be exercised
live — none of the QA account's chats contains a media message — so it is
recorded from the code and left open.

D-032 is implicated but only as the residual: the bubble's own late growth
measured 12–24px here, inside the window the entry correction already covers.

## D-039 `[withdrawn]` — a history prepend is painted 1233px out for exactly one frame

**Read the withdrawal below before acting on any of this.** Re-measured
2026-09-05: the frame is never painted, and the fix this entry recommends was
implemented and measured to be considerably worse than the defect it claims to
remove. The entry is kept in full because the withdrawal is only readable
against it.

Found 2026-09-04 while proving that the D-037/D-038 fix left the older-history
anchoring alone. Measured identical **with and without** that fix, so it is
pre-existing and is recorded rather than changed.

Scrolling to the top of a chat and letting a page of older messages land, with a
witness row sampled every animation frame:

| t (ms) | witness offset | drift | scrollTop | scrollHeight | rows |
|---|---|---|---|---|---|
| 11509 | -38 | 0 | 100 | 6075 | 100 |
| 11967 | -80 | -42 | 4696 | 10591 | 200 |
| 12032 | 1195 | **+1233** | 4696 | **11866** | 200 |
| 12049 | -80 | -42 | 5971 | 11866 | 200 |

The restore does its job on the commit: 100 rows arrive and the reader keeps
their place within 42px. Then the prepended rows finish laying out and the
content grows another 1275px **without a React commit** — the same shape as
D-032, at a hundred times the size — and the hold loop, which runs in
`requestAnimationFrame`, corrects it on the *next* frame. One frame is painted
1233px out.

The settled contract holds and nothing snaps to the bottom, which is why every
existing check passes. This is the same class as D-037 and D-038: a correction
that is applied after the frame it belongs to. The obvious direction is the same
one that closed the 24px residual — the `ResizeObserver` on the content already
fires after layout and before paint, and it currently returns early while the
older hold is active precisely so it does not fight it; restoring the anchor
there instead of returning would land the correction a frame earlier.

Deliberately not attempted here. The older-history hold is the most tuned
mechanism in `MessageList` — this register already records 445px, 706px and
1147px measurements behind its current shape — the contract it serves is in
section 11 of `CLAUDE.md`, and nothing in CI can exercise it: it needs a signed-in
chat with real history, and the e2e suite is unauthenticated. It wants its own
task with its own measurement, not a change made in passing.

## D-039 withdrawn — the frame was never painted, and the proposed fix is worse

Re-measured 2026-09-05 in the task the entry above asked for. **Nothing above
this line survives except the caution.** No frame is painted out of place, and
the direction the entry recommended makes a real 1252px defect where there was
none.

### The instrument was wrong

The 1233px came from a `requestAnimationFrame` sampler. **rAF callbacks run
before style and layout**, so reading `getBoundingClientRect()` there forces an
early layout: it reports the layout the frame is *about to* have, which is not
what the previous frame painted. The hold loop is also a rAF callback, and it
runs later in the same phase. The sampler was reading the list between the
growth and its correction, inside one frame, and reporting it as a painted
frame.

A second probe settles it. A `ResizeObserver` created *after* the component's
own runs last among the observers — after layout, after every correction any
code can still make, immediately before the paint — so what it reads is what is
painted. A private element resized from rAF each frame gives it something to
fire on every frame, not only when the list changes size. Both probes, one
frame, with the intercepted writes numbered in order:

| reading | seq | witness offset | drift | scrollTop | content |
|---|---|---|---|---|---|
| rAF sampler, t=11977 | 22 | 1195 | **+1233** | 4696 | 11817 |
| *write #23, from `hold`* | 23 | | | 4696 → **5971** | |
| pre-paint probe, t=11978 | 23 | -80 | **-42** | 5971 | 11817 |

Same frame. The growth and its correction are both inside it, and the paint is
the corrected one.

The pre-paint probe is not blind to the real thing: with a deliberate control
that skips the correction on the frame the content grows, it reports
`worstPaintedDrift 1233` and one painted frame off anchor — and the control also
leaves the reader 1233px out permanently, which is what a broken hold actually
looks like. On the shipped code, over 13 consecutive prepends from 100 rows to
1368, it reports **0** painted frames more than 100px off the anchor and a worst
painted displacement of **42px**. Reproduced identically at 1440x900 and 390x844
and under 4x and 10x CPU throttling; at 390x844 the phantom is 1828px and still
nothing is painted.

A CDP screencast was run alongside and is recorded as a limitation rather than
evidence: it delivers about 13 frames a second even headed, so it cannot resolve
a one-frame event. Under 6x CPU throttling it caught frames either side of the
window and they are identical, which agrees with the probe but proves less.

### The proposed fix, measured

Restoring the anchor from the `ResizeObserver` while the hold is active —
exactly what the entry above suggested — was implemented and measured against
the same 13 prepends with the same probe:

| | shipped | with the observer restoring |
|---|---|---|
| prepends measured | 13 | 13 |
| prepends painting a frame >100px off anchor | **0** | **11** |
| worst painted displacement | 42px | **1252px** |
| painted frames displaced by the loading band | 465 (42px each) | 0 |
| frames snapped to the bottom | 0 | 0 |

The stacks say why, to the millisecond:

```
t 133640  scrollTop 4696 -> 5971   at hold (MessageList.tsx:365)
t 133641  scrollTop 5971 -> 4696   at ResizeObserver.<anonymous> (MessageList.tsx:463)
```

The observer runs after the hold, and it restores against
`olderScrollAnchorRef`, which `handleScroll` has meanwhile recaptured at the
pre-growth position — the restore write fires a scroll event, and the handler
recaptures on every scroll event while preserving. So the observer undoes the
hold's correction one frame later, and *that* frame is painted 1252px out. It is
the register's own warning, measured: the observer returns early there precisely
so it does not fight the hold.

Reverted. `MessageList.tsx` and `messageScrollAnchor.ts` are byte-identical to
what they were before this task.

### What was added instead

Guards for the two properties the measurement showed are load-bearing, in
`tests/unit/message-history-anchoring.test.mjs` and
`tests/unit/message-scroll-anchor.test.mts`: the hold restores synchronously in
its own rAF callback and releases only after four settled frames, the observer
carries no anchor restore, and the restore itself converges rather than
accumulates, lands an anchor exactly after the content above it has grown, and
clamps to the last scrollable pixel. Seven mutations, each verified to have
applied by matching the original text exactly once and confirming its absence
afterwards; all seven caught, including both halves of the reverted change.

The source guards are still source guards. The frame-level proof cannot live in
CI for the reason the entry above gives, and the rig that produced these numbers
is the only thing that can re-check them.

## D-040 — a sent message twitched the whole conversation a quarter-second after it landed

Found and fixed 2026-09-04, after the D-037/D-038 fix had already removed the
lag the owner first reported. What was left, verbatim: "только если в момент
когда они просто появляются в чате, прям резко очень будто с дёрганием по
горизонту" — the movement's quality, not its destination.

Measured the same way as D-037 and D-038: a Vite dev server against production
Supabase, signed in with the QA owner and, for the arrival case, a second
context signed in as the QA client in the same chat. Every write to `scrollTop`
and `scrollTo` intercepted with its stack, and a **witness row** — an ordinary
message already on screen — measured every animation frame. The witness is the
horizon; how far it moves between two consecutive frames is the whole question.

### Sending, while at the bottom, before

| t (ms) | witness moved | row height | meta placement | what happened |
|---|---|---|---|---|
| 0 | **-39px** | 38.8 | inline | the message arrives and takes its space |
| +14…28 | **-15px** | 53.8 | anchored | the bubble finds its real height |
| +250 | **+15px** | 38.8 | inline | the server row replaces the optimistic one |
| +265 | **-15px** | 53.8 | anchored | and measures itself all over again |

Four steps, 84px of travel for 54px of net movement, reproduced identically on
three runs. The last two are the defect: nothing about the message had changed,
yet the entire conversation stepped down and back up a quarter of a second after
it had settled.

The cause is the React key. `MessageList` keyed each row by `msg.id`, and a
message you send is rendered twice under two ids — `tmp:<client id>` first, the
server row after — so React tore the first node down and built a second one.
Everything `MeasuredTextWithMeta` had measured about itself went with it, and the
replacement started again from `getInitialMetaPlacement`'s guess.

### After

Keyed by `messageEntranceKey` — `client_message_id`, the one value both sides of
the swap share — the row is updated instead of rebuilt. Measured over three runs
at 1440x900, and again headed at the display's real cadence:

| | before | after |
|---|---|---|
| separate movements per sent message | 4 | 2 |
| witness travel | 84px | 54px |
| movement after the message settled | 15px down, 15px up | none |
| entrance animation | plays once, completes | unchanged |

**Receiving, while at the bottom, is unchanged and was already correct**: one
movement of 39–57px, the height of the arriving row, and nothing after it. So is
the section 11 contract — scrolled 700px up, an arriving message left `scrollTop`
identical to the pixel, moved the witness 0px, and only raised the counter.

The key is safe to derive: `addMessage` and `replaceMessage` both collapse a row
that is `sameActorClientMessage` with the incoming one, so the optimistic row and
its server row are never in the list at once.

## D-041 — every own message is painted one row short and grows on the next frame

Found 2026-09-04 while measuring D-040, and deliberately not fixed. **Closed
2026-09-05 — see "D-032 and D-041 closed" at the end of this file, which also
corrects this entry: the update from the layout effect WAS flushed before paint,
and a passive reset then overwrote it.**

`MeasuredTextWithMeta` decides whether the time fits beside the last line of text
or needs a row of its own. The two answers differ by a whole row — 38.8px against
53.8px for the same message — and the decision needs the bubble and the stack,
which it is handed as refs.

**React attaches a host ref during the layout phase, and that phase walks
children before parents.** Both elements are ancestors of the component doing the
measuring, so on the one mount that matters its own layout effect runs with
`bubbleRef.current === null`, returns at its first guard, and leaves the guess
standing. Instrumented on the real chat: the first pass logged `bubbleEl: false`
at t=167ms, the real one landed at t=268ms, and the row grew between them. The
comment above that effect — "Measure once SYNCHRONOUSLY, before this frame is
painted" — is true of every pass except the first.

The guess is `inline`, and for an own message the answer is always `anchored`,
because `getMaxContentWidth` measures `(stackEl ?? bubbleEl).parentElement`,
which is a shrink-to-fit flex item and therefore reports the bubble's *current*
width. Measured on a real own message: `maxContentWidth` 146, last line 144,
footer 67 — `144 + 67 + 8 > 146`, so the meta never fits, for any single-line own
message. A received message escapes only because that same parent includes the
32px avatar lane, which happens to leave room for its narrower footer.

Two fixes were tried and rejected, both by measurement:

1. **Run the first measurement from `MessageBubble`, where the refs exist.**
   Implemented and measured. The measurement then runs with both refs populated
   and decides correctly — and React still does not paint it. The state update
   scheduled from that layout effect was not flushed before the frame, in the DEV
   preview harness *and* on the real chat: the same four steps, unchanged. Backed
   out rather than shipped as machinery that does nothing.
2. **Fix `getMaxContentWidth` to measure the row a message may occupy.** This
   would make the guess right, but it moves the timestamp of every own message in
   the product from its own row to beside the text. That is a design change, not
   a motion fix, and it was not asked for.

What is left is one 15px step, 8–14ms after the arrival step it belongs to —
measured at 144Hz, one to two composited frames, so the reader sees the 54px
arrival with a stutter rather than a separate event. Closing it needs either a
guess that uses what the component already knows (whether the meta carries a
delivery indicator), which trades a certain miss on every own message for an
occasional miss in the other direction on wrapped ones, or the layout change
above. Both want a decision, not a change made in passing.

## D-042 — the loading band shoves the reader 42px, with a spinner they cannot see

Found 2026-09-05 while re-measuring D-039, on the same rig. Not fixed: the
obvious fix is the one measured above, and it is worse.

Asking for older history sets `loadingOlder`, which mounts the
"Загружаем историю..." band at the top of the scrolled content — the
`data-message-history-status` block in `MessageList.tsx`. It is **42px tall and
inside the scroller, above every row**, so the moment it appears every message
moves down 42px. No React commit describes that as a scroll change, and the
prepend layout effect ignores it on purpose: it acts only once rows have
actually arrived.

Measured, painted, across 13 consecutive prepends:

| | |
|---|---|
| painted frames displaced | 465 |
| displacement | 42px, every time |
| how long the reader sees it | ~250ms per prepend |
| where it ends | back at 0 — the restore compensates when the band goes |

The load triggers at `scrollTop < 160`, so the band is usually above the
viewport when it mounts: the reader is pushed by a spinner they cannot see.

Not a violation of the prepend contract — the anchor itself is restored exactly,
final drift 0px on the anchor row — but it is 42px of painted movement the
reader did not ask for, larger than the 24px residual that D-037 was considered
worth fixing.

Two directions, neither taken here. Taking the band out of the flow — the
overlay pattern the bulk-error banner in the same file already uses — is a
design change to the loading affordance and needs an explicit decision.
Restoring the anchor on the commit that mounts the band is a change to the hold,
and this entry's own sibling is the evidence for measuring any such change over
many prepends before believing it.

## D-032 and D-041 closed — one ceiling that was never applied, one effect that undid the measurement

Fixed 2026-09-05. Two defects, two causes, and they meet in the same eight lines
of `MeasuredTextWithMeta`.

Measured the way D-040 was: a Vite dev server on a dedicated port against
production Supabase, signed in as the QA owner, the geometry of the arriving
bubble **and of a witness row already on screen** sampled every animation frame,
plus a CDP screencast. Chat 0 is the owner's own "Избранное", so the sends this
needed reached nobody.

### D-041 — the guess was written back over the answer

The measurement did run before the first paint. It could not see the bubble,
because `bubbleRef` and `stackRef` point at ancestors and React attaches a host
ref during the layout phase, which walks children before parents. That much the
entry already said. What it missed is what happened next: even once the elements
are found and the placement is measured synchronously, a **passive effect resets
it**. The `useEffect` on `[content, measureKey]` that returns the placement to
`getInitialMetaPlacement` also runs on mount, after the commit, and puts the
guess back over the value the layout effect had just measured. The measured
value then returned through the `requestAnimationFrame` pass — one frame late.
That is why moving the measurement into `MessageBubble` looked as if React "did
not flush before paint": it flushed, and this overwrote it.

Both halves are needed and both are proven by mutation. The elements are now
read from the DOM — `textFlow.closest('[data-message-bubble="true"]')`, which is
populated by then because React inserts the whole subtree before it runs any
layout effect — and the reset skips its first run, which restores nothing
because `useState` already initialises to the same two values.

### D-032 — the ceiling existed and was never asked

`getMaxContentWidth` measured the row. The row is a shrink-to-fit flex item
around this very bubble, so it can be far wider than the design cap the stack
declares. Measured on a real own message at 1440: row 1008px, so the answer was
984px, while the bubble could never exceed 560px — 534px of content. A last line
of 506.7px was told it had 984px, chose inline, and the spacer that reserves
room for the time then wrapped.

The cap is now read from the stack's computed `max-width` and applied as a
`Math.min`. That string is `min(1238.4px, 560px, max(256px, 100% - 104px))` —
every unit already absolute, so it needs evaluating, not `parseFloat`, which
returns 100 for `100%`. `artifacts/kub/src/lib/cssLength.ts` evaluates it.

**Only the terms that do not move are used.** The `100%` term resolves against
the row, which grows with the content, and using it made the limit move with the
placement: measured, that flipped two already-settled messages in an unrelated
chat from inline to anchored and made them 15px taller. Percentages are
therefore asked as unbounded and drop out of the `min()`, leaving the fixed
design ceiling. A ceiling can only ever tighten the answer, so this cannot
reopen D-027's feedback loop.

### Sending, measured frame by frame, three runs each

| | D-041 before | D-041 after | D-032 before | D-032 after |
|---|---|---|---|---|
| bubble at first paint | 36.8px | **48.8px** | 59.5px | **71.5px** |
| bubble once settled | 48.8px | 48.8px | 82.3px | **71.5px** |
| change after it was painted | +12px | **none** | +22.8px | **none** |
| when | +15…30ms | — | +39…46ms | — |
| gap between the two witness steps | 28–31ms | **4–7ms** | 39–46ms | **4–5ms** |

The second witness step that remains is `MessageList` catching the bottom up by
the row's height; it is a scroll, not a resize, and it lands in the same frame
group. The 24px step earlier in the D-032 runs is the composer growing under the
typed text and is unrelated.

### Chat entry, no sends, matched pair on one revision, two runs each

| | before | after |
|---|---|---|
| 1440×900 — rows that change height after their first painted frame | **13 of 73** | **0** |
| 1440×900 — total late growth | 199.2px | **0px** |
| 1440×900 — latest correction | 111ms after the row appeared | — |
| 390×844 — rows that change | **60 of 73** | **0** |
| 390×844 — total late growth | 1356.7px | **0px** |
| list-height steps after entry | 1 | **0** |
| scroll steps after entry | 1 | **0** |
| distance from the bottom once settled | 0px | 0px |

D-032 was endemic on the phone viewport, where the cap is `86vw` and the row's
max-content is several times it.

### What it changed in the product, and what it did not

Every message rendered in two real chats at three widths, compared before and
after: **47 of 392 changed, and every one of them was a bubble whose reserved
spacer was wrapping.** 345 are identical to the pixel.

- 1440×900 — 1 of 64 in chat 0 (82.3px → 71.5px), 0 of 100 in chat 1
- 1024×900 — 0 of 64, 0 of 100
- 390×900 — 46 of 64 (82.3px → 81.5px, one 105px → 104.3px)

`output/d032/d032-before.png` and `d032-after.png` are the same message: a blank
third line with the time hanging off it, against the time on its own compact
row, 10.8px shorter.

**The design was not touched.** `getMaxContentWidth` still measures the
shrink-to-fit row, so an own message's timestamp still takes its own row exactly
as it does today — the thing that was to be reported rather than changed. A
ceiling can only refuse a placement that was already going to overflow; it can
never make the meta fit where it did not before.

### Section 11, measured rather than argued

| | before | after |
|---|---|---|
| entry, no unread: distance from the bottom | 0px | 0px |
| prepend: anchor row displacement, worst frame | −80.5px | −80.5px |
| prepend: anchor row displacement once settled | −80.5px | −80.5px |
| fast upward scrolling: `scrollTop` range | 0…5871 | 0…5871 |
| fast upward scrolling: downward jumps over 200px | 2 | 2 |

Identical. The −80.5px prepend step is D-042's loading band and is unchanged by
this work. `tests/e2e/chat-entry-scroll.spec.ts` (3), `message-meta-placement.spec.ts`
(4) and `tests/unit/message-history-anchoring.test.mjs` all pass.

### Tests, and the mutations that prove them

`tests/unit/css-length.test.mts` and `tests/e2e/message-meta-first-paint.spec.ts`.
The e2e calibrates its own text against the running layout — the width that
triggers D-032 is a window about `time + 8px` wide at the very end of a line, and
where it sits depends on the viewport and on the font the machine has — and it
pins the font by refusing Google Fonts, for the reason in D-043.

Eight mutations, each verified as applied by grepping the pattern off disk
before running anything. All eight fail the suite:

| mutation | caught by |
|---|---|
| the cap clamp removed | the spacer wraps onto a blank line |
| the reset runs on mount again | a bubble painted at 36.8px becomes 54.8px 28ms later |
| ancestors only from React refs | the same |
| the cap keeps the bubble's padding and border | the crafted messages stop rendering at all — the two placements start arguing for each other and the bubble flips on every frame until React gives up |
| percentages resolve to zero instead of refusing | the unit suite |
| `min()` behaves as `max()` | the unit suite |
| an unresolved unit is taken as pixels | the unit suite |
| a partly parsed value is accepted | the unit suite |

### Left alone deliberately

`getMaxContentWidth` reads `--kub-action-lane` through `parsePixelValue`, which
refuses anything not ending in `px`. The custom property computes to `6.5rem`,
so **the lane has always been 0 there** and 104px is never subtracted. It is not
fixed here because subtracting it turns every single-line *received* message
anchored: the 32px avatar lane in the row is the only reason their time is
inline today, and 104px erases it. That is the same design decision, reached
from the other side.

## D-043 — the first load re-flows every message when Inter arrives

Found 2026-09-05 while building the regression test for D-032, and not fixed.

`artifacts/kub/index.html:34` loads Inter from Google Fonts with `display=swap`.
A cold page therefore paints in the fallback face and re-flows when the real one
lands, and every text metric changes with it. Measured on the DEV preview
fixture: a timestamp 23.7px wide became 28.6px, a last line 426.9px became 534px,
and the bubbles re-measured and changed height 55ms later — well after first
paint.

This is not D-032 or D-041, and no measurement taken before the font exists could
have predicted it: the metrics genuinely change. It is recorded because it is the
remaining source of late height changes in a chat, and because it makes a
frame-by-frame test of message geometry unreliable unless the face is pinned —
`tests/e2e/message-meta-first-paint.spec.ts` blocks the font for exactly that
reason and says so.

The directions are self-hosting the face with `font-display: optional`, or
measuring nothing until `document.fonts.ready`. Both are decisions about the
product's first paint, not motion fixes.

# Audit sweep, 2026-09-05 — the surfaces rebuilt on 3–4 September

Queue item 18, half A. Four surfaces changed in two days and none had been
swept: the profile card became a floating, draggable window with a media
sub-view and counted rows; the settings modal became one scrolling column of
44px rows with no tabs; the roles panel gained a ranked, coloured hierarchy; and
message bubbles were made to paint at their final height.

**Rig.** `scripts/interface-audit.mjs` against production `https://app.letscube.ru`,
signed in as the QA owner. Production was confirmed to be running the current
revision before anything was measured: `origin/main` is `321342f`, and the
deployed bundle contains that commit's own new selector,
`closest('[data-message-bubble="true"]')`, which nothing before it used.

**Matrix.** 7 surfaces x 5 viewports (`3840x2160`, `1920x1080`, `1440x900`,
`390x844`, `412x915`) x 2 themes = **70 cells**. 67 measured, 3 unreachable.
535 raw findings collapse to **36 distinct (surface, kind, selector) groups**,
which is the number worth reading: a defect in a message row is reported once
per message.

| surface | how it is reached |
| --- | --- |
| `messenger` | `/` |
| `chat` | first chat in the list |
| `profile-card` | chat, then `chat-header-info-button` |
| `profile-media` | as above, then the first counted media row |
| `settings` | Меню, then Настройки |
| `settings-expanded` | as above, with Оформление, Звук and Обновления opened |
| `admin-roles` | `/admin/roles` |

**Cells not reached: 3 of 70**, all `profile-media` — `1920x1080 dark`,
`412x915 dark`, `412x915 light`. The QA account holds exactly one shared-media
item across its three chats, and in those three runs the counted row had not
appeared before the 20s wait ran out. That is the fixture, not the surface: the
same surface measured cleanly in the other seven cells. Nothing here is reported
as a pass on the strength of a cell that was never measured.

**Every surface in this sweep needs a signed-in session** — `messenger`, `chat`,
`profile-card`, `profile-media`, `settings`, `settings-expanded` and
`admin-roles` are all behind authentication, and there is no unauthenticated
route to any of them. The two native shells are out of scope here; this is the
browser matrix only.

**The chat's late-height contract holds.** A `ResizeObserver` installed before
the app boots recorded the first painted height of every message row and every
later change to it: **750 row-observations across ten chat cells, 0 rows changed
height after their first painted frame.** D-032 and D-041 are closed and stay
closed at all five widths in both themes.

## D-044 `[x]` a message's monogram is white on every colour the palette has

**Severity:** high. Every message from a sender with no picture, in every chat,
at every viewport, in both themes.

**Surface:** `artifacts/kub/src/components/ui/ChatAvatar.tsx:329-338`
(`MessageActorAvatar`). Compare `:167` (`ChatAvatar`) and `:273` (`UserAvatar`).

**Reproduction:** sign in, open a chat with someone who has no avatar picture,
look at the circle beside their messages. `chat` / `profile-media`, any viewport.

**Defect:** the fallback hard-codes `font-medium text-white` at `:332` and then
sets `style={{ background: getAvatarColor(actorId) }}` at `:335`. The two
sibling components paint the same monogram with
`color: avatarInkFor(bgColor)` — `artifacts/kub/src/lib/avatarInk.ts:13-24`,
which measures the background and returns whichever of `#FFFFFF` and `#0B1220`
scores better. `MessageActorAvatar` never calls it.

**Measured in the product**, 1440x900 dark and 390x844 light, the same person on
the same screen:

| where | component | ink | background | ratio |
| --- | --- | --- | --- | --- |
| chat list, 48px | `ChatAvatar` | `#0B1220` | `#FFEAA7` | **15.67:1** |
| chat header, 32px | `UserAvatar` | `#0B1220` | `#FFEAA7` | **15.67:1** |
| message row, 32px, x8 | `MessageActorAvatar` | `#FFFFFF` | `#4ECDC4` | **1.93:1** |

The reading is identical in both themes, because both colours are inline literals
and neither is a theme token.

**All ten palette entries fail**, not the unlucky ones. `getAvatarColor` at
`:16-25` offers ten colours; white text scores 1.19:1 to 2.78:1 on them, and
`avatarInkFor` would score 6.75:1 to 15.67:1:

| colour | white | what `avatarInkFor` would pick |
| --- | --- | --- |
| `#FF6B6B` | 2.78:1 | `#0B1220`, 6.75:1 |
| `#4ECDC4` | 1.93:1 | `#0B1220`, 9.68:1 |
| `#45B7D1` | 2.35:1 | `#0B1220`, 7.98:1 |
| `#96CEB4` | 1.78:1 | `#0B1220`, 10.51:1 |
| `#FFEAA7` | 1.19:1 | `#0B1220`, 15.67:1 |
| `#DDA0DD` | 2.07:1 | `#0B1220`, 9.05:1 |
| `#98D8C8` | 1.62:1 | `#0B1220`, 11.58:1 |
| `#F7DC6F` | 1.36:1 | `#0B1220`, 13.75:1 |
| `#BB8FCE` | 2.65:1 | `#0B1220`, 7.07:1 |
| `#85C1E9` | 1.94:1 | `#0B1220`, 9.63:1 |

**Consequence:** the monogram is how a reader tells who wrote a message when
there is no picture, and it is the one place in the product where it is
illegible. 56 instances across the 7 measured `profile-media` cells; the count is
one per avatar-less incoming message on screen.

## D-045 `[x]` a history prepend fades in a hundred bubbles at once

**Severity:** medium. Every load of older history, in every chat with more than
one page of it.

**Surface:** `artifacts/kub/src/lib/messageEntrance.ts:78-101`
(`advanceMessageEntrance`), read by
`artifacts/kub/src/components/chat/MessageList.tsx:177-185` and applied at
`artifacts/kub/src/components/chat/MessageBubble.tsx:1370`
(`isEntering && "msg-appear"`).

**Reproduction:** open a chat with more than a page of history and scroll up
until older messages load. Measured at 1440x900 dark.

**Defect:** the module's own opening comment says why it exists — `msg-appear`
"was applied to every bubble unconditionally, so it played on every mount ...
Fifty bubbles fading and sliding at once is what «дёргано, без плавности» is
describing". The guard it added is `primed`, which suppresses the animation on
the **first** pass only. `advanceMessageEntrance` has no notion of *where* an id
appeared: after priming, every id not in `seen` is "entering", and a prepend adds
a hundred of them at the front.

**Measured**, one prepend, sampling every animation frame for 20s at 1440x900:

| | |
|---|---|
| rows before / after | 100 / 200 |
| rows carrying `.msg-appear` in one frame | **100** |
| of those, inside the viewport | **17** |
| lowest opacity sampled | **0** |
| frames with a faded row | 8, from t=1343ms to t=1468ms |

A wheel-driven run over three consecutive prepends reached the same peak of 100
and left 263 of 346 sampled frames with something animating.

**Consequence:** 17 bubbles on screen fade and slide simultaneously each time
older history arrives — the behaviour the entrance rule was written to remove,
in the one case it does not cover. `prefers-reduced-motion: reduce` still removes
the movement (`index.css:534-537`), so this is a defect for everyone else.

**Not the same as D-042**, which is the 42px loading band displacing the reader.
That entry is about the band; this one is about the rows.

## D-046 `[x]` the entrance class, and its compositing hint, are never taken off

**Severity:** low.

**Surface:** `artifacts/kub/src/index.css:527-531`, applied from
`artifacts/kub/src/components/chat/MessageBubble.tsx:1370`.

**Defect:** the rule carries `will-change: opacity, transform` under a comment
that reads "the hint is dropped the moment the animation ends so an idle chat is
not holding a layer per bubble". Nothing drops it. There is no `animationend`
listener and no `onAnimationEnd` anywhere in `MessageBubble.tsx` or
`MessageList.tsx`; the class comes off only when some later render recomputes
`enteringKeys`, and a chat that nothing else touches never has one.

**Measured**, same run as D-045, 1440x900: 18.5 seconds after the animation
finished, `document.querySelectorAll('.msg-appear').length` was **100**, and the
first of them still reported `will-change: opacity, transform`.

**Consequence:** up to one retained compositing layer per row of the last
prepend. No visible defect was observed and none is claimed. What is recorded is
that a comment in the stylesheet describes a mechanism the code does not have,
which is how the next person reading it will be misled.

## D-047 — the 44px touch rule is opt-in, and neither rebuilt surface opted in

**Severity:** medium. All four coarse-pointer cells (`390x844` and `412x915`,
both themes).

**Surface:** the rule is `artifacts/kub/src/index.css:803-855`. It reaches
`.kub-button`, `.kub-icon-action`, `.kub-field`, `.kub-switch`, `select` and
checkbox/radio inputs — and nothing else. Every control below is plain Tailwind
sizing carrying none of those classes.

**Reproduction:** open each surface at 390x844 with touch emulation and measure
the control's box.

| control | measured | file |
| --- | --- | --- |
| per-message actions, phone-only | **20x20** | `MessageBubble.tsx:1113-1122` (`h-5 w-5 sm:hidden`) |
| reaction chip | 37x22 | `MessageBubble.tsx`, reaction row |
| profile card «Закрыть» / «Назад» / «Редактировать» | 36x36 | `ChatInfoPanel.tsx:1097`, `:1106`, `:1119`, `:1129` |
| profile card action rows, incl. the counted media rows | 357x36 | `ChatInfoPanel.tsx:1058-1064` (`py-2`) |
| settings «Закрыть» | 28x28 | `KubModal.tsx:118-121` (`p-1.5`) |
| settings «Сменить фото» | 28x28 | `SettingsModal.tsx:455-471` |
| settings Имя / Никнейм / О себе | 232x36 | `SettingsModal.tsx:660` (`h-9`) |
| settings theme radios x3 | 36x32 | `SettingsModal.tsx:354` (`h-8 w-9`) |
| audio processing modes x3 | 288x36 | `AudioSettingsSection.tsx:654` (`min-h-9`) |
| «Сбросить настройки звука» | 162x**16** | `AudioSettingsSection.tsx:560` |
| chat «Назад» | 36x36 | `ChatHeader.tsx` (`p-2`) |

The settings **rows** are correct: `ROW_GRID` and `FIELD_ROW_GRID` both carry
`min-h-11`, and every row measured 44px or more (44, 44, 55, 60). The defect is
the controls sitting inside them, which the row's height does not give them.

**The worst of these is the 20x20 one.** Below the `sm` breakpoint it is the only
visible affordance for a message's actions, and it appears once per message —
298 instances across the four coarse `chat` cells, 75 per screen. A long press on
the bubble opens the same menu (`MessageBubble.tsx:935`, `:1375`), so it is not
the only route; it is a visible control at under a fifth of the required area.

**This is D-015's mechanism, not its scale.** Fix batch 4 raised the hit area for
a finger and deliberately left the pointer scale alone, and the register recorded
that as closed. It is closed for everything that carries the classes. Two
surfaces rebuilt three days later carry none of them, so the rule reaches nothing
on either. Whether the answer is more classes or a wider selector is a decision,
not a patch.

## D-048 `[x]` the required marker misses 4.5:1 in both themes

**Severity:** low. All ten `settings` cells and all ten `settings-expanded` cells.

**Surface:** `artifacts/kub/src/components/sidebar/SettingsModal.tsx:643` —
`{required && <span className="text-[color:var(--kub-danger)]"> *</span>}`.

**Measured:** `#ef4444` on `#0b213a` (dark `--kub-surface-2`) is **4.32:1**; the
light pair is **4.30:1**. 14px at normal weight needs 4.5:1. Reproduced
identically in all twenty cells and verified once by hand against the harness.

**Consequence:** the only mark that says «Имя» is required is the hardest thing
in the row to see. Small, but a WCAG 1.4.3 failure on a production form field
that costs one token to move.

## D-049 — the online colour is tuned for a dot and used as text

**Severity:** low. Light theme only; 3 cells (`3840x2160`, `1920x1080`,
`1440x900` light).

**Surface:** `artifacts/kub/src/components/chat/ChatHeader.tsx:243-244`, which
paints the subtitle `text-[color:var(--kub-online)]` when the other person is
online. The token is `artifacts/kub/src/index.css:339`.

**Measured:** «в сети» at 12px in `#3C8B3C` on the white header measures
**4.24:1**, under the 4.5:1 normal text needs. The dark theme's `#4DCD5E` on its
own surface passes and was not reported in any cell.

**Why it happened is written above the token itself:** "Darkened along the same
hue: at `#4FAE4E` the status dot measured 2.80:1 on white and 2.62:1 on the page,
under the 3:1 a non-text indicator needs." It was solved for the **dot**, which
needs 3:1, and the same value is then used for 12px **text**, which needs 4.5:1.
`#3C8B3C` clears the first bar by a margin and misses the second by 0.26.

## D-050 `[x]` opening the profile card on a phone re-lays the conversation at 24px

**Severity:** low — nothing visibly wrong, and the anchor is restored exactly.
Recorded for the work it does and the hazard it leaves.

**Surface:** `artifacts/kub/src/lib/profileWindow.ts:50-52` (`DOCKED_CLASS`) with
`artifacts/kub/src/lib/floatingWindow.ts:31` (`DOCK_BREAKPOINT = 640`).

**Reproduction:** at 390x844, open a chat, press the header, close the card.

**Defect:** below 640px the card docks as `w-full` **beside** the conversation in
the same flex row rather than replacing it. The chat is not unmounted: it is
compressed and pushed off the left edge.

**Measured** at 390x844, 75 rows:

| | before | card open | after closing |
|---|---|---|---|
| scroller width | 390 | **24** | 390 |
| `scrollHeight` | 6586 | **114731** | 6586 |
| `scrollTop` | 5868 | 114013 | 5868 |
| witness row top | 79 | — | **79** |

Individual rows are laid out at up to 2337px tall while the card is open, and
every one of the 75 is measured twice more on the way back.

**The section 11 contract is not violated**: scroll drift 0px, witness drift 0px,
height drift 0px. What is recorded is that the meta-placement machinery closed by
D-032 and D-041 — which decides a bubble's height from its measured available
width — is re-run at 24px and again at 390px on every open, and that the card
covers the conversation completely at that width anyway, so nothing is gained by
keeping it laid out.

## Measured, and not a defect

Four things this sweep was specifically asked to look at were measured and are
correct. They are recorded so the next pass does not spend the time again, and so
that nobody "fixes" them by eye.

**The counted media rows do not truncate.** Measured with the row's own computed
font (`14px Inter`) against its own available width. The floating card at
1440x900 gives the label **273px**; the docked card at 390x844 gives **284px**.
The widest label the product can build is `12345+ голосовых сообщений` at
**207.9px** — `voice` has the longest plural forms and the count is bounded by
nothing narrower. `619 голосовых сообщений` measures **181.5px** and
`1543 голосовых сообщений` **190.1px**. Nothing gets close to the edge, and the
observed row reported `scrollWidth - clientWidth = 0`. The harness could not have
answered this: the label carries `truncate`, and the clipping check skips
`text-overflow: ellipsis` as deliberate, so this had to be measured directly.

**The settings rows hold a long value without clipping it.** At 390x844,
«Push-уведомления» / «Заблокировано в настройках браузера» wraps onto a second
line — which is what `SettingsRow`'s `flex-wrap` is for — and the row grows from
44px to 55px. Every row at every width reported `scrollWidth - clientWidth = 0`
on its value. At 1440x900 the value stays on the label's line, 384px to the right
of it, beside the control it describes.

**No role colour lands on an unreadable text pairing, because no role colour is
ever text.** `roleSwatchColour` reaches exactly two places, both `aria-hidden`
dots: `RolesPermissionsTab.tsx:677-683` (12x12, bordered) and `:1065-1070` (6x6,
inside a `KubBadge`). The label beside it is `--kub-text` and `--kub-muted` in
every case. The 13 production roles use 6 distinct colours; measured against the
panel surface in dark theme they run **5.55:1 to 10.77:1**, and the three roles
with no colour get a neutral 35% muted mix. The panel reported **0 findings in
all 10 of its cells**, and its reorder buttons measure 44x44 on a coarse pointer
because they carry `kub-icon-action` — which is D-047's rule working where it was
applied.

**Message rows no longer change height after their first painted frame.** 750
row-observations, 10 cells, 0 changes. See the sweep header.

## Three harness corrections, and one thing it still cannot see

None of these are product defects; all three would have put invented findings in
this register, which is the failure mode the harness exists to avoid.

**1. A parked sub-view was reported as clipped content, in all ten profile-card
cells.** The card keeps its media gallery mounted beside the root view at
`opacity: 0`, `pointer-events: none` and `inert`, translated 12% to the right
(`index.css:762-785`). `opacity` is not inherited, so a child of that layer
reported `opacity: 1`, and the clipping check counted its text as "content a
person needs" being cut off by 45px. `isHiddenByAncestor` now walks the ancestors
for `display: none`, `visibility: hidden`, zero opacity and `inert`, and the
clipping check skips anything it hides. **10 findings removed, every one false.**

**2. Every screenshot was of the harness's scroll position, not the surface's.**
The evidence image was taken *after* `checkFocusVisibility` presses Tab forty
times, and each stop scrolls its control into view — so the settings dialog's
evidence showed it opened three rows down, with nothing on the image to say the
harness had put it there. The screenshot is now taken before the keyboard walk.

**3. Eighty-one controls nobody can see were reported at 390px.** With the
profile card docked (D-050), the conversation behind it is still laid out — at
24px, with its rows at negative x — and the harness measured all of it.
`isOccluded` now uses the browser's own hit test at an element's centre, and
treats an element whose box lies entirely past the left or right viewport edge as
gone: the document does not scroll sideways, so nothing brings it back.
Vertically off-screen is deliberately still measured — a person scrolls to it,
and the privacy page's 22 undersized entries were found below the fold.
`profile-card 390x844 dark` went from **87 findings to 6**, and the six are the
card's own.

**What it still cannot see:** two of the chat's controls straddle x=0 with a few
pixels inside the viewport and survive both tests, so `profile-card` at the two
coarse viewports still reports the reaction chip and one message-actions button
from the conversation behind the card. Both are listed under D-047 anyway, where
they belong to `chat`; they are not evidence about the card.

## D-051 `[x]` The sidebar's whole realtime path was dead, poisoned by one table

Found 2026-09-05 while building the two-device sync harness, and fixed.

**Severity:** high. Every account, every device, every chat that is not the one
currently open.

**Surface:** `artifacts/kub/src/hooks/useChats.ts:278-287` (before the fix) —
one channel, `chats:user:{userId}`, carrying four `postgres_changes` bindings:
`messages` INSERT, `messages` UPDATE, `chats` UPDATE, `chats` DELETE.

**Defect:** `public.chats` is not in the `supabase_realtime` publication, and a
channel that asks for an unpublished table silently stops delivering *every*
binding it carries — including the ones whose tables are published. Nothing in
the client says so: the channel reports `SUBSCRIBED`, reaches state `joined`, and
is assigned a server-side id for all four bindings.

**Reproduction.** One account signed in with no chat selected; a peer sends one
message. Instrumented on the live server:

| | before | after |
| --- | --- | --- |
| `kub:chats-refresh` events in 16s | 0 | 1, at ~0.9s |
| `unread_count` in the store | 0 for the full 16s | 1 within 1s |
| sidebar preview | a message from a previous session | the new message |
| `mark_chat_delivered` fired | no | yes |

**Isolation.** Built by construction against production, on the application's own
realtime client, all four subscribed successfully:

| channel | bindings | delivered |
| --- | --- | --- |
| one binding | `messages` INSERT | yes |
| three bindings | `messages` INSERT + UPDATE + DELETE | yes |
| four bindings | `messages` ×3 + `chat_members` INSERT | yes |
| two bindings | `messages` INSERT + `chats` UPDATE | **no** |
| two bindings | `chats` UPDATE + `messages` INSERT | **no** |
| two bindings | `messages` INSERT + `chats` DELETE | **no** |
| four bindings | the application's exact set | **no** |

So it is not the number of bindings and not their order: it is the presence of
one binding on a table the publication does not carry. Confirmed against
`pg_publication_tables`, which lists `messages`, `chat_members` and `profiles`
but not `chats`.

**Consequence:** the unread badge never appeared and the last-message preview
never moved for any chat that was not open. Clearing an unread count worked
(`chat-members:user:{id}` is single-table and healthy), so the badge could go
down but never up.

This was never a two-device defect — one device was hit exactly as hard. It only
*surfaced* under two devices because a single one hides it: you leave the tab and
come back, `refreshAfterBackground` fires on focus, and the sidebar catches up
before you notice anything was stale. Someone who stays on the app the whole time
sees no badge at all, on one device or five. Driving two focused devices of one
account simply removed the tab-switch that had been papering over it.

**Fixed** 2026-09-05, `artifacts/kub/src/lib/realtimeTableChannels.ts`: one
channel per table, so a binding can only ever take down bindings on its own
table. The rule is deliberately "group by table" rather than "isolate the tables
that are not published" — an allowlist of published tables would duplicate a fact
that lives in the database and would fail dangerously the day a table is dropped
from the publication.

The `chats` bindings are kept, on their own channel, rather than deleted: they
are inert today but correct, and they cost nothing where they cannot contaminate
anything. Live chat rename and delete therefore remain non-live. Making them work
needs `public.chats` added to the `supabase_realtime` publication, which is a
production DDL change and belongs to its own reviewed migration under the rules
in CLAUDE.md §10 — it was **not** done here.

Covered by `tests/unit/realtime-table-channels.test.mts` and
`tests/e2e/multi-device-sync.spec.ts`.

**Three more channels carry the same fault and were not fixed**, being outside a
chat-sync task. Each mixes a binding on an unpublished table with bindings that
would otherwise work, so all of them are inert:

- `artifacts/kub/src/components/chat/ChatInfoPanel.tsx:440` — `chat-info:{id}`,
  poisoned by `chats`; the info panel's member list and invites do not live-update.
- `artifacts/kub/src/hooks/useAdminDashboard.ts:136` — `admin-dashboard-v2`,
  poisoned by `chats` and `audit_logs`.
- `artifacts/kub/src/hooks/useDynamicRoles.ts:151` — `roles:*`, poisoned by
  `permissions`.

Separately, `artifacts/kub/src/components/sidebar/PhoneSection.tsx:64` subscribes
only to `profile_contacts`, which is also unpublished; it has nothing to poison
but never fires either.

Note that mixing tables is not wrong in itself —
`task-routing:{id}:locations` carries `locations` and `location_members` and
works, because both are published. What is wrong is mixing a published table with
an unpublished one, which is indistinguishable from working until you measure it.

## D-052 `[x]` A peer who is online reads as "был(а) N минут назад"

Found 2026-09-05 while measuring D-051, and fixed.

**Severity:** high. Any two people looking at a conversation without sending
anything.

**Surface:** `artifacts/kub/src/hooks/useMessages.ts:756-767` (before the fix) —
the `profiles:chat:{chatId}` handler spent each realtime `profiles` row on
`message.sender` and dropped the rest. The chat header and the sidebar read
presence from `chat.other_user` (`ChatHeader.tsx:167`, `ChatListItem.tsx:84`),
which nothing refreshed.

**Defect:** `fetchChats` is what puts a fresh `online_at` into the chat list, and
it runs on tab focus, reconnect, `pageshow` and message traffic. None of those
happen while two people are simply reading a conversation, so the peer's presence
value froze at whatever the last fetch returned and aged past the 90-second
`USER_ONLINE_THRESHOLD_MS`.

**Measured**, one account signed in and heartbeating correctly the whole time —
five `PATCH /profiles` writes, exactly 60s apart, all 204:

| elapsed | peer's view of `online_at` | staleness | label |
| --- | --- | --- | --- |
| 20s | fresh at start | 22s | в сети |
| 60s | unchanged | 62s | в сети |
| 100s | unchanged | 104s | **был(а) 1 мин назад** |
| 200s | unchanged | 204s | **был(а) 3 мин назад** |

After the fix, same 200-second window: staleness peaks at 43-50s, bounded by the
60s heartbeat, and the label stays `в сети` throughout. A second device changes
nothing either way — two devices do not fight over `online_at`, they both simply
write it, and the database value was fresh in every one of these runs.

This is the other half of `17a4b3d`, which fixed `sameChatList` so a refetch
carrying only fresh presence is no longer discarded. A comparison can only help a
refetch that happens; here none did.

**Fixed** 2026-09-05, `artifacts/kub/src/lib/chatProfilePatch.ts`. The row was
already arriving — `profiles:chat:{chatId}` subscribes to every `profiles`
UPDATE and receives each peer's heartbeat — so this adds no subscription, no
polling and no request volume. Covered by
`tests/unit/chat-profile-patch.test.mts` and
`tests/e2e/multi-device-sync.spec.ts`.

**Not fixed:** presence still only refreshes while some chat is open, because
that is where the subscription lives. A sidebar left open with no chat selected
still ages out. And the margin is thin by design — a 60s heartbeat against a 90s
threshold — so a single missed beat still shows someone as away. Worth revisiting
together; neither is a two-device problem.

## D-044 to D-050 revisited, five closed and two left standing

Re-measured and fixed 2026-09-05, on `31a0568`, in both themes at 1440x900 and
390x844. D-053 below was raised in the same pass and is older than any of them.

All seven were re-measured on the current tree before anything was changed,
because the material stage landed text variants of three colours in between and
one of the seven could have closed itself. One had. The measurements below are
the product's pixels in both themes: the fictional capture fixture at
`/__qa/public-preview` where the surface is reachable without signing in, and
the signed-in application where it is not. Every contrast number is photographed
— the glyphs are made transparent with an injected `!important` rule keyed off
an attribute, the element's own box is screenshotted, and the PNG is decoded —
so blur, alpha and ambient are all inside it.

| finding | still alive on 2026-09-05 | before | after |
| --- | --- | --- | --- |
| D-044 | yes | white on `#45B7D1`, **2.35:1** | `#0B1220`, **7.98:1** |
| D-045 | yes | 91 rows carrying `.msg-appear` in one frame, 11 on screen, lowest opacity **0** | **0** in every frame of a prepend |
| D-046 | yes | 91 nodes still classed, `will-change: opacity, transform`, 6s after | **0** nodes |
| D-047 | yes | profile card 4/4 controls under 44px, settings 24/48 | **0/4** and **0/48** |
| D-048 | **no — closed itself** | — | `#FF6B6B` **5.31:1**, `#C11B1B` **6.09:1** |
| D-049 | yes, light theme only | `#3C8B3C` on the photographed header, **4.08:1** | needs a token; see below |
| D-050 | yes | scroller 390 → **24** → 390, `scrollHeight` 6,586 → **114,731** | 390 → **390** → 390, `scrollHeight` unchanged |

### D-044 `[x]` — the monogram takes the ink the palette was chosen for

`MessageActorAvatar` now calls `avatarInkFor(bgColor)`, like the two components
beside it. Measured on the same person in the same conversation, both themes:
`#FFFFFF` on `#45B7D1` was **2.35:1**, and `#0B1220` on it is **7.98:1**. The
palette's worst case moves from 1.19:1 to 6.75:1.

**How it survived a test written for exactly this.**
`tests/unit/avatar-monogram-contrast.test.mts` did scan for hardcoded white ink,
and it was green the whole time: it matched the class string
`rounded-full flex items-center justify-center font-medium`, and the third
component wrote the same classes in a different order —
`flex items-center justify-center rounded-full font-medium text-white`. A
class-order-sensitive anchor is a test of one component pretending to be a test
of a rule. The scan is now anchored on the palette call itself, counts the call
sites, and requires the same number of `avatarInkFor` sites, so a fourth
monogram cannot be added without being covered.

### D-045 `[x]` — a prepend is history, not an arrival

`advanceMessageEntrance` gained a notion of *where* an id turned up. The anchor
is the last id that was already on screen: anything after it arrived at the end
of the conversation, which is the only arrival a reader watches happen;
anything before it is history that has just been fetched, or a gap a jump has
filled in.

Measured on one prepend at 1440x900 in both themes, sampling every animation
frame for 9 seconds:

| | before | after |
| --- | --- | --- |
| rows | 100 → 200 | 100 → 200 |
| peak `.msg-appear` in one frame | **91** | **0** |
| of those inside the viewport | **11** | **0** |
| lowest opacity sampled | **0** | **1** |
| frames with a faded row | 1 of 541 sampled | 0 of 550 |

**A second defect fell out of the same reading, and it was worse.** The entrance
state is a `useRef` inside `MessageList`, and `MessageList` is not remounted
between conversations — there is no `key`, only a `layoutKey` prop. So `seen`
carried over: every message of the chat you opened *second* was an id that had
never been seen, and the whole history animated. `primed` could not catch this,
because it only knows whether *a* first pass has happened, not whether this is
the first pass of this conversation. The state now carries a `scope`, the list
passes the open chat's id, and a scope change re-primes. The idempotency cache
is keyed on the scope too: two conversations can render the same ids — a
forwarded message, a fixture, a chat cleared and refilled — and answering the
second from the first's cache would carry its entering set across with it.

One exception is deliberate: a chat that held no messages at all animates its
first one, because there was nothing for it to be different from.

### D-046 `[x]` — the hint is dropped where the stylesheet said it was

`MessageBubble` listens for `animationend`, checks the animation is `msg-appear`
and that it is its own rather than a child's, and sets a flag that takes the
class off. The flag only ever goes from false to true for the life of the mount,
which is also strictly better than what was there: a later render can no longer
put the class back and replay the fade on a bubble that had already settled.

Measured six seconds after the last animation ended, both themes: **91 nodes
carrying `.msg-appear` and `will-change: opacity, transform` before, 0 after.**

Under `prefers-reduced-motion: reduce` the rule sets `animation: none`, so no
`animationend` fires and the class stays — but that branch also sets
`will-change: auto`, so nothing is retained and there is nothing to drop.

### D-047 — closed on both rebuilt surfaces, open inside a message bubble

The rule is opt-in and lives in `index.css`; the answer is therefore more
classes, not a wider selector, and the classes are the ones that already exist.
`kub-icon-action` for an icon-only control, `kub-button` for a row or a text
button, `kub-field` for a box whose whole area is the target.

Measured at 390x844 with a coarse pointer, both themes:

| surface | before | after |
| --- | --- | --- |
| profile card | 4 of 4 controls under 44px | **0 of 4** |
| settings, all disclosures open | 24 of 48 | **0 of 48** |

The settings count excludes two kinds that the rule already answers as written
and that are reported separately rather than as misses: the hidden file input
behind «Сменить фото», which is not a target, and the four tick boxes, which the
rule gives a 24px box inside a 44px label. Everything else was opted in:
the card's title-bar controls and its action rows, every dialog's close button,
the avatar's camera badge, the three theme radios, the name/nickname/bio fields,
the three audio processing modes, the audio reset, the two volume sliders, the
five icon-only help triggers — 13x13, the smallest control the product had — and
the chat's back control, which is the only way back to the list on a phone.

Two of them needed more than a class:

- The card's title bar was `grid-cols-[2.5rem_...]`. A 44px control simply
  overflows a 40px track, so the tracks now size to what they hold: 36px on a
  pointer, 44px on a finger, without a second copy of the breakpoint.
- The three audio modes were written `min-h-9`. `index.css` now lives in
  `@layer components` and Tailwind's utilities are a later layer, so a `min-h-*`
  utility **outranks** `.kub-button { min-height: 44px }` and the touch minimum
  never applies. Measured: `kub-button min-h-9` came out 36px tall on a coarse
  pointer, exactly as if the class were absent. `h-9` is safe — it sets
  `height`, and the used height is the larger of the two. This is rule 10 of the
  material notes pointing the other way now that the layer exists, and it is
  asserted rather than remembered:
  `tests/unit/touch-target-system.test.mjs` fails any class list that pairs a
  touch class with a smaller `min-h-*`.

**Two controls were deliberately not changed, and both are inside a message
bubble**: the per-message actions button (20x20) and the read-receipt chip
(39.7x16). D-015 already ruled out the pseudo-element overlay for this rule —
two adjacent controls would end up with overlapping hit areas and steal each
other's taps, and these two are adjacent, two pixels apart — so the only option
is the real box, and the real box moves the conversation. Measured on the
fixture at 390x844, raising the chip alone to 44x44:

| | before | with the chip at 44px |
| --- | --- | --- |
| mean row height | 74.8px | **98.8px** |
| every row grew by | — | **24px** |
| conversation height, 8 rows | 718px | **832px** (+16%) |

That is a change to the density of the product's main surface, which is a design
decision and not a defect patch, so it is left for the owner to take. The long
press on the bubble opens the same menu meanwhile.

**Three more near misses were measured and not fixed**, being outside this
entry's list: the composer's attach, emoji and voice buttons at 40x40, and the
chat header's title button at 278x40.5. Each is four pixels short and each would
be a one-class change; none is recorded as a defect yet, and polishing by eye is
what this stage is not for.

### D-048 `[x]` — closed by the text tokens, with no change here

The marker at `SettingsModal.tsx` already reads `--kub-danger-text`, which
landed with the material stage for exactly this reason. Re-measured in the
signed-in settings screen at 390x844, photographed:

| theme | ink | ground | ratio |
| --- | --- | --- | --- |
| dark | `#FF6B6B` | `rgb(16,41,69)` | **5.31:1** |
| light | `#C11B1B` | `rgb(254,255,255)` | **6.09:1** |

The clip's first pixel row is the settings row's own border at `rgb(49,71,94)`
and carries no glyph; the asterisk's ink is on the surface. Recorded because a
worst-pixel reading over the whole box reports 3.45:1 and would send the next
person after a defect that is a 1px line.

### D-049 — measured, and waiting on one token

Still alive, light theme only, exactly as recorded. Photographed on the chat
header's own subtitle, `#3C8B3C` measures **4.08:1** — slightly worse than the
4.24:1 the entry recorded against pure white, because the header composites to
`rgb(248,251,254)` rather than to white. The dark theme measures **7.62:1** on
the same surface and **6.27:1** against the limiting composite, so it passes and
needs nothing.

The remedy is the one D-048 and the two colours before it used: the dot keeps
`--kub-online`, which answers 3:1 and meets it, and the word gets a variant.
Measured across every ground the colour lands on — the photographed header, the
limiting composite of a panel over the field a blur cannot see past, all six
surface tokens, and the veil, which is denser than the surface under it and is
what caught both existing text tokens five thousandths short:

| candidate | photographed header | limit `rgb(240,240,240)` | veiled panel row | worst |
| --- | --- | --- | --- | --- |
| `#3C8B3C` (today) | 4.08 | 3.72 | 3.30 | **3.30** |
| `#367E36` | 4.82 | 4.39 | 3.89 | 3.89 |
| `#317431` | 5.50 | 5.02 | 4.44 | 4.44 |
| **`#2E6E2E`** | 5.97 | 5.44 | 4.82 | **4.82** |
| `#276027` | 7.25 | 6.61 | 5.85 | 5.85 |

`#2E6E2E` is the smallest step along the same hue that clears 4.5:1 on every
ground the existing text tokens are held to. `#276027` additionally clears the
harsher case of `kub-glass` — the header's own fill, not the stronger one — over
a solid black field, which is reachable when a black photograph scrolls under
the header: 4.69:1 against `#2E6E2E`'s 3.86:1 there.

`index.css` belongs to someone else this week, so nothing was changed. What it
needs is `--kub-online-text: #4DCD5E` in `.dark` — deliberately the same value,
as `--kub-pink-text` is in the light theme, so call sites can be uniform — and
`--kub-online-text: #2E6E2E` in `.light`. Then `ChatHeader.tsx:251` moves to it,
and so do the six other places that paint `--kub-online` as words rather than as
a shape: `RegisterForm.tsx:240` and `:277`, `ChatInfoPanel.tsx:1943`,
`StorageSection.tsx:307`, `KubFeedbackViewport.tsx:22`,
`TaskDetailModal.tsx:736`, and the two invite tones in
`notificationPresentation.ts`. `KubIcon`, `KubBadge`, the status dot and every
fill keep `--kub-online`.

### D-050 `[x]` — the sheet is laid over the conversation, not beside it

`DOCKED_CLASS` positions the card `absolute inset-0` inside the chat pane, which
is already `relative`, instead of making it a flex child of the row the
conversation is in. The comment above it always said "a sheet over the
conversation, not a column beside it"; now the layout says so too.

Measured at 390x844 with 75 rows, both themes:

| | before | after |
| --- | --- | --- |
| scroller width | 390 → **24** → 390 | 390 → **390** → 390 |
| `scrollHeight` | 6,586 → **114,731** → 6,586 | 6,586 → **6,586** → 6,586 |
| tallest row while open | **4,786px** | **236px** |
| `scrollTop` | 5,868 → 5,868 | 5,868 → 5,868 |
| witness row top | 79 → 79 | 79 → 79 |

The section 11 contract held before and holds now — the drift was zero in both
cases; what has gone is the work. The card also stops being able to compress the
conversation into something the audit harness has to be taught to ignore.

### D-053 `[x]` — the support window's own timestamp, at 4.44:1 and 4.30:1

Raised outside the seven on 2026-09-05, and older than all of them: it has been
there since the window was built.

**Severity:** low. Every message in the support window, both themes.

**Surface:** `artifacts/kub/src/components/support/SupportWindow.tsx`, the
`text-[10px]` line under each bubble.

**Measured**, photographed at 10px on the fill the product paints:

| theme | ground | `--kub-muted` |
| --- | --- | --- |
| dark | `rgb(29,63,100)` | **4.44:1** |
| light | `rgb(208,223,237)` | **4.30:1** |

**It is the ink that changed, and the reason is that the ground cannot be fixed.**
A chat bubble is opaque, so its meta line sits on a token value and the muted
grey is guaranteed there — 5.91:1 and 4.80:1 on `--kub-message-out`. The support
window's bubbles are a wash over a panel that floats above whatever the
messenger happens to be showing. Every fill that would have rescued the grey was
measured, one at a time and always in the same place, and each failed:

| fill | dark, photographed | light, photographed | dark, limit | light, limit |
| --- | --- | --- | --- | --- |
| `--kub-cyan` 22% (today) | 4.44 | 4.30 | 3.98 | 3.86 |
| `--kub-message-out` | 5.91 | 4.80 | 5.91 | 4.80 |
| `--kub-cyan` 22% over `--kub-message-out` | 4.35 | 3.66 | 4.35 | 3.66 |
| `--kub-cyan` 12% | 5.15 | 4.93 | 4.51 | **4.42** |
| the veil, as support's own bubble wears it | 4.93 | 5.10 | **4.31** | 4.54 |

`--kub-message-out` passes and is the only one that does, because it is a token
and cannot drift with what is behind the window — and it composites to within
**1.01** of the window itself in the dark theme, which is a bubble nobody can
see. Weakening the cyan far enough to pass the limit in both themes (about 8%)
puts the bubble at 1.20 against the window, which is the same defect wearing a
different number. And the veil — what the *incoming* bubble already uses, which
is why only the outgoing one was reported — is 4.31:1 on that same worst ground,
so the grey is not guaranteed anywhere in this window.

So the timestamp takes `--kub-text`: **10.06:1** and **13.94:1**, measured on
the same bubble. A quieter dedicated token would read better and is the token
owner's call; nothing here needs one.

### Where the evidence is

The probes are in the ignored `output/d044-d050/`: `probe-fixture.mjs` (the
capture fixture, no sign-in, invented data), `probe-auth.mjs`, `probe-online.mjs`
(D-049's candidate sweep), `probe-support-candidates.mjs`,
`probe-bubble-cost.mjs` (what raising the in-bubble controls would cost) and
`mutate.mjs`. Screenshots and the decoded backdrops are under
`output/d044-d050/shots/`. Nothing in any of them carries a real conversation:
the fixture surface is `tests/fixtures/public-home-demo.json`, and where the
signed-in application was needed the glyphs are transparent in every picture
that was kept.

`mutate.mjs` is the proof the contracts are load-bearing. It compares the file's
SHA-256 before and after each substitution — not the presence of an anchor,
which reports a false "applied" on an insertion — and refuses to judge when the
anchor is not unique. Nine mutations, all caught: the monogram back to white
ink; every new id counted as an arrival again; the entrance state unscoped from
the chat; nothing taking the entrance class off; the card's action rows and the
chat's back control losing their touch class; a mode button back to the utility
that outranks it; the docked card back in the conversation's row; and the
support timestamp back to the muted grey.

### One pre-existing failure found on the way, and not touched

`tests/e2e/unified-interface-chrome.spec.ts:122` fails on this branch with a
strict-mode violation: `getByRole("button", { name: "Чистый голос" })` matches
both the audio disclosure row, whose accessible name includes the mode it
summarises, and the mode button itself. Confirmed pre-existing by reverting
`AudioSettingsSection.tsx` to `HEAD` and re-running — it fails identically — and
the file was restored to the same SHA-256 afterwards. It is a locator that
needs narrowing, not a product defect, and it belongs to whoever owns that spec.

## The Windows shell, walked for the first time since the redesign

Found 2026-09-06. The interface stage was verified in a browser; the Tauri
WebView2 shell is the second of the three shells and had not been walked.
Everything below was measured inside the real shell — WebView2 Runtime
**152.0.4191.62**, the debug build of `letscube-windows-tauri 0.2.11`, driven
over the harness's own loopback CDP port — and not in a browser standing in for
it.

The startup window and the overlay that continues its scene on the production
page are two copies of one design with no build step between them, so the only
thing holding them together is a test. Four of these five findings are what that
test was not reading.

## D-054 `[x]` The scene drops two pixels at the handoff, and the headline shrinks with it

**Severity:** medium. Every cold start of the Windows client, every account.

**Reproduction:** `pnpm.cmd windows:tauri:qa`. The `baseline` scenario fails at
`tests/e2e/windows-tauri-shell.spec.ts:208` —
`expect(overlayGeometry.snapshot).toEqual(geometry.snapshot)`, the assertion that
the two halves of the scene are the same scene. It has been in the spec since
`85bec05`, long before the redesign, and the redesign broke it.

**Surface:** `windows-tauri/ui/startup-overlay.css:247` before the fix, against
`windows-tauri/ui/startup.css:509`.

**Defect:** `466c4b2` raised the startup window's status line — "the one place
the eye should land first" — from 14px to 19px and gave it weight 620. The
overlay's copy of that line stayed at 14px. The two rules are two hundred and
fifty lines apart in two files, and nothing compares them.

**Measured** at 1360x860, both sides photographed in the same window in one run:

| | startup window | overlay |
| --- | --- | --- |
| status `font-size` | **19px** | **14px** |
| status `font-weight` | **620** | **400** |
| status `line-height` | 24px | 18px |
| status `margin-bottom` | 12px | 14px |
| state row height | **132px** | **128px** |

Those four pixels are the whole mechanism. The scene is
`grid-template-rows: 44px minmax(0, 1fr) auto` in both files and the handshake is
centred in the `1fr` band, so a state row four pixels shorter hands the band four
more pixels and moves everything centred in it down by half of them:

| | startup window | overlay | drift |
| --- | --- | --- | --- |
| `computer.top` | 328.5 | 330.5 | **+2** |
| `server.top` | 328.5 | 330.5 | **+2** |
| `seal.top` | 381.5 | 383.5 | **+2** |
| `clientPort.top` | 384.5 | 386.5 | **+2** |
| `serverPort.top` | 384.5 | 386.5 | **+2** |

`left`, `width` and `height` are identical on all five, which is what says the
cause is the row underneath rather than the assembly itself.

At the 640px minimum height the `@media (max-height: 720px)` block already put
both margins at 12px, so there the delta is the line height alone — six pixels,
three of drift. Wrong in both cases, and one rule.

**Consequence:** the last thing the startup window shows and the first thing the
overlay shows are the same sentence at two different sizes and two different
weights, and the assembly above it steps down as the page changes.

**Fixed** by giving `.startup-overlay-status` the startup window's metrics,
letterspacing included. Re-measured in the same way afterwards: drift `0` on all
five boxes, state-row delta `0`, and both status lines `19px / 620 / 24px / 12px`.
Measured again at the 960x640 minimum, where the `max-height` block moves the
margins on both sides and so is a different sum: state row **122px** against
**122px**, drift `0` on all five, and nothing clipped on either side.

## D-055 `[x]` The pane the scene stands on does not exist on the other side

**Severity:** medium. Same reproduction and the same moment as D-054, and the
larger half of it to look at.

**Surface:** `windows-tauri/ui/startup.css:209`, `.handshake::before`. There was
no counterpart anywhere in `windows-tauri/ui/startup-overlay.css`.

**Defect:** the startup window draws the handshake on a glass pane, and its own
comment gives two reasons that are both load-bearing: the band between the title
bar and the divider is taller than the 277px the endpoint column needs, so
without a container the surplus reads as ninety pixels of nothing under the
labels; and a translucent surface with no edge is not a surface, it is a lighter
patch of background. The overlay drew the same scene on nothing at all.

**Measured**, the same element on both sides:

| | startup window | overlay, before | overlay, after |
| --- | --- | --- | --- |
| handshake box | 980 x **277** | 980 x **662** | 980 x **277** |
| handshake `top` | 234.5 | 44 | 234.5 |
| pane behind it | `--glass-fill`, 20px radius, lit edge, shadow | **none** | the same four values |

Look at `output/windows-shell-audit/shots/01-startup-pending.png` beside
`05-overlay.png`: a panel with a rounded lit edge in the first, and in the second
the same drawing floating on the page. `after-01` and `after-05` are the pair
after the fix.

The 662 is why the pseudo-element could not simply be added. The overlay's grid
item was stretching to the full band instead of standing at its content height,
so a pane at `inset: -34px -44px` around it would have covered the title bar and
the status line — which is exactly the mistake `startup.css` records beside its
own `align-self: center`. Those two lines had to be copied first, and the pane
after them.

## D-056 `[x]` Three copies of the material, three different answers

**Severity:** medium. Every surface of the Windows startup screen and of the
overlay, against the application they hand over to.

**Surface:** `artifacts/kub/src/index.css:404` (`.dark`),
`windows-tauri/ui/startup.css:75` and `windows-tauri/ui/startup-overlay.css:44`,
all before the fix.

**Defect:** `windows-tauri/ui` is served as-is with no build step, so it cannot
import the application's stylesheet and the tokens are copied by hand. Both files
say so at the top, and the overlay adds that its four values are "the same four
values as startup.css". Neither claim was true, and the application was a third
answer again.

**Measured** — read back from `getComputedStyle` in the running WebView2, not
only from the files:

| token | `index.css` `.dark` | `startup.css` | `startup-overlay.css` |
| --- | --- | --- | --- |
| `--glass-fill` | `rgba(17, 43, 71, 0.46)` | `rgba(11, 33, 58, .56)` | `rgba(17, 43, 71, .70)` |
| `--glass-fill-strong` | `rgba(17, 43, 71, 0.96)` | `rgba(8, 22, 41, .86)` | `rgba(17, 43, 71, .96)` |
| `--glass-line` | `rgba(255, 255, 255, 0.10)` | `rgba(255, 255, 255, .09)` | `rgba(255, 255, 255, .14)` |
| `--glass-blur` | `blur(20px) saturate(122%)` | `blur(18px) saturate(122%)` | `blur(18px) saturate(122%)` |

Three fills on two different base surfaces, a lit edge at three weights, and two
blur radii. `--glass-fill-strong` is the one the startup window had furthest
wrong: `--kub-surface` where the other two use `--kub-surface-3`, and in this
theme `--kub-surface` is the darker of the two, so a covering surface there read
as a recess in the panel it opened over. That is the failure the `@supports`
fallback note in `index.css` describes, arriving by a different road.

**Fixed** by copying the application's values verbatim into both files.
`--glass-shadow` came with them: it was spelled `rgb(0 0 0 / .9)` in the shell
and `rgba(0, 0, 0, 0.9)` in the application — one colour, two spellings — and a
copy checked by string comparison cannot afford either spelling to be a matter of
taste. Photographed afterwards at 1360x860: the startup window's pane is still
plainly a pane at the quieter fill, and the two scenes now show the same one.

## D-057 `[x]` The test that guards those copies never read the material

**Severity:** medium, and it is the reason D-056 could exist.

**Surface:** `tests/unit/tauri-shell.test.mjs:47`, the pattern inside
`collectTokens`:

```
/(--(?:kub|brand|app)-[a-z0-9-]+)\s*:\s*([^;]+);/g
```

**Defect:** the test is called "the startup scenes carry the application's
tokens" and it compares every token whose name it recognises. It recognised
`--kub-`, `--brand-` and `--app-`. The four values that decide what the surfaces
are made of are named `--glass-`, so the palette was guarded and the material was
not.

**Proved by mutation**, comparing the file's SHA-256 before and after each
substitution as rule 9 requires — `output/windows-shell-audit/mutate.mjs`, which
refuses to judge when the anchor is not unique and restores the file afterwards:

| mutation | sha before → after | suite, before | suite, after |
| --- | --- | --- | --- |
| `--kub-surface-2` in `startup.css`, one digit | `22b754baa583` → `05107a2eba3a` | **fail** | fail |
| `--glass-fill` in `startup.css` → opaque red | `22b754baa583` → `24b656f6a129` | **pass** | fail |
| `--glass-line` in `startup-overlay.css` → opaque green | `fd09076f7dd4` → `ae547025cbc2` | **pass** | fail |
| `--glass-blur` in `startup-overlay.css` → `blur(0px)` | `fd09076f7dd4` → `3cd09def6f80` | **pass** | fail |

Three of those four are changes a person would see from across the room, and the
suite reported success on all three.

**Fixed** by adding `glass` to the prefix alternation. One thing had to move with
it: `--glass-shadow` is three shadows on three lines, so the captured value now
has its whitespace collapsed before comparison — newlines and the indentation
after them are not part of a value, and without that the test would fail on
formatting instead of on drift.

## Measured in the Windows shell, and not a defect

Recorded because an absence of findings is only worth something if it says what
was actually looked at.

- **`backdrop-filter` is supported, and it really composites.** In WebView2
  152.0.4191.62 `CSS.supports("backdrop-filter: blur(1px)")` is `true` and
  `CSS.supports("not (backdrop-filter: blur(1px))")` is `false`, so the opaque
  fallback in `index.css` does not fire. It is not merely declared either: the
  pixels under the chat header change when the conversation scrolls beneath it,
  which a declared-but-inert filter could not do. Note that the **prefixed**
  property is *not* supported here — `-webkit-backdrop-filter` is `false` — so
  the `-webkit-` line in `.kub-glass` is inert in this engine and the unprefixed
  one is what carries the behaviour. Rule 9's trap about a bare property name
  also matching its vendor prefix therefore cannot be papered over by the prefix
  doing the work.
- **Chrome overlays content, and the compensation is exact.** Signed in, at
  1360x860: the scroller runs the full height of the pane (`top: 44`,
  `height: 816`) with the header's box at `top: 44, height: 56` over it,
  `listRunsBehindHeader: true`, and `padding-top: 64px` /
  `scroll-padding-top: 64px`, `padding-bottom: 94px` /
  `scroll-padding-bottom: 94px` — padding and scroll-padding equal on both sides,
  which is the half of rule 2 that breaks silently.
- **The conversation is visible through that chrome.** Photographed the header
  strip, 960x56, before and after a real wheel gesture, with every glyph in the
  document made transparent first: **16.1%** of the strip's pixels changed by
  more than 2/255. It is a faint effect in the light theme — worst channel delta
  **4**, mean **1** — but that is `--glass-fill` at `rgba(255, 255, 255, 0.80)`
  admitting a fifth of the backdrop, a property of the token in any engine and
  not something WebView2 does differently. The dark theme, at `0.46`, admits more
  than half.
- **Scrolling is not broken by the overlaying chrome.** A wheel gesture over the
  pane moved the list **1320px** upwards (`scrollTop` 4315 → 2995) and it stayed
  there, `scrollHeight` unchanged at 5131. An earlier measurement that assigned
  `scrollTop` directly saw no change in the pixels; that was the probe's fault,
  not the product's, and it is worth recording because the wrong method here
  manufactures a defect that is not there.
- **The focus ring reaches everything, the window controls included.** Fourteen
  Tab steps across the startup screen — version pill, the three window controls,
  both fingerprint blocks, both devices, the four stage labels — and every one
  matches `:focus-visible` and computes `2px solid rgb(77, 139, 208)`, which is
  `--kub-cyan`. The window controls carry `outline-offset: -2px` where the
  application uses `+2px`, and deliberately: they sit flush against the window
  edge, where an outset ring would be cut off by it.
- **Nothing on the startup screen clips.** Measured the width of every element's
  own text runs — a `Range` over its direct text nodes, so a hint tooltip inside
  an element is not mistaken for its overflow — against the element's content
  box, at 1360x860 and at the 960x640 minimum, in all four states the screen can
  reach: pending, verified, changed, failed. **Zero** offenders at either size,
  and the document never overflows its window. A cruder detector that read
  `scrollWidth` reported the override button in the `changed` state as four
  pixels over; that was its tooltip, and it is noted so the number is not
  rediscovered as a defect.
- **The type raise's premise is inverted on this screen, and it leaves slack
  rather than deficit.** The startup window cannot load Inter — its CSP is
  `default-src 'self'` and there is no font beside it — so it renders in the
  Windows stack while the application, and therefore the overlay, gets Inter from
  the network. Measured on the production page, where both faces are available,
  Segoe UI is **narrower** than Inter for this screen's Cyrillic, by 5% to 10%:

  | string | size | Inter | Segoe UI | ratio |
  | --- | --- | --- | --- | --- |
  | Продолжить — отпечаток не подтверждён | 11.5px | 199.66 | 183.88 | 0.921 |
  | Открываем рабочее пространство | 19px | 325.50 | 302.62 | 0.930 |
  | Оболочка LETSCUBE | 12px | 123.23 | 111.29 | **0.903** |
  | Сертификат узла изменился | 12.5px | 173.76 | 160.24 | 0.922 |

  So a label that fits in the browser cannot fail in this shell for want of room.
  If anything fails it is the other direction — the overlay is laid out with the
  startup window's constants and set in the wider face — and that was measured
  too: **zero** clipped labels in the overlay, at 1360x860 and at 960x640.

  The scene does therefore change typeface at the handoff, and that is a real
  discontinuity, but it is one the CSP decides and not one a stylesheet can fix.
  It is left standing, named here so it is not rediscovered as a mystery.
- **The 12px floor stops at `artifacts/kub`.** The startup screen still sets
  10px, 11px and 11.5px in fourteen places. It was outside the 203 that moved, it
  has its own scale, and nothing on it clips — so this is a scope boundary rather
  than a defect. Worth knowing that "the one 11px left in the product" in
  `index.css` is true of the application and not of the shell.

## One failure outside the interface, found on the way and not touched

`pnpm.cmd windows:tauri:qa:storage` passes all four of its phases and then its
own post-run check reports:

```
[FAIL] the second move did not carry 8 of 154 non-cache file(s):
EBWebView/Default/Extension State/LOCK,
EBWebView/Default/Local Storage/leveldb/LOCK,
EBWebView/Default/Network/Cookies,
EBWebView/Default/Session Storage/LOCK,
EBWebView/Default/shared_proto_db/LOCK
```

Seven of the eight are lock files and the eighth is the cookie store. The same
run's measurements line then says the second relocation carried all 154 non-cache
paths, so the two statements disagree and one of them is wrong. This is the
profile relocation path rather than the interface, it reproduces on a clean tree
before any change here, and it belongs to whoever owns
`scripts/windows-tauri-storage-suite.mjs`. Recorded because it was observed;
nothing about it was changed.

## Where this evidence is

The probes are in the ignored `output/windows-shell-audit/`: `launch.mjs`, which
owns a throwaway WebView2 profile and a loopback CDP port the way
`scripts/windows-tauri-qa.mjs` does; `probe-handoff.mjs`,
`probe-startup-frame.mjs`, `probe-type-fit.mjs` and
`probe-glass-over-content.mjs`, each writing its JSON beside it; and
`mutate.mjs`. The screenshots are under `shots/`.

No production conversation is in any of it. The startup screen and the overlay
carry no account data at all, and the certificate digests in those pictures are
invented — the probes generate their own and hand them to `window.renderStartup`,
because a real fingerprint has no business in a report. The one probe that needed
the signed-in application makes every glyph in the document transparent and hides
every raster before it photographs anything, so the strips it compares hold the
shape of surfaces and nothing readable.

## The Android shell, walked for the first time since the redesign

Walked 2026-09-06 on a Realme RMX3830, Android 15, API 35, WebView
Chrome/137.0.7151.72, screen 720x1600 at density 320 — a **360 x 748 CSS px**
viewport at `devicePixelRatio` 2. Debug APK built from `20feafc` by
`pnpm.cmd android:build:production:debug`, installed over `adb`, signed in on
the QA owner account so every conversation in this section is synthetic. Geometry
and computed styles were read over CDP against the live WebView
(`adb forward` to `webview_devtools_remote`); every screenshot is
`adb exec-out screencap`, so what is photographed includes the system bars and
the real IME.

**The viewport is the finding behind three of the five.** The release matrix
stops at `chromium-mobile-390`; this phone is 360, and 360 is the most common
Android width there is. Nothing below 390 has ever been looked at.

Two things measured clean and are recorded here so they are not re-checked:
`CSS.supports("backdrop-filter", "blur(1px)")` is **true** in this WebView, so
the `@supports not (backdrop-filter: blur(1px))` fallback of rule 6 stays dormant
and does not fire falsely — note that the *prefixed* property is the one that is
absent here, which is the opposite of the trap rule 9 records. And
`env(safe-area-inset-*)` resolves to `0px` on all four sides **correctly**:
Capacitor insets the WebView above the system bars rather than going
edge-to-edge, `innerHeight` is 748 against an 800px screen, and the app never
draws under the status or gesture bar. The absent `viewport-fit=cover` in
`artifacts/kub/index.html` therefore costs nothing on this shell.

## D-058 The keyboard takes the newest 266px of the conversation, and nothing takes them back

Found 2026-09-06, first thing, on the most ordinary action a messenger has:
tapping the composer to reply.

**Severity:** high. Every chat, every Android device, every time the keyboard
opens.

**Surface:** `artifacts/kub/src/components/chat/MessageList.tsx:641-658` — the
`ResizeObserver` that keeps the conversation pinned to the bottom observes
`contentRef`, the message column. The other re-pin, the layout effect at
`:639`, is keyed on `bottomInset`, `topInset` and `layoutVersion`.

**Defect:** on Android the WebView **resizes** when the IME opens. Nothing the
existing mechanisms watch changes:

| | keyboard closed | keyboard open |
| --- | --- | --- |
| `window.innerHeight` | 748 | **482** |
| `visualViewport.height` | 748 | 482 |
| computed keyboard inset | 0 | **0** |
| `--kub-composer-height` | 70px | 70px |
| `--kub-chat-chrome-height` | 56px | 56px |
| content `scrollHeight` | 4467 | 4467 |
| scrollport `clientHeight` | 748 | **482** |

The keyboard inset in `ChatWindow.tsx:173-196` correctly stays at `0`, because
`innerHeight - visualViewport.height - visualViewport.offsetTop` is genuinely 0
when the layout viewport itself shrank — the composer is already above the
keyboard and needs no padding. The composer's height does not move, so
`layoutVersion` does not change. The content's height does not move, so the
`ResizeObserver` never fires. **The one box that changed is the scrollport, and
nothing observes it.**

What follows is arithmetic. `scrollTop` is left at 3719 while the maximum rises
from 3719 to 3985:

| | closed | open |
| --- | --- | --- |
| `scrollTop` | 3719 | 3719 |
| max `scrollTop` | 3719 | 3985 |
| distance from bottom | **0** | **266** |
| newest bubble, against the composer's top edge | −23.9 (clear) | **+242.1 (behind it)** |

266 is exactly `748 − 482`: the reader loses the keyboard's own height of the
newest conversation. Reproduced 2/2 on clean open/close cycles with identical
numbers, and it does not settle — re-read 40s later, unchanged.

**It closes correctly, and that is the whole mechanism.** Growing the viewport
back clamps `scrollTop` down to the new maximum, which happens to be the bottom,
so dismissing the keyboard looks right and hides the asymmetry: shrinking leaves
a still-valid `scrollTop` alone, growing is forced to move it.

**No affordance is offered.** `scrollTop` never changes, so no `scroll` event
fires, so `isAtBottomRef` is still `true` and the scroll-to-bottom button — which
does appear normally, confirmed by scrolling by hand in the same session — is not
rendered. Nine visible buttons in the chat at that moment, none of them a way
back down.

It also does not reliably self-correct. Typing a single character left it at 266
(draft length 1, textarea focused, distance from bottom still 266). Anything
that *does* resize the content afterwards re-pins it, and because
`isAtBottomRef` was never falsified the correction arrives as a 266px lurch
rather than as a restoration.

**Consequence:** the reader taps the composer to answer a message and that
message, with the two before it, goes behind the keyboard. Screenshots:
`04-keyboard-open.png` is the defect, `05-keyboard-alt.png` the same chat and the
same keyboard with the list where it should be.

**Not attempted here.** The direction is to observe the scrollport as well as the
content, but `MessageList` is the most tuned mechanism in this codebase — this
register already carries 445px, 706px, 1147px and 1233px measurements behind its
current shape, and D-039 is a whole entry about a correction that made things
worse. It wants its own task.

## D-059 The light theme cannot be shown on a phone that is in night mode

Found 2026-09-06 while photographing both themes on the device.

**Severity:** medium-high. Any account that prefers light while the phone is
dark, which is a combination the app's own theme control offers.

**Surface:** `android/app/src/main/res/values/styles.xml` — `AppTheme` descends
from `Theme.AppCompat.DayNight.DarkActionBar`, and nothing anywhere calls
`WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)`.

**Defect:** with `kub-theme` set to `light` the document is correct in every way
the page can be correct — and the pixels are not the light theme.

| | declared | photographed |
| --- | --- | --- |
| root class | `h-full light` | — |
| `data-theme` | `light` | — |
| `:root { color-scheme }` | **`light`** | — |
| `body` background | `rgb(233, 239, 246)` | **`rgb(21, 22, 23)`** |
| `meta[theme-color]` | `#E9EFF6` | — |

Measured from the photographed pixels the way rule 7 requires, sampled at three
separate points of bare page ground: `rgb(21,22,23)` at all three. The hue is
gone — R, G and B within 2 of each other — which is the signature of WebView
algorithmic darkening rather than of any fill this product defines. The dark
theme photographs `rgb(10,26,48)` against its `#050B18` token in the same
places, above its token because of `--kub-ambient` and still unmistakably blue.

**The page already does the standards-correct thing and is overridden.**
`themeRuntime.ts:38` and the `index.html` bootstrap both set
`root.style.colorScheme`, and the device confirms the computed value is `light`.
That is precisely the declaration that *invites* algorithmic darkening: a page
claiming support for light only, on a night-mode system, with the activity on a
DayNight theme, is the documented case WebView darkens. A page declaring
`light dark` is left alone — which is why the dark theme renders correctly and
only the light one is wrong.

The result is a third appearance belonging to neither theme, and it is not
uniform: avatar fills come through untouched (`rgb(187,143,206)` identical in
both themes at the same point) while the surfaces around them invert, so the
palette the register's contrast work is measured against is not what is on the
glass. **Every light-theme contrast figure in this document is unverified on
this shell.**

**Consequence:** the light theme is unreachable on a night-mode phone, and the
darkening is silent — nothing in the DOM says it happened.

## D-060 Justified bubbles open 30px rivers at the width the phone actually has

**Severity:** medium. Every wrapped message, worse the narrower the device.

**Surface:** the bubble text carries `[text-align:justify]` with
`hyphens: manual`, so Russian prose is justified and never hyphenated.

**Defect:** justification distributes the slack into the word spaces, and a
283.6px column has little else to give. Measured on one message, per rendered
line, with a `Range` over the text node — the natural space in this font at this
size is **3.94px**:

| viewport | bubble width | worst word gap | ×natural |
| --- | --- | --- | --- |
| **360 (this phone)** | 283.6px | **30.54px** | **7.76** |
| 390 (narrowest tested) | 309.4px | 18.53px | 4.71 |
| 412 | 328.3px | 13.71px | 3.48 |

Same message, same engine, same fonts — only the width differs, using CDP metric
override so nothing else can account for it. The worst line is the one carrying
a long unbreakable token, but the natural-prose lines of the same message reach
**18.04px (4.58×)** at 360 on their own, so this is not an artefact of the QA
fixture's identifiers.

Visible in `07-state.png` and `08-search-jump.png` as the rivers running down
"QA-HISTORY 1085 — длинное сообщение…".

**Consequence:** the narrowest viewport ever tested understates the worst gap by
65%, and justification without hyphenation is doing the opposite of what it was
chosen for at the width most Android phones have.

## D-061 The six bottom tabs are closer together than the space in their own font

**Severity:** low. Every Android phone 360px wide or narrower; cosmetic, and it
reads as one run of words.

**Surface:** the bottom tab bar's six labels at 12px, `600` weight,
`letter-spacing: 0.3px`, uppercased.

**Defect:** the items are flex children that shrink to fit, so at 360 the labels
end up adjacent rather than clipped:

| viewport | narrowest gap between two labels | narrowest item |
| --- | --- | --- |
| **360 (this phone)** | **3.2px** | 44.6px |
| 390 | 9.0px | 48.0px |
| 412 | 13.2px | 50.5px |

A space character in that exact font at that exact size measures **3.02px**. The
gap between "ЗАДАЧИ" and "АДМИНКА" is **1.06 spaces** — narrower than the gap
between two words of one sentence, which is why `02-after-login.png` reads
"ПРОФИЛЬ ЗАДАЧИ АДМИНКА" as a single phrase.

The touch targets themselves still clear the floor — 44.6px is the narrowest,
against the 44px rule — but only by 0.6px.

## D-062 Four blurs ride inside the scrolling conversation

**Severity:** low, and a contract violation regardless of the number.

**Surface:** all four inside `<div ref={contentRef}>`, the scrolled content, in
`MessageList.tsx`: the system-message pill (`:104`), the history loading band
(`:822`), the date separator (`:887`) and the unread separator (`:894`). Each
writes `backdrop-blur-sm` or `backdrop-blur` as a Tailwind utility.

**Defect:** two rules at once. Rule 1 — the material is written by hand rather
than taken from `.kub-glass`. Rule 6 — "message bubbles, list rows, feed cards:
the chrome around them, yes; the content, no", and a date separator repeats once
per day of history.

**Measured**, on the device, with `dumpsys gfxinfo` across an identical set of
eight flings over the same conversation:

| | janky | 50th | 90th | 95th | 99th | slow draw cmds |
| --- | --- | --- | --- | --- | --- | --- |
| as shipped (7 blurs live) | 3.21% | 16ms | **21ms** | 25ms | 34ms | 28 |
| in-list blur off (6 live) | 2.46% | 15ms | 19ms | 22ms | 28ms | 22 |
| all blur off (0 live) | 0.88% | 11ms | **13ms** | 14ms | 20ms | 6 |

Only **one** in-list blur was on screen — this conversation spans a single day —
and removing it moved the 90th percentile 2ms of the 8ms the whole material
costs. So the rule-6 violation is real and small; what the table actually shows
is that **the chrome glass costs 6ms of the 8ms**, and that the 90th percentile
as shipped sits at 21ms against a 16.7ms frame budget while without the material
it sits at 13ms.

GPU time barely moves (90th: 6ms against 5ms). The cost is on the UI thread —
"slow issue draw commands" 28 against 6, "slow UI thread" 15 against 1 — which is
layer management, not fill rate.

**Not a first-order performance defect.** 3.21% janky is a smooth list, and
nothing in the flings dropped a visible frame. Recorded because the contract is
explicit, because the four sites are cheap to move onto the utilities, and
because the 21ms figure is the honest cost of the material on a mid-range phone
and should be known before anything is added to it.

## Measured on the device, and not a defect

**The scroll contracts hold, by finger rather than by wheel.** Chat entry with
no unread lands at the bottom with the newest bubble 23.9px clear of the
composer. Four fast upward flings in succession never snapped toward the bottom
and never jumped to the oldest history; the history prepend fired at the top and
the conversation carried on upward. A slow 464px drag tracked its witness row to
within 0.5px, and a 199px drag to within 0.0px.

**The search jump lands clear of chrome, and the scroll-padding tracks the
search bar.** Jumping to a result from 25,107px away put the target at 216.1px
from the top, fully visible, with `scroll-padding-top` and `padding-top` both at
**174px** — the header's 56 plus the search bar that had just appeared — which is
rule 2's "padding and scroll-padding move together" doing exactly its job while
the keyboard was also open. `08-search-jump.png`.

**D-039's withdrawal holds on this device.** A `requestAnimationFrame` sampler
across a prepend reported the witness row displaced **+1852.6px** for one sample
and back the next — the same shape, and a larger number, than the 1233px the
withdrawn entry reported. It is the same instrument error: rAF runs before style
and layout, so `getBoundingClientRect` there forces an early layout and reports a
frame that is never painted. Recorded so the next person who points a sampler at
this does not re-open it.

**D-042 reproduces at its recorded size.** The settled anchor drift across a
prepend measured **−39.4px** against the entry's 42px, and the loading band is
the 43px the scroll height grows by while `loadingOlder` is set. Unchanged, still
open, still the band.

## What could not be checked, and why

**Rotation.** `android/app/src/main/AndroidManifest.xml` pins the activity to
`android:screenOrientation="portrait"`, so there is no landscape on this shell
and no landscape keyboard. The rotation question has no answer to give here.

**A second keyboard height.** Switching layout inside the installed IME
(Russian to QWERTY, `05-keyboard-alt.png`) kept the height at exactly 266px, so
the language-change case produced no second data point. A second IME is
installed but making it current is a system setting and was left alone. The
mechanism in D-058 is `Δ = clientHeight before − after`, so any other height
displaces by exactly that height; a second measurement would illustrate it, not
determine it.

**Chat-list scrolling.** The QA owner account has three chats. There is nothing
to fling, so the sidebar's scroll cost is unmeasured; the eight-fling figures in
D-062 are the message list only.

**Push, and the notification jump behind it.** `android/app/google-services.json`
is absent from this worktree, so the debug build ships without the
google-services plugin and no notification could be delivered. The search jump
exercises the same `scrollIntoView` path and is recorded above.

## Where this evidence is

The device screenshots are in the session scratchpad, not in the repository:
`01-login.png`, `02-after-login.png` (D-061), `03-chat-open.png`,
`04-keyboard-open.png` and `05-keyboard-alt.png` (D-058), `06-message-actions.png`,
`07-state.png` (D-060), `08-search-jump.png` and `09-light.png` (D-059). Every
one is `adb exec-out screencap` from the device, so each includes the system bars
and, where relevant, the real IME.

Nothing in any of them carries a real conversation. The session was signed in on
the QA owner account through `KUB_QA_OWNER_*`, the way the e2e suite does; the
three chats it can see are `Избранное`, `Test test` and `LocationStaffTest`, and
their contents are the `QA-HISTORY nnnn` fixtures and `codex …` sync markers this
repository generates. No credential was typed on the device or passed on a
command line — the sign-in reads the QA env file inside Node and drives the form
over CDP. The app's stored theme was set to `light` for D-059 and the key removed
afterwards, returning it to `system`; no Android setting was changed at any point.
