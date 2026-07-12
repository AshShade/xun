import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "path";

// Custom fixture that launches Chrome with the extension loaded
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extensionPath = path.resolve("dist");
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // Wait for service worker to register
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const id = sw.url().split("/")[2]!;
    await use(id);
  },
});

export const expect = test.expect;

// Helper: open Xun overlay on a page via keyboard shortcut
export async function openXun(page: import("@playwright/test").Page) {
  const isMac = process.platform === "darwin";
  // Ensure the window has OS focus so the overlay input's focus() registers in
  // activeElement — headless CI runners otherwise leave the window unfocused.
  await page.bringToFront();
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  // Wait for shadow DOM overlay to appear
  await page.waitForFunction(() => {
    const host = document.getElementById("xun-host");
    return host?.shadowRoot?.getElementById("xun-overlay");
  }, undefined, { timeout: 3000 });
}

// Helper: get the shadow root of the Xun overlay
export async function getXunRoot(page: import("@playwright/test").Page) {
  return page.evaluateHandle(() => {
    const host = document.getElementById("xun-host")!;
    return host.shadowRoot!;
  });
}

// Helper: type into Xun input
export async function typeInXun(page: import("@playwright/test").Page, text: string) {
  await page.evaluate((t) => {
    const host = document.getElementById("xun-host")!;
    const input = host.shadowRoot!.getElementById("xun-input") as HTMLInputElement;
    input.value = t;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

// Helper: get result count
export async function getResultCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.getElementById("xun-host");
    if (!host?.shadowRoot) return 0;
    return host.shadowRoot.querySelectorAll("#xun-results > div").length;
  });
}

// Helper: check if overlay is visible
export async function isOverlayVisible(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.getElementById("xun-host");
    return !!host?.shadowRoot?.getElementById("xun-overlay");
  });
}
