/**
 * Interface audit harness for the polish stage.
 *
 * Walks the release viewport and theme matrix over a list of surfaces and emits
 * two things per cell: a screenshot, and machine-measured findings. Judgement is
 * spent only on what a machine cannot measure; everything below is measured.
 *
 * It fails loudly when a surface cannot be reached. A harness that quietly
 * records nothing is worse than no harness, which this project has already paid
 * for once: an authenticated suite spent weeks passing without ever signing in.
 *
 * Usage:
 *   node scripts/interface-audit.mjs --base https://app.letscube.ru --out output/audit
 *   node scripts/interface-audit.mjs --surfaces login,public-home   (subset)
 *   node scripts/interface-audit.mjs --viewports 1440x900,390x844
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const BASE = args.get("base") ?? process.env.KUB_BASE_URL ?? "https://app.letscube.ru";
const OUT = path.resolve(args.get("out") ?? "output/audit");
const SHELL = args.get("shell") ?? "browser";

const ALL_VIEWPORTS = [
  { name: "3840x2160", width: 3840, height: 2160, mobile: false },
  { name: "1920x1080", width: 1920, height: 1080, mobile: false },
  { name: "1440x900", width: 1440, height: 900, mobile: false },
  { name: "412x915", width: 412, height: 915, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  // The narrowest phone the product is actually installed on: 720x1600 at
  // density 320 is 360 CSS pixels. The matrix stopped at 390 until D-058,
  // D-060 and D-061 all arrived from below it in one walk on the device.
  { name: "360x800", width: 360, height: 800, mobile: true },
];

const ALL_SURFACES = [
  { id: "public-home", path: "/", auth: false, settle: "section[aria-labelledby='public-platforms-title']" },
  { id: "login", path: "/login", auth: false, settle: "input[type='email']" },
  { id: "privacy", path: "/privacy", auth: false, settle: "main, article" },
  { id: "support", path: "/support", auth: false, settle: "main, form" },
  { id: "messenger", path: "/", auth: true, settle: "button[aria-label='Меню']" },
  { id: "bots", path: "/bots", auth: true, settle: "button[aria-label='Меню'], main" },
  // The tasks page renders its own header rather than the shell chrome, so it
  // is anchored on that heading instead of on `main`.
  { id: "tasks", path: "/tasks", auth: true, settle: "text=Задачи" },

  // The staff-only area. Each tab is its own surface: they share a shell but
  // not a layout, and auditing only the first would say nothing about the rest.
  { id: "admin-dashboard", path: "/admin", auth: true, settle: "text=Сводка" },
  { id: "admin-users", path: "/admin/users", auth: true, settle: "text=Пользователи" },
  { id: "admin-locations", path: "/admin/locations", auth: true, settle: "text=Локации" },
  { id: "admin-invites", path: "/admin/invites", auth: true, settle: "text=Инвайты" },
  { id: "admin-roles", path: "/admin/roles", auth: true, settle: "text=Роли и права" },
  { id: "admin-bans", path: "/admin/bans", auth: true, settle: "text=Блокировки" },
  { id: "admin-ops", path: "/admin/ops", auth: true, settle: "text=Операции" },
  { id: "admin-support", path: "/admin/support", auth: true, settle: "text=Поддержка" },
  { id: "admin-audit", path: "/admin/audit", auth: true, settle: "text=Журнал" },

  // Surfaces that no URL reaches. The profile card, the settings screen and the
  // conversation itself are all opened by pressing something, so a harness that
  // only navigates measures the shell around them and reports a pass. Each one
  // below says how it is opened; `SHELL_READY` is what has to exist first.
  {
    id: "chat",
    path: "/",
    auth: true,
    settle: "[data-testid='message-scroll-container']",
    open: openFirstChat,
    // Rows that change height after their first painted frame — the D-032,
    // D-041 and D-043 class. Measured from before the app boots, so the first
    // sample is the first layout and not whatever is on screen a second later.
    shiftSelector: "[data-message-id]",
  },
  {
    id: "profile-card",
    path: "/",
    auth: true,
    settle: "[data-testid='chat-info-summary']",
    open: async (page) => {
      await openFirstChat(page);
      await page.getByTestId("chat-header-info-button").first().click();
    },
  },
  {
    id: "profile-media",
    path: "/",
    auth: true,
    settle: "[data-testid='chat-info-gallery-view']",
    open: async (page) => {
      // The first chat in the list is the owner's own «Избранное» and holds no
      // shared media, so opening it and reporting "unreachable" would have said
      // the sub-view was broken when it was the fixture that was wrong. Walk
      // the list until a chat that actually carries media is found.
      const chats = page.getByTestId("chat-list-item");
      await chats.first().waitFor({ state: "visible", timeout: 25_000 });
      const total = Math.min(await chats.count(), 8);
      for (let index = 0; index < total; index += 1) {
        await chats.nth(index).click();
        await page.getByTestId("chat-header-info-button").first().click();
        await page.getByTestId("chat-info-panel").first().waitFor({ state: "visible", timeout: 20_000 });
        // The placeholder going is what says the counts are known; a row read
        // before then is a race, exactly as `media-gallery-variants.spec.ts` says.
        await page
          .getByTestId("chat-info-media-loading")
          .first()
          .waitFor({ state: "detached", timeout: 20_000 })
          .catch(() => {});
        const rows = page.getByTestId("chat-info-media-row");
        if ((await rows.count()) > 0) {
          await rows.first().click();
          return;
        }
        // Below 640px the card fills the viewport, so the chat list is only
        // reachable again once the card is closed by its own control.
        await page
          .getByTestId("chat-info-header")
          .getByRole("button", { name: "Закрыть" })
          .first()
          .click()
          .catch(() => {});
        await page.getByTestId("chat-info-panel").first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
        // And below 640px the chat itself is the whole screen, so the list is
        // behind the header's back control rather than beside the chat.
        const back = page.locator('button[aria-label="Назад"]').first();
        if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
      }
      throw new Error(`none of the first ${total} QA chats hold shared media, so the sub-view cannot be opened`);
    },
  },
  {
    id: "settings",
    path: "/",
    auth: true,
    settle: "[role='dialog']",
    open: openSettings,
  },
  {
    // The four expensive rows are disclosures and stay unmounted until pressed,
    // so the closed screen says nothing about what they contain.
    id: "settings-expanded",
    path: "/",
    auth: true,
    settle: "[data-testid='settings-section-audio']",
    open: async (page) => {
      await openSettings(page);
      for (const id of ["decoration", "audio", "application"]) {
        const row = page.getByTestId(`settings-open-${id}`).first();
        if (await row.isVisible().catch(() => false)) {
          await row.scrollIntoViewIfNeeded().catch(() => {});
          await row.click();
        }
      }
    },
  },
];

/** What has to be on screen before a surface can be opened by pressing things. */
const SHELL_READY = "button[aria-label='Меню']";

async function openFirstChat(page) {
  const chats = page.getByTestId("chat-list-item");
  await chats.first().waitFor({ state: "visible", timeout: 25_000 });
  await chats.first().click();
}

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
}

const viewports = args.has("viewports")
  ? ALL_VIEWPORTS.filter((v) => args.get("viewports").split(",").includes(v.name))
  : ALL_VIEWPORTS;
const surfaces = args.has("surfaces")
  ? ALL_SURFACES.filter((s) => args.get("surfaces").split(",").includes(s.id))
  : ALL_SURFACES;
const themes = args.has("themes") ? args.get("themes").split(",") : ["dark", "light"];

function qaCredentials() {
  const file = process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env");
  if (!fs.existsSync(file)) return null;
  const values = new Map();
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values.set(line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""));
  }
  const email = values.get("KUB_QA_OWNER_EMAIL");
  const password = values.get("KUB_QA_OWNER_PASSWORD");
  return email && password ? { email, password } : null;
}

/** Everything measured in the page. Returns structured findings, never opinions. */
export const PAGE_CHECKS = () => {
  const findings = [];
  const add = (kind, detail, node, extra = {}) => {
    findings.push({
      kind,
      detail,
      selector: node ? describe(node) : null,
      text: node ? (node.textContent ?? "").trim().slice(0, 60) : null,
      ...extra,
    });
  };

  function describe(node) {
    if (!node || node.nodeType !== 1) return null;
    const parts = [node.tagName.toLowerCase()];
    if (node.id) parts.push(`#${node.id}`);
    const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) parts.push(`.${cls.join(".")}`);
    for (const attribute of ["data-testid", "aria-label", "role"]) {
      const value = node.getAttribute(attribute);
      if (value) parts.push(`[${attribute}="${value}"]`);
    }
    return parts.join("");
  }

  /**
   * A parked layer takes its children with it.
   *
   * `opacity` is not an inherited property, so a child of a faded-out panel
   * reports `opacity: 1` and every check downstream treated it as on screen.
   * The profile card keeps its media sub-view mounted beside the root view at
   * `opacity: 0`, `pointer-events: none` and `inert`, pushed 12% to the right —
   * and the harness reported that 45px push as content "a person needs" being
   * clipped, at all ten cells, in a card that looks and behaves correctly.
   *
   * `inert` is the same statement made in markup: the subtree is out of the
   * document's reach. Neither is measured.
   */
  const isHiddenByAncestor = (node) => {
    let current = node.parentElement;
    while (current && current !== document.documentElement) {
      if (current.hasAttribute("inert")) return true;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };

  /**
   * Something opaque is standing in front of it.
   *
   * Below 640px the profile card docks and fills the viewport, and the chat it
   * was opened from stays laid out behind it — squeezed to twelve pixels, but
   * still `display: block`, still non-zero, still measurable. The harness
   * reported eighty-five undersized controls and a clipped scroller in a card
   * that covers every one of them. A person cannot see, tap or be confused by a
   * control nobody can reach.
   *
   * The test is the browser's own hit test at the element's centre. An element
   * that hit-tests to itself, to one of its descendants, or to an ancestor
   * whose box it sits inside, is on top; anything else is a different subtree
   * painted over it. Elements whose centre falls outside the viewport are
   * exempt — they are scrolled away, not covered, and `elementFromPoint`
   * answers `null` for both.
   */
  const isOccluded = (node) => {
    // A node the hit test cannot return is not a node the hit test can answer
    // for. `pointer-events: none` is inherited, so this covers a decorative
    // overlay and everything drawn inside it.
    if (getComputedStyle(node).pointerEvents === "none") return false;
    const box = node.getBoundingClientRect();
    // Entirely past the left or right edge. The document itself does not scroll
    // sideways — the check above reports it when it does — so there is no
    // gesture that brings this back; it is off the screen for good. Below 640px
    // the docked profile card takes the whole width and pushes the chat it was
    // opened from out there, eighty controls at a time.
    //
    // Vertically off screen is the opposite case and is deliberately still
    // measured: a person scrolls to it. The privacy page's twenty-two 32px
    // entries were found below the fold.
    if (box.right <= 0 || box.left >= innerWidth) return true;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    if (hit === null) return false;
    return !(hit === node || node.contains(hit) || hit.contains(node));
  };

  const isVisible = (node) => {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (node.hasAttribute("inert") || isHiddenByAncestor(node)) return false;
    if (isOccluded(node)) return false;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    // Screen-reader-only text is clipped on purpose. Counting it as a clipping
    // defect fills the register with labels that are working exactly as
    // intended, which is the fastest way to make an audit worthless.
    const clipped =
      /inset\(\s*50%/.test(style.clipPath) ||
      /rect\(\s*0(px)?[,\s]/.test(style.clip) ||
      (box.width <= 1 && box.height <= 1);
    return !clipped;
  };

  const all = Array.from(document.querySelectorAll("body *")).filter(isVisible);

  // 1. Horizontal overflow of the document and of every scroll container.
  const root = document.scrollingElement ?? document.documentElement;
  if (root.scrollWidth - root.clientWidth > 1) {
    add("overflow-x-document", `document scrolls sideways by ${root.scrollWidth - root.clientWidth}px`, null);
  }
  for (const node of all) {
    const style = getComputedStyle(node);
    const scrolls = /(auto|scroll)/.test(style.overflowX);
    const over = node.scrollWidth - node.clientWidth;
    if (!scrolls && over > 1 && style.overflowX === "visible") continue;
    if (scrolls && over > 1) continue; // a scroll container is allowed to scroll
    if (!scrolls && over > 1 && style.overflowX === "hidden") {
      // Clipping a decorative image against the viewport edge is a design
      // choice, not a defect. Only report it when something a person needs —
      // text or a control — is what gets cut off. The login page's mascot bleed
      // was otherwise reported as a 461px defect at every viewport.
      const box = node.getBoundingClientRect();
      const cutOff = Array.from(node.querySelectorAll("*")).some((child) => {
        // A parked sub-view is clipped on purpose and nobody can read it; see
        // `isHiddenByAncestor`.
        if (!isVisible(child)) return false;
        const rect = child.getBoundingClientRect();
        if (rect.right <= box.right + 1 && rect.left >= box.left - 1) return false;
        const interactive = child.matches("button, a[href], input, select, textarea, [role=button]");
        const ownText = Array.from(child.childNodes).some(
          (kid) => kid.nodeType === 3 && (kid.textContent ?? "").trim().length > 0,
        );
        return interactive || ownText;
      });
      if (cutOff) {
        add("clipped-horizontally", `content a person needs exceeds its box by ${over}px and is clipped`, node, { overflow: over });
      }
    }
  }

  // 2. Text clipped by its own box.
  for (const node of all) {
    if (node.children.length > 0) continue;
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    const style = getComputedStyle(node);
    if (style.textOverflow === "ellipsis") continue; // deliberate truncation
    const over = node.scrollWidth - node.clientWidth;
    const under = node.scrollHeight - node.clientHeight;
    if (over > 1 && /(hidden|clip)/.test(style.overflowX)) {
      add("text-clipped", `text is cut off horizontally by ${over}px`, node, { overflow: over });
    } else if (under > 1 && /(hidden|clip)/.test(style.overflowY) && under > 2) {
      add("text-clipped", `text is cut off vertically by ${under}px`, node, { overflow: under });
    }
  }

  // 3. Touch targets. Reported only on mobile viewports by the caller.
  const interactive = all.filter((node) =>
    node.matches("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link]"),
  );
  for (const node of interactive) {
    const box = node.getBoundingClientRect();
    // A control that fills a bordered wrapper is as tappable as that wrapper.
    // Measuring the control alone reported 42px fields inside 44px boxes, where
    // the missing 2px is the wrapper's own border.
    const parent = node.parentElement;
    const parentBox = parent ? parent.getBoundingClientRect() : null;
    const fillsParent = parentBox !== null && parentBox.height - box.height <= 4 && box.height > 0;
    let effective = fillsParent ? Math.max(box.height, parentBox.height) : box.height;
    let effectiveWidth = box.width;

    // A form control wrapped in a label is activated by the whole label — that
    // is native behaviour, not something the page has to build. Measuring the
    // control alone called a 16px checkbox inside a padded consent row an
    // undersized target when the entire row toggles it.
    const label = node.closest("label") ?? (node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null);
    if (label && label !== node) {
      const labelBox = label.getBoundingClientRect();
      if (labelBox.height > 0) {
        effective = Math.max(effective, labelBox.height);
        effectiveWidth = Math.max(effectiveWidth, labelBox.width);
      }
    }

    // A link inside a sentence is exempt, in both WCAG 2.5.5 and 2.5.8: its
    // height is set by the line box of the text around it, and padding it out
    // to 44px would break the paragraph it sits in. The test is whether the
    // parent carries text of its own beyond the link — a link alone in its
    // container is a button in all but name and is not exempted.
    const inlineInSentence =
      node.tagName === "A" &&
      node.parentElement !== null &&
      (node.parentElement.textContent ?? "").trim().length >
        (node.textContent ?? "").trim().length + 1;

    if (!inlineInSentence && (effective < 44 || effectiveWidth < 24)) {
      add("touch-target", `interactive control is ${Math.round(effectiveWidth)}x${Math.round(effective)}px`, node, {
        width: Math.round(effectiveWidth),
        height: Math.round(effective),
      });
    }
  }

  // 4. Contrast of text against its effective background.
  const parseColor = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const effectiveBackground = (node) => {
    let current = node;
    while (current && current !== document.documentElement) {
      const colour = parseColor(getComputedStyle(current).backgroundColor);
      if (colour && colour.a > 0.9) return colour;
      current = current.parentElement;
    }
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    return body && body.a > 0.9 ? body : { r: 255, g: 255, b: 255, a: 1 };
  };

  for (const node of all) {
    if (node.children.length > 0) continue;
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    const style = getComputedStyle(node);
    const foreground = parseColor(style.color);
    if (!foreground || foreground.a < 0.9) continue;
    const background = effectiveBackground(node);
    const lf = luminance(foreground);
    const lb = luminance(background);
    const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const bold = Number.parseInt(style.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const required = large ? 3 : 4.5;
    if (ratio < required) {
      add("contrast", `contrast ${ratio.toFixed(2)}:1 against its background, needs ${required}:1`, node, {
        ratio: Number(ratio.toFixed(2)),
        required,
        fontSize: size,
      });
    }
  }

  return findings;
};

/**
 * Focus visibility, checked with the keyboard rather than with `focus()`.
 *
 * The first version of this called `node.focus()` and compared styles. That
 * reported every primary button in the product as having no focus indicator,
 * which was wrong: the shared button styles its focus with `:focus-visible`,
 * and browsers deliberately do not match that pseudo-class for scripted focus.
 * A harness that cannot tell a real defect from its own method would have put
 * three invented findings into the register on its first run.
 */
/**
 * Refuse to measure an unstyled page.
 *
 * A run where the stylesheet did not load produced 549 findings across the
 * staff area, every one of them meaningless: contrast came out at exactly
 * 1.00:1 and every element reported the browser's default 16px, because what
 * was being measured was raw HTML. Hundreds of invented findings are far worse
 * than none, so this throws rather than warns.
 */
/**
 * Elements that change size after the frame they were first laid out in.
 *
 * This is the D-032 / D-041 / D-043 class, and it cannot be measured after the
 * fact: by the time a harness has navigated, waited and settled, the movement
 * has already happened and the element is sitting at its final height looking
 * innocent. So the recorder is installed with `addInitScript`, before any page
 * script runs, and a `ResizeObserver` picks each row up as it is inserted.
 *
 * A `ResizeObserver` callback runs at the end of the frame that laid the element
 * out, before that frame is painted, so its first entry is the first painted
 * box — the same definition the chat measurements in the register use.
 *
 * It reports geometry only. A row whose *text* changed had a reason to change
 * height, so the caller is handed the count and the sizes and decides; nothing
 * here is a finding on its own.
 */
export const LATE_SHIFT_RECORDER = (selector) => {
  const seen = new Map();
  const t0 = performance.now();
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const node = entry.target;
      const height = entry.contentRect.height;
      if (height <= 0) continue;
      const key = node.getAttribute("data-message-id") ?? String(seen.size);
      const record = seen.get(key);
      if (!record) {
        seen.set(key, {
          first: height,
          firstAt: Math.round(performance.now() - t0),
          last: height,
          lastAt: Math.round(performance.now() - t0),
          changes: 0,
          text: (node.textContent ?? "").trim().length,
        });
        continue;
      }
      if (Math.abs(height - record.last) <= 0.5) continue;
      record.last = height;
      record.lastAt = Math.round(performance.now() - t0);
      record.changes += 1;
      record.textAfter = (node.textContent ?? "").trim().length;
    }
  });

  const attach = (root) => {
    if (!(root instanceof Element)) return;
    if (root.matches?.(selector)) observer.observe(root);
    for (const node of root.querySelectorAll?.(selector) ?? []) observer.observe(node);
  };

  const mutations = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) attach(node);
  });

  const start = () => {
    if (!document.body) return;
    attach(document.body);
    mutations.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  window.__auditShift = seen;
};

export async function assertStyled(page) {
  const state = await page.evaluate(() => ({
    token: getComputedStyle(document.documentElement).getPropertyValue("--kub-bg").trim(),
    sheets: document.styleSheets.length,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }));
  if (!state.token || state.sheets === 0) {
    throw new Error(
      `the page rendered unstyled (--kub-bg="${state.token}", ${state.sheets} stylesheets, body ${state.bodyBackground}); measuring it would invent findings`,
    );
  }
  return state;
}

export async function checkFocusVisibility(page, maxStops = 40) {
  await page.evaluate(() => {
    const tabbable = Array.from(
      document.querySelectorAll(
        "button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
    window.__auditFocus = new Map();
    tabbable.forEach((node, index) => {
      node.setAttribute("data-audit-focus", String(index));
      const style = getComputedStyle(node);
      window.__auditFocus.set(String(index), [
        style.outlineStyle,
        style.outlineWidth,
        style.outlineColor,
        style.boxShadow,
        style.borderColor,
        style.backgroundColor,
        style.color,
      ].join("|"));
    });
  });

  const findings = [];
  const seen = new Set();
  await page.evaluate(() => document.body.focus?.());

  for (let stop = 0; stop < maxStops; stop += 1) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || node === document.body || node.nodeType !== 1) return null;
      const index = node.getAttribute("data-audit-focus");
      if (index === null) return null;
      const style = getComputedStyle(node);
      const after = [
        style.outlineStyle,
        style.outlineWidth,
        style.outlineColor,
        style.boxShadow,
        style.borderColor,
        style.backgroundColor,
        style.color,
      ].join("|");
      const label = node.getAttribute("aria-label") || (node.textContent ?? "").trim().slice(0, 40);
      const parts = [node.tagName.toLowerCase()];
      if (label) parts.push(`"${label}"`);
      return { index, changed: after !== window.__auditFocus.get(index), selector: parts.join(" ") };
    });

    if (!result) continue;
    if (seen.has(result.index)) break; // focus has cycled
    seen.add(result.index);
    if (!result.changed) {
      findings.push({
        kind: "focus-invisible",
        detail: "tabbing to the control changes nothing visible",
        selector: result.selector,
      });
    }
  }

  await page.evaluate(() => {
    for (const node of document.querySelectorAll("[data-audit-focus]")) node.removeAttribute("data-audit-focus");
    delete window.__auditFocus;
  });
  return findings;
}

/**
 * Signs in, with one retry.
 *
 * Measured against production, two or three cells out of sixty-four were lost
 * per run to a sign-in that timed out and then worked immediately on a second
 * attempt — a network window rather than a defect, but reported as unreachable
 * it looked like one. Two attempts and no more: a genuine failure, a wrong
 * password or a broken build still fails twice and says so.
 */
async function signIn(page, credentials) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(2_000);
    const form = await openLoginForm(page).catch((error) => {
      lastError = error;
      return null;
    });
    if (form === null) continue;
    if (form === "already-signed-in") return;
    await page.locator('input[type="email"]').first().fill(credentials.email);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    await page.locator('button[type="submit"]').first().click();
    const ok = await page.locator('button[aria-label="Меню"]').first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    if (ok) return;
    lastError = new Error("sign-in did not reach the authenticated shell");
  }
  throw lastError ?? new Error("sign-in did not reach the authenticated shell");
}

/**
 * Gets to a usable login form, including from a boot that has stalled.
 *
 * A session restore whose token refresh never returns leaves the app on its own
 * "Загрузка длится дольше обычного" panel, and this harness then lost whole
 * cells to a sign-in that could not have succeeded. The panel offers "Выйти",
 * which drops the stuck session and gives the form back — the same escape the
 * e2e helper takes. Reported as unreachable it looked like a defect in the
 * surface being audited, which it never was.
 */
async function openLoginForm(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const email = page.locator('input[type="email"]').first();
    if (await email.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false)) {
      return "form";
    }
    const shell = await page.locator('button[aria-label="Меню"]').first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    if (shell) return "already-signed-in";

    const signOut = page.getByRole("button", { name: "Выйти" }).first();
    if (!(await signOut.isVisible().catch(() => false))) break;
    await signOut.click().catch(() => {});
  }
  throw new Error("neither the login form nor the authenticated shell appeared at /login");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const credentials = qaCredentials();
  const needsAuth = surfaces.some((surface) => surface.auth);
  if (needsAuth && !credentials) {
    throw new Error("authenticated surfaces were requested but no QA owner credentials are configured");
  }

  const browser = await chromium.launch();
  const report = [];
  let unreachable = 0;

  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        locale: "ru-RU",
        deviceScaleFactor: 1,
        // A phone viewport with a mouse is not a phone. Without this the media
        // query `(pointer: coarse)` never matches, so touch-target rules meant
        // for a finger are measured as if a cursor were being used — the
        // harness would have reported the D-015 fix as having changed nothing.
        hasTouch: viewport.mobile,
        isMobile: viewport.mobile,
      });
      const page = await context.newPage();
      let signedIn = false;

      for (const surface of surfaces) {
        const cell = `${surface.id} ${viewport.name} ${theme}`;
        try {
          if (surface.auth && !signedIn) {
            await signIn(page, credentials);
            signedIn = true;
          }
          if (surface.shiftSelector) {
            // Before the app boots, or the first layout is already gone.
            await page.addInitScript(LATE_SHIFT_RECORDER, surface.shiftSelector);
          }
          await page.goto(`${BASE}${surface.path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          if (surface.open) {
            await page.locator(surface.ready ?? SHELL_READY).first().waitFor({ state: "visible", timeout: 25_000 });
            await surface.open(page, viewport);
          }
          await page.locator(surface.settle).first().waitFor({ state: "visible", timeout: 25_000 });
          await page.waitForTimeout(1200);

          // Refuse to measure an unstyled page. A run where the stylesheet did
          // not load produced 549 findings across the staff area, every one of
          // them meaningless: contrast came out at exactly 1.00:1 and every
          // element reported the default 16px, because the measurements were of
          // raw HTML. Hundreds of invented findings are far worse than none, so
          // this is a loud failure rather than a warning.
          await assertStyled(page);

          const findings = await page.evaluate(PAGE_CHECKS);

          // The evidence image is taken here, before the keyboard walk. Tabbing
          // forty stops scrolls each focused control into view, so every
          // screenshot of a scrolling surface was of the page as the *harness*
          // had left it: the settings dialog's evidence showed it opened three
          // rows down, and nothing on the image said the harness had put it
          // there. A screenshot that does not show the arrival state is worse
          // than none, because it is read as one.
          const shot = path.join(OUT, `${SHELL}-${surface.id}-${viewport.name}-${theme}.png`);
          await page.screenshot({ path: shot, fullPage: false });

          const focus = await checkFocusVisibility(page);
          const collected = [...findings, ...focus].filter(
            (finding) => finding.kind !== "touch-target" || viewport.mobile,
          );

          const shifts = surface.shiftSelector
            ? await page.evaluate(() =>
                Array.from(window.__auditShift ?? [], ([id, record]) => ({ id, ...record })).filter(
                  (record) => record.changes > 0,
                ),
              )
            : null;

          const observed = surface.shiftSelector
            ? await page.evaluate(() => (window.__auditShift ?? new Map()).size)
            : null;

          report.push({
            shell: SHELL,
            surface: surface.id,
            viewport: viewport.name,
            theme,
            screenshot: path.basename(shot),
            findings: collected,
            ...(shifts ? { lateShift: { observed, changed: shifts.length, rows: shifts.slice(0, 12) } } : {}),
          });
          const counts = collected.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
          const shiftNote = shifts ? ` shift ${shifts.length}/${observed}` : "";
          console.log(`ok   ${cell}: ${collected.length} finding(s) ${JSON.stringify(counts)}${shiftNote}`);
        } catch (error) {
          unreachable += 1;
          report.push({ shell: SHELL, surface: surface.id, viewport: viewport.name, theme, unreachable: String(error).slice(0, 200) });
          console.log(`FAIL ${cell}: ${String(error).split("\n")[0].slice(0, 140)}`);
        }
      }
      await context.close();
    }
  }
  await browser.close();

  const reportPath = path.join(OUT, `${SHELL}-report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const total = report.reduce((sum, cell) => sum + (cell.findings?.length ?? 0), 0);
  console.log(`\n${report.length} cells, ${total} findings, ${unreachable} unreachable`);
  console.log(`report: ${reportPath}`);
  // Unreachable cells are a harness failure, not an empty result.
  process.exitCode = unreachable > 0 ? 1 : 0;
}

// Importable for the harness self-test; only runs the audit when executed.
const executedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
