import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";
import { stubRuntimeRoutes } from "./helpers/runtimeRoute";

test.beforeEach(async ({ page }) => {
  await stubStudioRoute(page);
  await stubRuntimeRoutes(page);
});

test("redirects unknown app routes to root", async ({ page }) => {
  await page.goto("/not-a-real-route");
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: "Expected invalid route to redirect to root path.",
    })
    .toBe("/");
  await expect(page.getByTestId("studio-menu-toggle")).toBeVisible();
});
