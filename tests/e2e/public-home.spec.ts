import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Responsive and accessibility contract for the public home.
 *
 * The page makes availability claims to people who are not logged in, so the
 * assertions here are about what a visitor can actually see and reach: nothing
 * scrolls sideways, no action is cut off, the imagery really loaded, the
 * platform sections are reachable from the first viewport, and a platform with
 * no release offers nothing to press and claims nothing about a store.
 */

// Step 7 of the plan names four of these; the 3840 project is a scaling check
// that this contract does not add anything to. `chromium-mobile-360` was added
// on 2026-09-06 — the matrix stopped at 390 and the first Android walk found
// three defects below it, so a public surface that makes availability claims is
// the last place that should go on being unchecked at the narrowest width.
//
// `webkit-mobile-390` was added later the same day, and for a sharper reason.
// The engine had never been in the matrix at all, and the first spec run on it
// found the chat header unpaintable in Safari. This list then quietly cancelled
// half of that: naming five chromium projects meant every one of this file's
// fifteen tests skipped on the new project, so the one public surface an iPhone
// owner reaches — in Safari, before installing anything, while it tells them
// which platforms are available — remained the surface with no Safari coverage.
// A gate that enumerates engines has to be revisited whenever an engine is
// added, and nothing about adding one says so.
const COVERED_PROJECTS = [
  "chromium-desktop-1920",
  "chromium-desktop-1440",
  "chromium-mobile-412",
  "chromium-mobile-390",
  "chromium-mobile-360",
  "webkit-mobile-390",
];

const SCROLL_ROOT = '[data-testid="public-scroll-root"]';
const CATALOG = "https://api.letscube.ru/releases/v1/**";

// Positioning that the product has moved away from and must not reappear on a
// public surface. The legal entity name in the footer is deliberately not here.
const RETIRED_POSITIONING = [/компьютерн\w* клуб/i, /кибер[- ]?арена/i, /киберклуб/i, /игров\w* клуб/i];

const STORE_CLAIMS = [/app\s*store/i, /google\s*play/i, /установить из/i, /доступно в/i];

function manifest(platform: string, available: boolean) {
  return {
    schemaVersion: 1,
    platform,
    channel: "stable",
    available,
    version: platform === "android" ? "0.1.3" : "0.2.10",
    build: 14,
    publishedAt: "2026-08-31T09:00:00.000Z",
    minimumSupportedVersion: null,
    mandatory: false,
    notes: "Плановое обновление.",
    // More than ReleaseChangelog shows at once, so the expander is exercised.
    highlights: [
      "Быстрее открывается чат",
      "Уведомления группируются по чату",
      "Меньше расход батареи в фоне",
      "Ускорен поиск по сообщениям",
    ],
    artifact: available
      ? {
        url: `https://api.letscube.ru/releases/files/${platform}/${platform === "android" ? "0.1.3" : "0.2.10"}/build.bin`,
        size: 2_322_508,
        sha256: "697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd",
      }
      : null,
  };
}

type CatalogMode = "available" | "unavailable" | "unreachable";

async function installCatalog(page: Page, mode: CatalogMode = "available") {
  await page.route(CATALOG, async (route: Route) => {
    if (mode === "unreachable") {
      await route.abort("connectionfailed");
      return;
    }
    const platform = new URL(route.request().url()).pathname.split("/")[3] ?? "windows";
    const published = platform === "windows" || platform === "android";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manifest(platform, published && mode === "available")),
    });
  });
}

test.describe("public home presentation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // An all-skipped run exits 0, so a rename in either file would turn this
    // whole availability contract into a green no-op. Fail instead.
    const configured = testInfo.config.projects.map((project) => project.name);
    const missing = COVERED_PROJECTS.filter((name) => !configured.includes(name));
    if (missing.length > 0) {
      throw new Error(
        `These viewports are named by this contract but are not configured: ${missing.join(", ")}. `
          + `Configured projects: ${configured.join(", ")}.`,
      );
    }

    test.skip(
      !COVERED_PROJECTS.includes(testInfo.project.name),
      "This contract covers the four release viewports named by the plan.",
    );
    await installCatalog(page);
  });

  test("nothing scrolls sideways and no action is cut off", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      return {
        document: document.documentElement.scrollWidth - window.innerWidth,
        root: root ? root.scrollWidth - root.clientWidth : 0,
      };
    }, SCROLL_ROOT);

    expect(overflow.document, "the document scrolls sideways").toBeLessThanOrEqual(0);
    expect(overflow.root, "the page container scrolls sideways").toBeLessThanOrEqual(0);

    const viewport = page.viewportSize();
    const links = page.locator("main a, main button");
    for (let index = 0; index < (await links.count()); index += 1) {
      const control = links.nth(index);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (!box) continue;
      expect(box.x, `${await control.innerText()} starts off-screen`).toBeGreaterThanOrEqual(-1);
      expect(
        box.x + box.width,
        `${await control.innerText()} is cut off on the right`,
      ).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    }
  });

  test("the platform sections are reachable from the first viewport", async ({ page }) => {
    await page.goto("/");
    const platforms = page.getByRole("heading", { name: "Приложения LETSCUBE" });
    await expect(platforms).toBeVisible();

    const viewport = page.viewportSize();
    const box = await platforms.boundingBox();
    // Visible without scrolling: the hero deliberately clips its product band so
    // a visitor can see there is more than a headline.
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(viewport?.height ?? 0);
  });

  test("the product imagery actually loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (root) root.scrollTop = root.scrollHeight;
    }, SCROLL_ROOT);

    const images = page.locator("main img");
    const count = await images.count();
    expect(count, "the page shows no product imagery at all").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      await expect(image).toHaveJSProperty("complete", true);
      // A broken source still reports complete, so the decoded size is what
      // proves the file was really served.
      const natural = await image.evaluate((node: HTMLImageElement) => node.naturalWidth);
      expect(natural, `${await image.getAttribute("src")} did not decode`).toBeGreaterThan(0);
      await expect(image).toHaveAttribute("alt", /\S/);
    }
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`the ${scheme} theme uses its own screenshots`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value), scheme);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

      const sources = await page.locator("main img").evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).getAttribute("src") ?? ""),
      );
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source, `${source} is not the ${scheme} asset`).toContain(`-${scheme}.webp`);
      }
    });
  }

  test("platforms without a release offer nothing to press and claim no store", async ({ page }) => {
    await page.goto("/");

    for (const [platform, heading] of [["macos", "macOS"], ["ios", "iPhone и iPad"]] as const) {
      // Scoped by the section's own label id: filtering by a heading would also
      // match the wrapping section that contains every platform.
      const section = page.locator(`section[aria-labelledby="platform-${platform}"]`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole("heading", { name: heading })).toBeVisible();

      // The status line and the action both say it, so this is scoped to the
      // first rather than asserted as a single match.
      await expect(section.getByText("В разработке").first()).toBeVisible();
      await expect(section.locator('a[href*="/releases/files/"]')).toHaveCount(0);
      await expect(section.locator("a, button")).toHaveCount(0);

      const text = (await section.innerText()).toLowerCase();
      // "Готовим выпуск" is the status of a published platform between releases.
      // A platform with no catalog at all has no build and no schedule, so
      // saying it here would announce progress that does not exist.
      expect(text, `${heading} announces release progress it does not have`).not.toContain("готовим выпуск");
      for (const claim of STORE_CLAIMS) {
        expect(text, `${heading} makes a store availability claim`).not.toMatch(claim);
      }
    }
  });

  test("no store or vendor download link appears anywhere on the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The section-scoped check cannot see a link rendered outside it, and a
    // store link would not point at the catalog origin either.
    const hosts = await page.locator("main a[href]").evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLAnchorElement).href)
        .filter((href) => /^https?:/i.test(href))
        .map((href) => new URL(href).hostname),
    );

    // Internal links resolve against whatever base URL the run uses, so the
    // allowed set is derived rather than hardcoded to the local fixture host.
    const ownHost = new URL(page.url()).hostname;
    for (const host of hosts) {
      expect(
        [ownHost, "api.letscube.ru"],
        `${host} is an external destination this page must not offer`,
      ).toContain(host);
    }
  });

  test("released platforms link only at the validated catalog artifact", async ({ page }) => {
    await page.goto("/");

    // The catalog is fetched after paint, so the control only becomes a link
    // once a manifest has been parsed.
    const downloads = page.locator('main a[href^="https://api.letscube.ru/"]');
    await expect(downloads.first()).toBeVisible();

    const count = await downloads.count();
    expect(count, "no download is offered even though the catalog says available").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const href = await downloads.nth(index).getAttribute("href");
      expect(href).toMatch(/^https:\/\/api\.letscube\.ru\/releases\/files\//);
    }
  });

  test("the retired club positioning is absent", async ({ page }) => {
    await page.goto("/");
    // Without this the assertion would also pass on a blank page.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Приложения LETSCUBE" })).toBeVisible();
    await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (root) root.scrollTop = root.scrollHeight;
    }, SCROLL_ROOT);

    const text = await page.locator("body").innerText();
    for (const pattern of RETIRED_POSITIONING) {
      expect(text, `the page still carries ${pattern}`).not.toMatch(pattern);
    }
  });

  test("the changelog expands in place", async ({ page }) => {
    await page.goto("/");
    const expander = page.getByRole("button", { name: /^Ещё/ });
    await expect(expander).toBeVisible();

    const before = await page.getByRole("listitem").count();
    await expander.click();
    await expect(page.getByRole("button", { name: "Свернуть" })).toBeVisible();
    expect(await page.getByRole("listitem").count()).toBeGreaterThan(before);
    // No route was added for this.
    await expect(page).toHaveURL(/\/$/);
  });

  test("the primary actions are reachable and visible from the keyboard", async ({ page }, testInfo) => {
    // Not run on WebKit, and the reason is a platform default rather than
    // anything this page does. Safari moves Tab focus between form controls
    // only; links are skipped unless the person has turned on Full Keyboard
    // Access. Measured on both engines from the same page, eight presses each:
    //
    //   WebKit    BUTTON "Ещё 1" → BODY → BUTTON → BODY → …  (never an <a>)
    //   Chromium  A "Загрузка" → A "Конфиденциальность" → A "Войти"
    //             → A "Открыть веб-версию" → A "Все платформы"
    //
    // So focus is not trapped here — it moves, and it steps over the links.
    // The primary actions are links because they navigate, which is the right
    // element for them; making them buttons to satisfy a Tab order would be
    // changing the page's semantics to suit a test.
    //
    // What this contract still guarantees everywhere it runs: the actions are
    // reachable in order and each one is visible when it takes focus.
    test.skip(
      testInfo.project.name.startsWith("webkit"),
      "Safari skips links when tabbing unless Full Keyboard Access is on; measured, not assumed",
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The catalog resolves after paint and re-renders the hero actions. Tabbing
    // through a tree that is still changing loses focus, so settle first.
    await expect(page.getByRole("link", { name: /Открыть веб-версию/ }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    const reached: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return "";
        return (active.innerText || active.getAttribute("aria-label") || "").trim();
      });
      if (label) reached.push(label);
      if (reached.some((entry) => entry.includes("Открыть веб-версию"))) break;
    }

    expect(reached.join(" | "), "the web client action is not reachable by keyboard").toContain(
      "Открыть веб-версию",
    );

    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      return { outline: style.outlineStyle, shadow: style.boxShadow };
    });
    // Either a real outline or a ring shadow counts; an invisible focus does not.
    expect(
      outline?.outline !== "none" || (outline?.shadow ?? "none") !== "none",
      "the focused control shows no focus indicator",
    ).toBeTruthy();
  });

  test("the page renders with reduced motion requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Приложения LETSCUBE" })).toBeVisible();

    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("main *")].filter((node) => {
        const style = getComputedStyle(node);
        return style.animationName !== "none" && style.animationIterationCount === "infinite";
      }).length,
    );
    expect(animated, "an endless animation runs while reduced motion is requested").toBe(0);
  });
  test("an unavailable catalog offers nothing and says so everywhere", async ({ page }) => {
    await installCatalog(page, "unavailable");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Wait for the settled render. Every assertion below also holds while the
    // catalog is still being read, so without this the test would pass without
    // ever reaching the state it is named for.
    await expect(
      page.locator('section[aria-labelledby="platform-windows"]').getByText("Готовим выпуск"),
    ).toBeVisible();

    // The strongest availability sentence on the page is derived, so it must
    // not keep claiming a download the catalog no longer offers.
    const intro = await page.getByRole("heading", { name: "Приложения LETSCUBE" })
      .locator("xpath=following-sibling::p[1]")
      .innerText();
    expect(intro).not.toMatch(/доступны для загрузки/i);

    await expect(page.locator('main a[href^="https://api.letscube.ru/releases/files/"]')).toHaveCount(0);
    await expect(page.getByText("В разработке").first()).toBeVisible();
  });

  test("an unreachable catalog offers a retry that actually re-reads it", async ({ page }) => {
    await installCatalog(page, "unreachable");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const retry = page.getByRole("button", { name: "Повторить проверку" }).first();
    await expect(retry).toBeVisible();
    // The summary must report the catalog rather than invent a release
    // schedule, and it must name the platforms whose catalog actually failed.
    const summary = page.getByRole("heading", { name: "Приложения LETSCUBE" })
      .locator("xpath=following-sibling::p[1]");
    await expect(summary).toContainText("сейчас недоступен");
    await expect(summary).toContainText("Windows");
    await expect(summary).toContainText("Android");
    await expect(summary).not.toContainText("готовим к выпуску");
    await expect(page.locator('main a[href^="https://api.letscube.ru/releases/files/"]')).toHaveCount(0);

    // Serve the catalog before retrying: a control that does nothing would
    // leave the page in the same state forever.
    await page.unroute(CATALOG);
    await installCatalog(page, "available");
    await retry.click();

    await expect(page.locator('main a[href^="https://api.letscube.ru/releases/files/"]').first()).toBeVisible();
  });

  test("a cached catalog that can no longer be reached says so on the action", async ({ page }) => {
    // Staleness is what the client reports when an expired cache survives a
    // refresh that failed, so the cache is seeded expired rather than waiting
    // out the six-hour TTL. A fresh cache would be reused silently and would
    // never exercise the disclosure at all.
    await page.addInitScript((manifests) => {
      for (const [platform, value] of Object.entries(manifests)) {
        localStorage.setItem(
          `letscube:release-catalog:v1:${platform}:stable`,
          JSON.stringify({ manifest: value, fetchedAt: 0 }),
        );
      }
    }, { windows: manifest("windows", true), android: manifest("android", true) });

    await installCatalog(page, "unreachable");
    await page.goto("/");

    // The download still works from cache, and the page says where it came from.
    await expect(page.locator('main a[href^="https://api.letscube.ru/releases/files/"]').first()).toBeVisible();

    // Exactly once inside a section. It used to be printed both by the section
    // and by the action, and nothing objected. The hero renders its own action
    // and therefore its own disclosure, which is why this is scoped.
    for (const platform of ["windows", "android"]) {
      await expect(
        page.locator(`section[aria-labelledby="platform-${platform}"]`)
          .getByText("Показаны сохранённые данные каталога"),
      ).toHaveCount(1);
    }
  });
});
