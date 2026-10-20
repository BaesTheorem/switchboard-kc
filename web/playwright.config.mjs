// Browser tests: `npx playwright test` (web/test/e2e). WebKit stands in for
// iPhone Safari and Chromium for Android Chrome. One worker: the tests read
// the live city API, and the Mac running them has 8 GB.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Service workers off: Playwright's request mocks do not see requests from a
  // page that a service worker controls (that let three test reports reach the
  // city on 2026-10-20). The offline-shell test turns them back on for itself.
  use: { trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-US", timezoneId: "America/Chicago", serviceWorkers: "block" },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 13"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
});
