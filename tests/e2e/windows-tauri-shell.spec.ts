import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";
import { startLocalFrontendServer } from "./helpers/local-frontend";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";
const WINDOWS_RELEASE = JSON.parse(
  readFileSync(path.resolve("windows-tauri/package.json"), "utf8"),
) as { version: string; desktopBuild: number };

test.describe("LETSCUBE Windows Tauri shell", () => {
  test.describe.configure({ mode: "serial" });

  test("keeps the approved startup scene and production navigation in one WebView", async ({}, testInfo) => {
    test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the native shell owns its viewport and runs once",
    );

    const cdpUrlValue = process.env.LETSCUBE_TAURI_CDP_URL;
    test.skip(!cdpUrlValue, "LETSCUBE_TAURI_CDP_URL is not configured");
    const browser = await connectToTauri(validateCdpUrl(cdpUrlValue ?? ""));
    try {
      const pages = browser.contexts().flatMap((context) => context.pages());
      expect(pages, "startup must expose exactly one native WebView page").toHaveLength(1);
      const page = pages[0];
      await page.waitForURL("http://tauri.localhost/startup.html");
      expect(page.url()).toBe("http://tauri.localhost/startup.html");
      await expect(page).toHaveTitle("LETSCUBE");
      await expect(page.getByTestId("startup-client-fingerprint")).toBeVisible();
      await expect(page.getByTestId("startup-server-fingerprint")).toBeVisible();

      const startupStages: string[] = [];
      await page.exposeFunction("__recordStartupStage", (stage: string | undefined) => {
        if (stage) startupStages.push(stage);
      });
      await page.evaluate(() => {
        const record = Reflect.get(window, "__recordStartupStage") as (stage?: string) => void;
        record(document.body.dataset.stage);
        new MutationObserver(() => record(document.body.dataset.stage)).observe(document.body, {
          attributes: true,
          attributeFilter: ["data-stage"],
        });
      });

      const geometry = await page.evaluate(() => {
        const seal = document
          .querySelector<HTMLElement>('[data-testid="startup-center-seal"]')!
          .getBoundingClientRect();
        const status = document
          .querySelector<HTMLElement>("#startup-status")!
          .getBoundingClientRect();
        const left = document.querySelector<HTMLElement>(".rail-left")!.getBoundingClientRect();
        const right = document.querySelector<HTMLElement>(".rail-right")!.getBoundingClientRect();
        const computer = document.querySelector<HTMLElement>(".computer")!.getBoundingClientRect();
        const server = document.querySelector<HTMLElement>(".server")!.getBoundingClientRect();
        const clientPort = document
          .querySelector<HTMLElement>('[data-testid="startup-client-port"]')!
          .getBoundingClientRect();
        const serverPort = document
          .querySelector<HTMLElement>('[data-testid="startup-server-port"]')!
          .getBoundingClientRect();
        const snapshot = (box: DOMRect) => ({
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        });
        return {
          statusBelowRail: status.top > seal.bottom,
          halvesCappedAtSeal: left.right <= seal.left + 0.5 && right.left >= seal.right - 0.5,
          railsMeetPorts:
            Math.abs(left.left - clientPort.right) <= 0.5 &&
            Math.abs(right.right - serverPort.left) <= 0.5,
          railsClearDevices: left.left >= computer.right && right.right <= server.left,
          portsClearDevices: clientPort.left >= computer.right && serverPort.right <= server.left,
          snapshot: {
            computer: snapshot(computer),
            server: snapshot(server),
            seal: snapshot(seal),
            clientPort: snapshot(clientPort),
            serverPort: snapshot(serverPort),
          },
        };
      });
      expect({
        statusBelowRail: geometry.statusBelowRail,
        halvesCappedAtSeal: geometry.halvesCappedAtSeal,
        railsMeetPorts: geometry.railsMeetPorts,
        railsClearDevices: geometry.railsClearDevices,
        portsClearDevices: geometry.portsClearDevices,
      }).toEqual({
        statusBelowRail: true,
        halvesCappedAtSeal: true,
        railsMeetPorts: true,
        railsClearDevices: true,
        portsClearDevices: true,
      });
      await page.screenshot({ path: testInfo.outputPath("tauri-approved-startup.png") });

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(async () => {
        await window.__TAURI_INTERNALS__?.invoke("begin_startup_qa");
      });

      await page.waitForURL((url) => url.origin === PRODUCTION_ORIGIN, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      expect(browser.contexts().flatMap((context) => context.pages())).toHaveLength(1);
      expect(new URL(page.url()).origin).toBe(PRODUCTION_ORIGIN);
      const productionOverlay = page.getByTestId("production-startup-overlay");
      await expect(productionOverlay).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => Reflect.get(window, "__letscubeStartupOverlayHistory")?.[0]),
        )
        .toEqual(
          expect.objectContaining({
            stage: "production_navigation",
            connected: false,
            statusText: "Подготавливаем рабочее пространство",
          }),
        );
      const overlayGeometry = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>(
          '[data-testid="production-startup-overlay"]',
        );
        const shadow = host?.shadowRoot;
        const endpoints = [
          ...(shadow?.querySelectorAll<HTMLElement>(".startup-overlay-endpoint") ?? []),
        ].map((element) => element.getBoundingClientRect());
        const computer = shadow
          ?.querySelector<HTMLElement>(".startup-overlay-computer")
          ?.getBoundingClientRect();
        const server = shadow
          ?.querySelector<HTMLElement>(".startup-overlay-server")
          ?.getBoundingClientRect();
        const clientPort = shadow
          ?.querySelector<HTMLElement>('[data-testid="production-startup-client-port"]')
          ?.getBoundingClientRect();
        const serverPort = shadow
          ?.querySelector<HTMLElement>('[data-testid="production-startup-server-port"]')
          ?.getBoundingClientRect();
        const rails = [
          ...(shadow?.querySelectorAll<HTMLElement>(".startup-overlay-rail") ?? []),
        ].map((element) => element.getBoundingClientRect());
        const seal = shadow
          ?.querySelector<HTMLElement>('[data-testid="production-startup-center-seal"]')
          ?.getBoundingClientRect();
        if (
          endpoints.length !== 2 ||
          rails.length !== 2 ||
          !computer ||
          !server ||
          !clientPort ||
          !serverPort ||
          !seal
        )
          throw new Error("production_overlay_geometry_missing");
        const center = (box: DOMRect) => box.left + box.width / 2;
        const snapshot = (box: DOMRect) => ({
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        });
        return {
          clientBeforeSeal: endpoints[0].right <= seal.left + 1,
          serverAfterSeal: endpoints[1].left >= seal.right - 1,
          symmetric:
            Math.abs(center(seal) - center(endpoints[0]) - (center(endpoints[1]) - center(seal))) <=
            2,
          endpointsAligned: Math.abs(endpoints[0].top - endpoints[1].top) <= 1,
          railsMeetPorts:
            Math.abs(rails[0].left - clientPort.right) <= 0.5 &&
            Math.abs(rails[1].right - serverPort.left) <= 0.5,
          railsClearDevices: rails[0].left >= computer.right && rails[1].right <= server.left,
          portsClearDevices: clientPort.left >= computer.right && serverPort.right <= server.left,
          snapshot: {
            computer: snapshot(computer),
            server: snapshot(server),
            seal: snapshot(seal),
            clientPort: snapshot(clientPort),
            serverPort: snapshot(serverPort),
          },
        };
      });
      expect({
        clientBeforeSeal: overlayGeometry.clientBeforeSeal,
        serverAfterSeal: overlayGeometry.serverAfterSeal,
        symmetric: overlayGeometry.symmetric,
        endpointsAligned: overlayGeometry.endpointsAligned,
        railsMeetPorts: overlayGeometry.railsMeetPorts,
        railsClearDevices: overlayGeometry.railsClearDevices,
        portsClearDevices: overlayGeometry.portsClearDevices,
      }).toEqual({
        clientBeforeSeal: true,
        serverAfterSeal: true,
        symmetric: true,
        endpointsAligned: true,
        railsMeetPorts: true,
        railsClearDevices: true,
        portsClearDevices: true,
      });
      expect(overlayGeometry.snapshot).toEqual(geometry.snapshot);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Reflect.get(window, "__letscubeStartupOverlayHistory") as Array<{
                stage: string;
                connected: boolean;
                sealConnected: boolean;
                statusText: string;
                fadeDuration: number;
                minimumVisibleDuration: number;
                successHoldDuration: number;
                removed?: boolean;
              }>,
          ),
        )
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              stage: "complete",
              connected: true,
              sealConnected: true,
              statusText: "Рабочее пространство готово",
              fadeDuration: expect.any(Number),
              minimumVisibleDuration: 2_200,
              successHoldDuration: 900,
            }),
          ]),
        );
      const connectedHistory = await page.evaluate(() =>
        (
          Reflect.get(window, "__letscubeStartupOverlayHistory") as Array<{
            connected: boolean;
            fadeDuration: number;
          }>
        ).find((entry) => entry.connected),
      );
      expect(connectedHistory?.fadeDuration).toBeLessThanOrEqual(20);
      await expect(productionOverlay).toBeVisible();
      await expect(productionOverlay.getByText("Рабочее пространство готово")).toBeVisible();
      const connectedGeometry = await page.evaluate(() => {
        const shadow = document.querySelector<HTMLElement>(
          '[data-testid="production-startup-overlay"]',
        )?.shadowRoot;
        const snapshot = (selector: string) => {
          const box = shadow?.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
          if (!box) throw new Error(`production_overlay_connected_geometry_missing:${selector}`);
          return { left: box.left, top: box.top, width: box.width, height: box.height };
        };
        return {
          computer: snapshot(".startup-overlay-computer"),
          server: snapshot(".startup-overlay-server"),
          seal: snapshot('[data-testid="production-startup-center-seal"]'),
          clientPort: snapshot('[data-testid="production-startup-client-port"]'),
          serverPort: snapshot('[data-testid="production-startup-server-port"]'),
        };
      });
      expect(connectedGeometry).toEqual(overlayGeometry.snapshot);
      await page.screenshot({ path: testInfo.outputPath("tauri-connected-hold.png") });
      await expect(productionOverlay).toHaveCount(0, { timeout: 3_000 });
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__letscubeStartupOverlayHistory")))
        .toEqual(expect.arrayContaining([expect.objectContaining({ removed: true })]));
      expect(startupStages).toEqual(
        expect.arrayContaining([
          "boot",
          "network_check",
          "tls_origin_check",
          "update_check",
          "production_navigation",
        ]),
      );

      await page.goto(`${PRODUCTION_ORIGIN}/register`, {
        waitUntil: "domcontentloaded",
      });
      const captcha = page.getByTestId("auth-captcha");
      await expect(captcha).toBeVisible();
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const container = document.querySelector(
                '[data-testid="auth-captcha"] [data-provider="yandex-smartcaptcha"]',
              );
              return {
                runtimeLoaded: typeof window.smartCaptcha?.render === "function",
                widgetChildren: container?.childElementCount ?? 0,
              };
            }),
          { timeout: 25_000 },
        )
        .toEqual({ runtimeLoaded: true, widgetChildren: expect.any(Number) });
      expect(
        await captcha
          .locator('[data-provider="yandex-smartcaptcha"]')
          .evaluate((element) => element.childElementCount),
      ).toBeGreaterThan(0);
      await expect(captcha.getByText(/Не удалось загрузить проверку защиты/)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("tauri-registration-captcha.png") });
      await page.goto(`${PRODUCTION_ORIGIN}/login`, { waitUntil: "domcontentloaded" });
    } finally {
      await browser.close();
    }
  });

  test("loads the production app with desktop capabilities and authenticated core UI", async ({}, testInfo) => {
    test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the native shell owns its viewport and runs once",
    );

    const cdpUrlValue = process.env.LETSCUBE_TAURI_CDP_URL;
    test.skip(!cdpUrlValue, "LETSCUBE_TAURI_CDP_URL is not configured");
    const cdpUrl = validateCdpUrl(cdpUrlValue ?? "");
    const credentials = loadQaCredentials("owner") ?? loadQaCredentials("default");
    test.skip(!credentials, "Owner/default QA credentials are not configured");

    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => new URL(candidate.url()).origin === PRODUCTION_ORIGIN);
      expect(page, "the production WebView target should be available").toBeDefined();
      if (!page) return;

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveTitle("LETSCUBE");
      await expect(page.getByTestId("production-startup-overlay")).toHaveCount(0);
      await expect(page.locator('input[type="password"]')).toHaveCount(1);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            platform: window.letscubeDesktop?.platform,
            version: window.letscubeDesktop?.version,
            build: window.letscubeDesktop?.build,
            updater: [
              window.letscubeDesktop?.getUpdateState,
              window.letscubeDesktop?.getUpdateChannel,
              window.letscubeDesktop?.setUpdateChannel,
              window.letscubeDesktop?.checkUpdate,
              window.letscubeDesktop?.installUpdate,
            ].every((method) => typeof method === "function"),
          })),
        )
        .toEqual({
          platform: "windows",
          version: WINDOWS_RELEASE.version,
          build: WINDOWS_RELEASE.desktopBuild,
          updater: true,
        });
      await expect
        .poll(() =>
          page.evaluate(() => ({
            mediaDevices: typeof navigator.mediaDevices?.getUserMedia === "function",
            mediaRecorder: typeof window.MediaRecorder === "function",
            geolocation: "geolocation" in navigator,
            clipboard: typeof navigator.clipboard?.writeText === "function",
            fullscreen: typeof document.documentElement.requestFullscreen === "function",
          })),
        )
        .toEqual({
          mediaDevices: true,
          mediaRecorder: true,
          geolocation: true,
          clipboard: true,
          fullscreen: true,
        });

      await page.locator('input[type="email"]').fill(credentials.email);
      await page.locator('input[type="password"]').fill(credentials.password);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
      await expect(
        page.locator('[data-testid="app-top-bar"], [data-testid="sidebar-brand-strip"]'),
      ).toBeVisible();
      await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
      await expect(page.getByText("Установить LETSCUBE", { exact: true })).toHaveCount(0);

      const composer = page.locator("textarea").first();
      const chatRows = page.getByTestId("chat-list-item");
      await expect(chatRows.first(), "the chat list should hydrate after login").toBeVisible({
        timeout: 20_000,
      });
      const chatCount = Math.min(await chatRows.count(), 10);
      for (let index = 0; index < chatCount; index += 1) {
        if (await composer.isVisible().catch(() => false)) break;
        await chatRows.nth(index).click({ force: true });
        await page.waitForTimeout(400);
      }
      await expect(composer, "an available chat should expose the composer").toBeVisible();

      await page.getByRole("button", { name: "Прикрепить" }).click();
      await expect(page.getByRole("button", { name: "Фото или видео" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Сделать фото" })).toBeVisible();
      await expect(
        page
          .locator("button")
          .filter({ hasText: /^Голосовое$/ })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Записать видео" })).toBeVisible();
      await expect(page.getByTestId("media-quality-selector")).toHaveCount(0);
      await page.locator("div.fixed.inset-0.z-10").click({ position: { x: 12, y: 200 } });

      await page.getByTestId("notification-bell-button").click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Меню" }).click();
      await page.getByRole("button", { name: "Настройки" }).click();
      await expect(page.getByText("Системные уведомления, пока приложение запущено")).toBeVisible();
      await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("tauri-authenticated-shell.png") });

      expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("renders local Windows update controls without changing browser distribution", async ({
    page,
  }, testInfo) => {
    test.skip(process.platform !== "win32", "Windows desktop UI QA is Windows-only");
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "the Windows desktop UI scenario owns one viewport",
    );
    const credentials = loadQaCredentials("owner") ?? loadQaCredentials("default");
    test.skip(!credentials, "Owner/default QA credentials are not configured");

    const localFrontend = await startLocalFrontendServer();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("letscube:desktop:last-installed-version", "0.1.9");
      const updateCalls: string[] = [];
      let updateState = {
        channel: "stable",
        phase: "current",
        installedVersion: "0.2.0",
        availableVersion: null,
        downloadedBytes: 0,
        totalBytes: null,
        mandatory: false,
        errorCode: null,
      };
      const runtimeInfo = Object.freeze({
        platform: "windows" as const,
        version: "0.2.0",
        build: 4,
      });
      const bridge = Object.freeze({
        platform: "windows" as const,
        version: runtimeInfo.version,
        build: runtimeInfo.build,
        getRuntimeInfo: async () => runtimeInfo,
        getUpdateState: async () => ({ ...updateState }),
        getUpdateChannel: async () => updateState.channel,
        setUpdateChannel: async (channel: "stable" | "test") => {
          updateCalls.push(`set:${channel}`);
          updateState = {
            ...updateState,
            channel,
            phase: "idle",
            availableVersion: null,
            downloadedBytes: 0,
            totalBytes: null,
            mandatory: false,
            errorCode: null,
          };
          return { ...updateState };
        },
        checkUpdate: async () => {
          updateCalls.push("check");
          updateState = { ...updateState, phase: "current" };
          return { ...updateState };
        },
        installUpdate: async () => {
          updateCalls.push("install");
          return { ...updateState };
        },
      });
      Object.defineProperty(window, "letscubeDesktop", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: bridge,
      });
      Reflect.set(window, "__setQaDesktopUpdateState", (next: typeof updateState) => {
        updateState = { ...next };
      });
      Reflect.set(window, "__getQaDesktopUpdateCalls", () => [...updateCalls]);
      Reflect.set(window, "__getQaDesktopUpdateState", () => ({ ...updateState }));
      Reflect.set(window, "__clearQaDesktopUpdateCalls", () => {
        updateCalls.length = 0;
      });
    });

    try {
      await page.goto(localFrontend.url, { waitUntil: "domcontentloaded" });
      await page.locator('input[type="email"]').fill(credentials!.email);
      await page.locator('input[type="password"]').fill(credentials!.password);
      await page.locator('button[type="submit"]').click();
      await expect(page.getByTestId("app-top-bar")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("desktop-window-controls")).toBeVisible();

      const selectedChatRows = page.getByTestId("chat-list-item");
      await expect(
        selectedChatRows.first(),
        "a chat is required for the Escape state guard",
      ).toBeVisible({
        timeout: 20_000,
      });
      await selectedChatRows.first().click();
      const selectedChatComposer = page.locator("textarea").first();
      await expect(selectedChatComposer).toBeVisible();

      const pill = page.getByTestId("desktop-update-pill");
      await expect(pill).toBeVisible();
      await expect(pill).toHaveAttribute("data-update-success", "true");
      await expect(pill.getByText("Обновление установлено")).toBeVisible();
      const pillBox = await pill.boundingBox();
      expect(pillBox).toBeTruthy();
      expect(pillBox!.width).toBeLessThanOrEqual(240);
      expect(pillBox!.height).toBeLessThanOrEqual(56);
      const windowControlsBox = await page.getByTestId("desktop-window-controls").boundingBox();
      expect(windowControlsBox).toBeTruthy();
      expect(pillBox!.y).toBeGreaterThanOrEqual(windowControlsBox!.y + windowControlsBox!.height);
      await page.screenshot({ path: testInfo.outputPath("desktop-update-success.png") });
      await expect(pill).toHaveCount(0, { timeout: 7_000 });

      await page.evaluate(() => {
        const setState = Reflect.get(window, "__setQaDesktopUpdateState") as (
          value: unknown,
        ) => void;
        setState({
          channel: "stable",
          phase: "available",
          installedVersion: "0.2.0",
          availableVersion: "0.2.1",
          downloadedBytes: 0,
          totalBytes: 1_200_000,
          mandatory: false,
          errorCode: null,
        });
        window.dispatchEvent(new Event("focus"));
      });
      await expect(pill).toHaveAttribute("data-phase", "available");
      await expect
        .poll(() => pill.evaluate((element) => getComputedStyle(element).opacity))
        .toBe("1");
      const availablePillBox = await pill.boundingBox();
      expect(availablePillBox).toBeTruthy();
      expect(availablePillBox!.width).toBeLessThanOrEqual(300);
      expect(availablePillBox!.height).toBeLessThanOrEqual(80);
      await page.evaluate(() => Reflect.get(window, "__clearQaDesktopUpdateCalls")());
      await page.screenshot({ path: testInfo.outputPath("desktop-update-pill.png") });

      await page.evaluate(() => {
        const setState = Reflect.get(window, "__setQaDesktopUpdateState") as (
          value: unknown,
        ) => void;
        setState({
          channel: "stable",
          phase: "downloading",
          installedVersion: "0.2.0",
          availableVersion: "0.2.1",
          downloadedBytes: 300_000,
          totalBytes: 1_200_000,
          mandatory: false,
          errorCode: null,
        });
        window.dispatchEvent(new Event("focus"));
      });
      const progress = pill.getByRole("progressbar");
      await expect(progress).toHaveAttribute("aria-valuemin", "0");
      await expect(progress).toHaveAttribute("aria-valuemax", "100");
      await expect(progress).toHaveAttribute("aria-valuenow", "25");

      await page.evaluate(() => {
        const setState = Reflect.get(window, "__setQaDesktopUpdateState") as (
          value: unknown,
        ) => void;
        setState({
          channel: "stable",
          phase: "available",
          installedVersion: "0.2.0",
          availableVersion: "0.2.1",
          downloadedBytes: 0,
          totalBytes: 1_200_000,
          mandatory: false,
          errorCode: null,
        });
        window.dispatchEvent(new Event("focus"));
      });
      await expect(pill).toHaveAttribute("data-phase", "available");

      await page.getByRole("button", { name: "Меню" }).click();
      await page.getByRole("button", { name: "Настройки" }).click();
      await page.getByTestId("settings-open-application").click();
      await expect(page.getByTestId("desktop-update-settings")).toBeVisible();
      await expect(page.getByTestId("release-download-button")).toHaveCount(0);
      const channelControl = page.getByTestId("desktop-update-channel-control");
      await expect(channelControl).toHaveAttribute("role", "radiogroup");
      const stableChannel = channelControl.getByRole("radio", { name: "Stable" });
      const testChannel = channelControl.getByRole("radio", { name: "Test" });
      await expect(stableChannel).toHaveAttribute("aria-checked", "true");
      await stableChannel.focus();
      await page.keyboard.press("ArrowRight");
      await expect(testChannel).toBeFocused();
      const confirmation = page.getByTestId("desktop-test-channel-confirmation");
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByText(/могут быть нестабильными/i)).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__getQaDesktopUpdateCalls")()))
        .toEqual([]);
      await page.keyboard.press("ArrowLeft");
      await expect(stableChannel).toBeFocused();
      await expect(confirmation).toHaveCount(0);
      await expect(stableChannel).toHaveAttribute("aria-checked", "true");
      await expect(testChannel).toHaveAttribute("aria-checked", "false");
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__getQaDesktopUpdateCalls")()))
        .toEqual([]);
      await page.keyboard.press("ArrowRight");
      await expect(testChannel).toBeFocused();
      await expect(confirmation).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("desktop-update-settings.png") });
      await confirmation.getByRole("button", { name: "Перейти" }).click();
      await expect(confirmation).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__getQaDesktopUpdateCalls")()))
        .toEqual(["set:test", "check"]);
      await expect(testChannel).toHaveAttribute("aria-checked", "true");
      await expect(pill).toHaveAttribute("data-channel", "test");
      await stableChannel.click();
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__getQaDesktopUpdateCalls")()))
        .toEqual(["set:test", "check", "set:stable", "check"]);
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, "__getQaDesktopUpdateState")()))
        .toMatchObject({ channel: "stable", phase: "current", mandatory: false });
      await expect(stableChannel).toHaveAttribute("aria-checked", "true");
      await expect(testChannel).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");

      const notificationButton = page.getByTestId("notification-bell-button");
      await notificationButton.focus();
      await expect(notificationButton).toBeFocused();

      await page.evaluate(() => {
        const setState = Reflect.get(window, "__setQaDesktopUpdateState") as (
          value: unknown,
        ) => void;
        setState({
          channel: "stable",
          phase: "critical_update_required",
          installedVersion: "0.2.0",
          availableVersion: "0.3.0",
          downloadedBytes: 0,
          totalBytes: null,
          mandatory: true,
          errorCode: null,
        });
        window.dispatchEvent(new Event("focus"));
      });
      await expect(page.getByTestId("desktop-critical-update-gate")).toBeVisible();
      const appShell = page.getByTestId("desktop-app-shell");
      await expect(appShell).toHaveAttribute("inert", "");
      await expect(appShell).toHaveAttribute("aria-hidden", "true");
      const criticalInstall = page.getByTestId("desktop-critical-update-install");
      await expect(criticalInstall).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(criticalInstall).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(criticalInstall).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(selectedChatComposer).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("desktop-critical-update-gate.png") });

      await page.evaluate(() => {
        const setState = Reflect.get(window, "__setQaDesktopUpdateState") as (
          value: unknown,
        ) => void;
        setState({
          channel: "stable",
          phase: "current",
          installedVersion: "0.3.0",
          availableVersion: null,
          downloadedBytes: 0,
          totalBytes: null,
          mandatory: false,
          errorCode: null,
        });
        window.dispatchEvent(new Event("focus"));
      });
      await expect(page.getByTestId("desktop-critical-update-gate")).toHaveCount(0);
      await expect(appShell).not.toHaveAttribute("inert", "");
      await expect(appShell).not.toHaveAttribute("aria-hidden", "true");
      await expect(notificationButton).toBeFocused();
      await expect(selectedChatComposer).toBeVisible();
      expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
    } finally {
      await localFrontend.close();
    }
  });
});

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
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out connecting to the loopback Tauri CDP endpoint: ${String(lastError)}`);
}
