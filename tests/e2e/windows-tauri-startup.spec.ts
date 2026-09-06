import { type Browser, chromium, expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";
import { startLocalFrontendServer } from "./helpers/local-frontend";

/**
 * The one origin the shell is allowed to hand over to, and the only thing this
 * scenario asks of it: that the handover happens and the deployment mounts.
 *
 * What it deliberately does NOT ask of it is whether the interface honours a
 * contract. Production serves the last deployment, not this checkout, so an
 * assertion made here answers a question about someone else's build. That is
 * `assertBuiltInterfaceHonoursNativeState`'s job, and it runs against
 * `artifacts/kub/dist/public`.
 */
const PRODUCTION_ORIGIN = "https://app.letscube.ru";
const QA_MODES = new Set([
  "success",
  "offline",
  "catalog_failure",
  "normal_update",
  "critical_update",
]);
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 960, height: 640 },
] as const;

test("covers the injected Windows startup and updater lifecycle", async ({ browser }, testInfo) => {
  test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
  test.skip(
    testInfo.project.name !== "chromium-desktop-1440",
    "the native shell owns its viewport and runs once",
  );

  // Two journeys in one scenario: the native shell's whole startup up to the
  // production handover, which alone is allowed 35s, and then a sign-in against
  // the locally built bundle. The 45s default was already being spent to the
  // last second by the first of those before the second existed.
  test.setTimeout(150_000);

  const mode = process.env.LETSCUBE_TAURI_QA_STARTUP_MODE ?? "";
  expect(QA_MODES.has(mode), "wrapper must provide a bounded startup QA mode").toBe(true);
  const cdpUrl = validateCdpUrl(process.env.LETSCUBE_TAURI_CDP_URL ?? "");
  const shell = await connectToTauri(cdpUrl);

  try {
    const pages = shell.contexts().flatMap((context) => context.pages());
    expect(pages, "each scenario must expose exactly one native WebView").toHaveLength(1);
    const page = pages[0];
    await page.waitForURL("http://tauri.localhost/startup.html");
    await expect(page).toHaveTitle("LETSCUBE");
    await expect(page.getByTestId("startup-titlebar")).toBeVisible();
    await expect(page.getByTestId("startup-window-minimize")).toBeVisible();
    await expect(page.getByTestId("startup-window-maximize")).toBeVisible();
    await expect(page.getByTestId("startup-window-close")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const geometry = await measureStartupGeometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`startup-${mode}-${viewport.width}x${viewport.height}.png`),
      });
      expect(geometry, `startup geometry at ${viewport.width}x${viewport.height}`).toEqual({
        horizontalOverflow: false,
        statusBelowRail: true,
        halvesStopAtCenter: true,
        halvesSymmetric: true,
        endpointClearance: true,
        fingerprintClearance: true,
        fingerprintStylesMatch: true,
        statusClearance: true,
        endpointTextClearance: true,
        fingerprintLineClearance: true,
        statusStageLabelClearance: true,
        retryLabelClearance: true,
        textPairwiseClear: true,
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const stages: string[] = [];
    await page.exposeFunction("__recordLifecycleStage", (stage: string | undefined) => {
      if (stage) stages.push(stage);
    });
    await page.evaluate(() => {
      const record = Reflect.get(window, "__recordLifecycleStage") as (stage?: string) => void;
      record(document.body.dataset.stage);
      new MutationObserver(() => record(document.body.dataset.stage)).observe(document.body, {
        attributes: true,
        attributeFilter: ["data-stage"],
      });
    });

    await page.evaluate(async () => {
      await window.__TAURI_INTERNALS__?.invoke("begin_startup_qa");
    });

    if (mode === "offline") {
      await expect(page.locator("body")).toHaveAttribute("data-stage", "recoverable_error");
      await expect(page.getByText("Сервер LETSCUBE недоступен")).toBeVisible();
      const retry = page.getByRole("button", { name: "Повторить" });
      await expect(retry).toBeVisible();
      await expect(retry).toHaveText("Повторить");
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expect(measureStartupGeometry(page)).resolves.toMatchObject({
          endpointTextClearance: true,
          fingerprintLineClearance: true,
          statusStageLabelClearance: true,
          retryLabelClearance: true,
        });
        await page.screenshot({
          path: testInfo.outputPath(`startup-offline-retry-${viewport.width}x${viewport.height}.png`),
        });
      }
      await retry.click();
    }

    await page.waitForURL(
      (url) => url.origin === PRODUCTION_ORIGIN,
      { timeout: 35_000, waitUntil: "domcontentloaded" },
    );
    expect(new URL(page.url()).origin).toBe(PRODUCTION_ORIGIN);
    expect(shell.contexts().flatMap((context) => context.pages())).toHaveLength(1);
    await expect(page).toHaveTitle("LETSCUBE");
    const applicationRoot = page.locator("#root");
    await expect(applicationRoot).toHaveAttribute("data-kub-boot-id", /.+/, { timeout: 20_000 });
    await expect
      .poll(() => applicationRoot.evaluate((node) => node.childElementCount), {
        message: "production handoff must mount the LETSCUBE application instead of leaving a blank WebView",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.letscubeDesktop?.getUpdateState()), {
        timeout: 10_000,
      })
      .toMatchObject(expectedUpdateState(mode));

    if (mode === "offline") {
      expect(stages).toEqual(expect.arrayContaining(["recoverable_error", "network_check"]));
    } else {
      expect(stages).toEqual(
        expect.arrayContaining([
          "network_check",
          "tls_origin_check",
          "update_check",
          "production_navigation",
        ]),
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`production-handoff-${mode}.png`) });

    // Read back what the shell itself reports rather than re-deriving it, so the
    // pair under test is "what this native build produced" against "the
    // interface this checkout builds" — not two independent guesses.
    const nativeBridge = await page.evaluate(async () => ({
      state: await window.letscubeDesktop?.getUpdateState(),
      version: window.letscubeDesktop?.version,
      build: window.letscubeDesktop?.build,
    }));
    await assertBuiltInterfaceHonoursNativeState(browser, nativeBridge, mode, testInfo);
  } finally {
    await shell.close();
  }
});

function expectedUpdateState(mode: string) {
  switch (mode) {
    case "success":
      return { channel: "stable", phase: "current", mandatory: false };
    case "catalog_failure":
      return {
        channel: "stable",
        phase: "failed",
        mandatory: false,
        errorCode: "update_check_failed",
      };
    case "normal_update":
      return {
        channel: "stable",
        phase: "available",
        availableVersion: "0.2.1",
        mandatory: false,
      };
    case "critical_update":
      return {
        channel: "stable",
        phase: "critical_update_required",
        availableVersion: "0.3.0",
        mandatory: true,
      };
    default:
      return { channel: "stable", phase: "idle", mandatory: false };
  }
}

/**
 * The update interface, measured on the bundle this checkout builds.
 *
 * This used to run against `https://app.letscube.ru` inside the native WebView,
 * and that made it a test of the last deployment rather than of the working
 * tree. Measured, not suspected: removing `inert` from `desktop-app-shell` in
 * `MainLayout.tsx` and rebuilding left `critical_update` green while the
 * SHA-256 of the source and of the built bundle had both changed. The mutation
 * had really been applied; the gate was simply looking somewhere else.
 *
 * So the origin moves and the *state* does not. `state` is the snapshot the
 * native shell just produced from its injected fixture, read back out of the
 * running shell, and it is served to the built bundle through the same bridge
 * shape the shell installs. What is proven is the join the release cares about:
 * given the state this native build reports, the interface this checkout builds
 * gates the shell.
 *
 * The shell keeps everything only it can answer — the handover to the real
 * production origin, one WebView, the mounted deployment, the stage sequence
 * and the bridge's own reported state.
 */
async function assertBuiltInterfaceHonoursNativeState(
  browser: Browser,
  native: { state: unknown; version?: string; build?: number },
  mode: string,
  testInfo: import("@playwright/test").TestInfo,
) {
  if (mode !== "normal_update" && mode !== "critical_update") return;

  // Credentials rather than `loginAsRoleOrSkip`: that helper persists whatever
  // it signed in as back into `output/playwright-auth/<role>.json`, and this
  // page's origin is a loopback port that changes every run — so it would
  // replace the production session every other spec restores with a localhost
  // one that can never be used again.
  const credentials =
    loadQaCredentials("owner") ??
    loadQaCredentials("tech_admin") ??
    loadQaCredentials("location_admin") ??
    loadQaCredentials("default");
  expect(
    credentials,
    "the update interface scenario requires QA credentials; a saved auth state is bound to another origin",
  ).not.toBeNull();
  if (!credentials) throw new Error("native_updater_ui_auth_missing");

  const snapshot = native.state as { phase?: string; mandatory?: boolean };
  expect(
    typeof snapshot?.phase,
    "the native shell must report a state before the built interface can be asked to honour it",
  ).toBe("string");
  expect(
    typeof native.version === "string" && typeof native.build === "number",
    "the built interface is served the shell's own runtime identity, not an invented one",
  ).toBe(true);

  const localFrontend = await startLocalFrontendServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.addInitScript(
      ({ update, version, build }) => {
        // Equal to the installed version, so the "update installed" pill of a
        // previous run cannot sit on top of the state under test.
        localStorage.setItem("letscube:desktop:last-installed-version", version);
        const runtimeInfo = Object.freeze({ platform: "windows" as const, version, build });
        const unsupported = async () => {
          throw new Error("not_available_in_interface_qa");
        };
        Object.defineProperty(window, "letscubeDesktop", {
          configurable: false,
          enumerable: false,
          writable: false,
          value: Object.freeze({
            platform: "windows" as const,
            version,
            build,
            getRuntimeInfo: async () => runtimeInfo,
            getUpdateState: async () => update,
            getUpdateChannel: async () => (update as { channel?: string }).channel ?? "stable",
            setUpdateChannel: unsupported,
            checkUpdate: async () => update,
            installUpdate: unsupported,
          }),
        });
      },
      {
        update: native.state,
        version: native.version ?? "0.0.0",
        build: native.build ?? 0,
      },
    );

    await page.goto(`${localFrontend.url}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(credentials.email);
    await page.locator('input[type="password"]').fill(credentials.password);
    await page.locator('button[type="submit"]').click();
    // `desktop-app-shell` rather than a role query: the critical gate puts
    // `inert` and `aria-hidden` on the shell, which removes the menu button from
    // the accessibility tree while leaving it drawn — that is how the 0.2.13 run
    // called a signed-in client signed out.
    await expect(page.getByTestId("desktop-app-shell")).toBeAttached({ timeout: 25_000 });
    await expect(
      page.locator('[data-testid="app-top-bar"], [data-testid="sidebar-brand-strip"]'),
    ).toBeVisible({ timeout: 20_000 });
    const appTopBar = page.getByTestId("app-top-bar");
    if (await appTopBar.isVisible().catch(() => false)) {
      await expect(page.getByTestId("desktop-window-controls")).toBeVisible();
    }

    if (mode === "normal_update") {
      expect(snapshot.mandatory, "normal_update must not report a mandatory update").toBe(false);
      const pill = page.getByTestId("desktop-update-pill");
      await expect(pill).toHaveAttribute("data-phase", "available");
      const pillBox = await pill.boundingBox();
      expect(pillBox, "the normal-update pill must have a stable compact box").toBeTruthy();
      expect(pillBox!.width).toBeLessThanOrEqual(300);
      expect(pillBox!.height).toBeLessThanOrEqual(80);
      await expect(page.getByTestId("desktop-app-shell")).not.toHaveAttribute("inert", "");
      await page.screenshot({ path: testInfo.outputPath("built-normal-update-pill.png") });
      return;
    }

    expect(snapshot.mandatory, "critical_update must report a mandatory update").toBe(true);
    await expect(page.getByTestId("desktop-critical-update-gate")).toBeVisible();
    const appShell = page.getByTestId("desktop-app-shell");
    await expect(appShell).toHaveAttribute("inert", "");
    await expect(appShell).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("desktop-critical-update-install")).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("built-critical-update-gate.png") });
  } finally {
    await context.close();
    await localFrontend.close();
  }
}

async function measureStartupGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const boxes = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => element.getBoundingClientRect());
    const leftRail = box(".rail-left");
    const rightRail = box(".rail-right");
    const seal = box('[data-testid="startup-center-seal"]');
    const status = box("#startup-status");
    const stages = box(".stages");
    const stageLabels = boxes(".stages li");
    const versionPill = box(".version-pill");
    const client = box(".endpoint-client");
    const server = box(".endpoint-server");
    const clientFingerprint = box('[data-testid="startup-client-fingerprint"]');
    const serverFingerprint = box('[data-testid="startup-server-fingerprint"]');
    const computer = box(".computer");
    const serverRack = box(".server");
    const clientHeading = box(".endpoint-client h2");
    const clientSubtitle = box(".endpoint-client p");
    const serverHeading = box(".endpoint-server h2");
    const serverSubtitle = box(".endpoint-server p");
    const clientFingerprintLines = boxes(
      '[data-testid="startup-client-fingerprint"] [data-fingerprint-value] span',
    );
    const serverFingerprintLines = boxes(
      '[data-testid="startup-server-fingerprint"] [data-fingerprint-value] span',
    );
    const retry = box("#startup-retry");
    const failureText = box("#startup-error");
    if (
      !leftRail ||
      !rightRail ||
      !seal ||
      !status ||
      !stages ||
      !versionPill ||
      !client ||
      !server ||
      !clientFingerprint ||
      !serverFingerprint ||
      !computer ||
      !serverRack ||
      !clientHeading ||
      !clientSubtitle ||
      !serverHeading ||
      !serverSubtitle ||
      stageLabels.length !== 4
    ) {
      throw new Error("startup_geometry_missing");
    }
    // A fingerprint is written from the snapshot, never from the markup, so a
    // side carries exactly one of three counts: none, when the shell sent no
    // certificate and the block holds a note instead of digits; one, the short
    // prefix shown while nothing needs comparing; or four, the whole SHA-256 as
    // eight bytes a line, which only the changed-pin state asks for. Any other
    // count means a partial value reached the screen.
    if (
      ![0, 1, 4].includes(clientFingerprintLines.length) ||
      ![0, 1, 4].includes(serverFingerprintLines.length)
    ) {
      throw new Error(
        `startup_fingerprint_line_count:${clientFingerprintLines.length}/${serverFingerprintLines.length}`,
      );
    }
    const clientStyles = [...document.querySelectorAll<HTMLElement>(
      '[data-testid="startup-client-fingerprint"] [data-fingerprint-value] span',
    )].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.opacity];
    });
    const serverStyles = [...document.querySelectorAll<HTMLElement>(
      '[data-testid="startup-server-fingerprint"] [data-fingerprint-value] span',
    )].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.opacity];
    });
    const overlaps = (first: DOMRect, second: DOMRect) =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top;
    const visible = (entry: DOMRect | null): entry is DOMRect =>
      Boolean(entry && entry.width > 0 && entry.height > 0);
    const pairwiseClear = (entries: Array<DOMRect | null>) => {
      const visibleEntries = entries.filter(visible);
      return visibleEntries.every((entry, index) =>
        visibleEntries.slice(index + 1).every((other) => !overlaps(entry, other)));
    };
    const textEntries = [
      ...clientFingerprintLines,
      clientHeading,
      clientSubtitle,
      ...serverFingerprintLines,
      serverHeading,
      serverSubtitle,
      status,
      ...stageLabels,
      retry,
      failureText,
    ];
    const endpointTextEntries = [
      ...clientFingerprintLines,
      clientHeading,
      clientSubtitle,
      ...serverFingerprintLines,
      serverHeading,
      serverSubtitle,
    ];

    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      statusBelowRail: status.top > seal.bottom,
      halvesStopAtCenter: leftRail.right <= seal.left + 0.5 && rightRail.left >= seal.right - 0.5,
      halvesSymmetric:
        Math.abs((seal.left - leftRail.right) - (rightRail.left - seal.right)) <= 1,
      endpointClearance: !overlaps(computer, seal) && !overlaps(serverRack, seal),
      fingerprintClearance:
        clientFingerprint.bottom <= computer.top && serverFingerprint.bottom <= serverRack.top,
      fingerprintStylesMatch:
        JSON.stringify(clientStyles) === JSON.stringify(serverStyles),
      statusClearance:
        !overlaps(status, stages) &&
        !overlaps(status, versionPill) &&
        !overlaps(status, computer) &&
        !overlaps(status, serverRack),
      endpointTextClearance:
        pairwiseClear(endpointTextEntries) &&
        !overlaps(clientHeading, computer) &&
        !overlaps(clientSubtitle, computer) &&
        !overlaps(serverHeading, serverRack) &&
        !overlaps(serverSubtitle, serverRack),
      fingerprintLineClearance:
        pairwiseClear([...clientFingerprintLines, ...serverFingerprintLines]) &&
        clientFingerprintLines.every((line) => !overlaps(line, computer)) &&
        serverFingerprintLines.every((line) => !overlaps(line, serverRack)),
      statusStageLabelClearance:
        pairwiseClear([status, ...stageLabels]) &&
        stageLabels.every((label) => !overlaps(label, versionPill)),
      retryLabelClearance:
        !visible(retry) ||
        pairwiseClear([retry, failureText, status, ...stageLabels, ...endpointTextEntries]),
      textPairwiseClear: pairwiseClear(textEntries),
    };
  });
}

function validateCdpUrl(value: string) {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error("LETSCUBE_TAURI_CDP_URL must be an uncredentialed loopback HTTP origin.");
  }
  return url.origin;
}

async function connectToTauri(cdpUrl: string) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}
