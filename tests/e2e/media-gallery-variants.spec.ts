import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test("chat info media gallery uses generated variants instead of original image files", () => {
  const source = readFileSync(
    resolve("artifacts/kub/src/components/chat/ChatInfoPanel.tsx"),
    "utf8",
  );

  expect(source).toContain("selectMediaGalleryPreviewUrl");
  expect(source).toContain("useMessageMediaVariantUrls(mediaGridItems");
  expect(source).not.toContain("src={message.media_url}");
});

test("chat info counted media rows open in real UI without horizontal overflow", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const role = findFirstAvailableQaRole(
    ["owner", "tech_admin", "location_admin", "location_staff", "client"],
    { includeDefault: true },
  );
  test.skip(!role, "QA credentials or auth state are not configured");

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);

  const firstChat = page.getByTestId("chat-list-item").first();
  // Counted after waiting rather than the instant the shell appears. The list
  // arrives over the network a moment after sign-in, so an immediate count is a
  // race against it: the same account that ran this case a minute earlier
  // skipped it as "no visible chats" in both engines. A skip on a real empty
  // account is the contract; a skip because the answer had not come back yet is
  // the suite quietly testing nothing.
  const hasChats = await firstChat
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasChats, "QA account has no visible chats");
  await firstChat.click();

  const infoButton = page.getByTestId("chat-header-info-button");
  await expect(infoButton).toBeVisible();
  await infoButton.click();

  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();

  // The division and the counts are rows in the card's own scroll now: one row
  // per kind, «1543 фотографии», and no row at all for a kind this chat has
  // never carried. So the card itself is what has to fit first.
  await assertNoHorizontalOverflow(panel, "chat info card has horizontal overflow");

  // The placeholder is what stands where the counts will be, so its going is
  // what says the counts are known — a row count read before then is a race.
  await expect(page.getByTestId("chat-info-media-loading")).toHaveCount(0);
  const rows = page.getByTestId("chat-info-media-row");
  if ((await rows.count()) === 0) {
    // A chat with no shared media offers no rows, which is the contract, not a
    // failure. There is nothing further to open.
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    return;
  }

  // A counted row is the whole label: the number and the noun agreeing with it.
  await expect(rows.first()).toContainText(
    /\d+\+? (фотограф|видео|GIF-анимаци|файл|ссыл|голосов|аудиозапис)/,
  );

  // Pressing one pushes the sub-view holding that kind's contents; the back
  // control in the title bar pops it.
  await rows.first().click();
  const gallery = page.getByTestId("chat-info-gallery-view");
  await expect(gallery).toBeVisible();
  await assertNoHorizontalOverflow(panel, "chat info media panel has horizontal overflow");

  const back = page.getByTestId("chat-info-back");
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByTestId("chat-info-summary")).toBeVisible();
  await expect(panel).toBeVisible();

  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")) &&
      // WebKit, registering the worker against the Vite dev server, intermittently
      // reports "…/sw.js due to access control checks." This case is about media
      // rows and the width of a card; it is not the service worker's guard, and
      // the message is not evidence of a product fault. Measured before allowing
      // it: loading the same dev origin on its own registers the worker with no
      // error at all (one registration, none logged), and so does
      // `https://app.letscube.ru` in the same engine — so this is the dev
      // server's registration path, not something a reader would ever meet.
      // Narrowed to this one message so any other worker failure still fails.
      !(message.includes("sw.js") && message.includes("access control")),
  );
}

async function assertNoHorizontalOverflow(locator: Locator, message: string) {
  const metrics = await locator.evaluate((node) => {
    const el = node as HTMLElement;
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    };
  });
  expect(metrics.scrollWidth, message).toBeLessThanOrEqual(metrics.clientWidth + 1);
}
