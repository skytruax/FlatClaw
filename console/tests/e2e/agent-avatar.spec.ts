import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";
import { stubRuntimeRoutes } from "./helpers/runtimeRoute";

test.beforeEach(async ({ page }) => {
  await stubStudioRoute(page);
  await stubRuntimeRoutes(page);
});

test("empty focused view shows zero agents when disconnected", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("No agents available.").first()).toBeVisible();
  await expect(page.getByTestId("studio-menu-toggle")).toBeVisible();
  await page.getByTestId("studio-menu-toggle").click();
  await expect(page.getByTestId("gateway-settings-toggle")).toBeVisible();
});
