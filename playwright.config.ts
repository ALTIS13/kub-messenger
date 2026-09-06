import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.KUB_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "output/playwright-test",
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-desktop-1920",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "chromium-desktop-3840",
      use: { ...devices["Desktop Chrome"], viewport: { width: 3840, height: 2160 } },
    },
    {
      // The narrow end of the matrix, and it was missing until D-058, D-060 and
      // D-061 all came in from below 390 on a phone that is 360 CSS pixels wide
      // — three of five findings from a width nothing had ever been checked at.
      // 360x800 is that phone: 720x1600 physical at density 320.
      name: "chromium-mobile-360",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "chromium-mobile-390",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "chromium-mobile-412",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
