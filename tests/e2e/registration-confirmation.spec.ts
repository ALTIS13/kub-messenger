import { expect, type Page, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

const confirmationVisualProjects = new Set([
  "chromium-desktop-1440",
  "chromium-desktop-1920",
  "chromium-mobile-412",
  "chromium-mobile-390",
  // The narrowest phone in the matrix since 2026-09-06. A countdown control
  // that has to stay reachable and unclipped is exactly the shape of thing the
  // 360-wide blind spot was hiding.
  "chromium-mobile-360",
]);

test.describe("Registration confirmation", () => {
  test("shows the approved confirmation copy with a disabled resend control", async ({
    page,
  }, testInfo) => {
    test.skip(
      !confirmationVisualProjects.has(testInfo.project.name),
      "confirmation coverage runs at required viewports",
    );
    const consoleErrors = collectConsoleErrors(page);
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await gotoOrSkip(page, "/register");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByRole("heading", { name: "Проверьте почту", level: 1 })).toBeVisible();
    await expect(
      page.getByText(
        "Если к этому адресу электронной почты ещё не привязан аккаунт, мы отправим письмо для подтверждения регистрации.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Если письмо не пришло, проверьте папку «Спам» и правильность указанного адреса. При ошибке вернитесь и зарегистрируйтесь с корректным email.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Неподтверждённая учётная запись будет удалена автоматически."),
    ).toBeVisible();
    await expect(page.getByText("n***r@example.test")).toBeVisible();
    await expect(page.getByText(/Восстановить пароль|Восстановить доступ/)).toHaveCount(0);

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    await expect(page.getByTestId("auth-captcha")).toBeVisible();
    await expect(
      page.getByText("Подтверждение защиты станет доступно после окончания таймера."),
    ).toBeVisible();

    if (testInfo.project.name === "chromium-mobile-390") {
      const countdownMetrics = await resend.evaluate((element) => ({
        clientHeight: element.clientHeight,
        height: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
      }));
      expect(countdownMetrics.height).toBeGreaterThanOrEqual(64);
      expect(countdownMetrics.scrollHeight).toBeLessThanOrEqual(countdownMetrics.clientHeight);
    }

    await expect(resend).toBeInViewport();
    const authShell = page.locator(".kub-auth-shell");
    await authShell.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => authShell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(authShell).toContainText("Ко входу");
    await expect(authShell).toContainText("Указать другой email");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth + 1),
    );

    await page.screenshot({
      path: testInfo.outputPath("registration-confirmation.png"),
      fullPage: false,
    });
    await page.getByText("Указать другой email", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Создать аккаунт" })).toBeVisible();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("clears editable credentials after storing the normalized submitted address", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop-1440",
      "credential retention regression runs once",
    );
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await mockSignupSuccess(page);
    await gotoOrSkip(page, "/register");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("  New-User@Example.Test  ");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    await expect(page.getByText("n***r@example.test")).toBeVisible();
    await page.getByRole("button", { name: "Указать другой email" }).click();
    await expect(page.locator('input[type="email"]')).toHaveValue("");
    await expect(page.locator('input[type="password"]')).toHaveValue("");
  });

  test("disables pending resend requests, sanitizes failures, and resets CAPTCHA for a new token", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop-1440", "resend interaction runs once");
    const resendPayloads: Array<{
      action?: string;
      captchaProvider?: string;
      captchaToken?: string;
      email?: string;
    }> = [];
    const firstResponse = createDeferred();
    await page.clock.install({ time: new Date("2026-08-30T12:00:00.000Z") });
    await installCaptchaMock(page);
    await mockRegistrationInviteMode(page);
    await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
      const payload = route.request().postDataJSON() as {
        action?: string;
        captchaProvider?: string;
        captchaToken?: string;
        email?: string;
      };
      expect(["turnstile", "yandex-smartcaptcha"]).toContain(payload.captchaProvider);
      if (payload.action === "signup") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      expect(payload.action).toBe("resend_signup");
      resendPayloads.push(payload);
      if (resendPayloads.length === 1) {
        await firstResponse.promise;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "raw gateway detail: sensitive@example.test" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await gotoOrSkip(page, "/register");

    await page.locator('input[autocomplete="name"]').fill("Новый пользователь");
    await page.locator('input[type="email"]').fill("new-user@example.test");
    await page.locator('input[type="password"]').fill("correct-horse-battery");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    const resend = page.getByRole("button", { name: /Отправить письмо повторно/ });
    await expect(resend).toBeDisabled();
    const countdownHeight = await resend.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await page.clock.fastForward(60_000);
    await expect(resend).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaRenders))
      .toBeGreaterThanOrEqual(2);
    await resend.click();
    await expect.poll(() => resendPayloads.length).toBe(1);
    await expect(resend).toBeDisabled();
    expect(await resend.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      countdownHeight,
    );

    firstResponse.resolve();
    await expect(page.getByText("Не удалось создать аккаунт. Попробуйте позже.")).toBeVisible();
    await expect(page.getByText("raw gateway detail: sensitive@example.test")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaResets))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => window.__playwrightCaptchaTokens))
      .toBeGreaterThanOrEqual(3);
    await expect(resend).toBeEnabled();

    await resend.click();
    await expect(page.getByText("Письмо отправлено повторно.")).toBeVisible();
    expect(await resend.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      countdownHeight,
    );
    expect(resendPayloads).toHaveLength(2);
    expect(resendPayloads[0]).toMatchObject({
      action: "resend_signup",
      captchaProvider: expect.any(String),
      email: "new-user@example.test",
      captchaToken: "playwright-captcha-token-2",
    });
    expect(resendPayloads[1]).toMatchObject({
      action: "resend_signup",
      captchaProvider: expect.any(String),
      email: "new-user@example.test",
      captchaToken: "playwright-captcha-token-3",
    });
    await expect(resend).toBeDisabled();
  });
});

declare global {
  interface Window {
    __playwrightCaptchaRenders?: number;
    __playwrightCaptchaResets?: number;
    __playwrightCaptchaTokens?: number;
  }
}

function collectConsoleErrors(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(message.text());
  });
  page.on("pageerror", (error) => {
    messages.push(error.message);
  });
  return messages;
}

async function installCaptchaMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__playwrightCaptchaRenders = 0;
    window.__playwrightCaptchaResets = 0;
    window.__playwrightCaptchaTokens = 0;
    const callbacks = new Map<string, ((token: string) => void) | undefined>();
    const issueToken = (callback?: (token: string) => void) => {
      window.__playwrightCaptchaTokens = (window.__playwrightCaptchaTokens ?? 0) + 1;
      const token = `playwright-captcha-token-${window.__playwrightCaptchaTokens}`;
      window.setTimeout(() => callback?.(token), 0);
    };
    const render = (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      window.__playwrightCaptchaRenders = (window.__playwrightCaptchaRenders ?? 0) + 1;
      const widgetId = `playwright-captcha-${window.__playwrightCaptchaRenders}`;
      callbacks.set(widgetId, options.callback);
      issueToken(options.callback);
      return widgetId;
    };
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        render,
        reset: (widgetId?: string) => {
          window.__playwrightCaptchaResets = (window.__playwrightCaptchaResets ?? 0) + 1;
          issueToken(widgetId ? callbacks.get(widgetId) : undefined);
        },
        remove: (widgetId: string) => callbacks.delete(widgetId),
      },
    });
    Object.defineProperty(window, "smartCaptcha", {
      configurable: true,
      value: {
        render,
        reset: (widgetId?: string) => {
          window.__playwrightCaptchaResets = (window.__playwrightCaptchaResets ?? 0) + 1;
          issueToken(widgetId ? callbacks.get(widgetId) : undefined);
        },
        destroy: (widgetId: string) => callbacks.delete(widgetId),
      },
    });
  });
}

async function mockRegistrationInviteMode(page: Page): Promise<void> {
  await page.route("**/rest/v1/rpc/registration_invite_mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ invite_only_enabled: false }]),
    });
  });
}

async function mockSignupSuccess(page: Page): Promise<void> {
  await page.route("**/functions/v1/auth-yandex-gateway", async (route) => {
    const payload = route.request().postDataJSON() as {
      action?: string;
      captchaProvider?: string;
    };
    expect(payload.action).toBe("signup");
    expect(["turnstile", "yandex-smartcaptcha"]).toContain(payload.captchaProvider);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((completion) => {
    resolve = completion;
  });
  return { promise, resolve };
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(
        message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js")
      ),
  );
}
