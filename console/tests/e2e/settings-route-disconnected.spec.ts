import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";
import { stubRuntimeRoutes } from "./helpers/runtimeRoute";

test.beforeEach(async ({ page }) => {
  await stubStudioRoute(page);
  await stubRuntimeRoutes(page);
});

test("settings route shows connect UI while disconnected and can return to chat", async ({ page }) => {
  await page.goto("/agents/main/settings");

  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: "Expected settings route without agents to resolve to chat route.",
    })
    .toBe("/");

  await page.getByTestId("studio-menu-toggle").click();
  await page.getByTestId("gateway-settings-toggle").click();
  await expect(page.getByLabel(/Upstream (gateway )?URL/i)).toBeVisible();
});
