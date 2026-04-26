import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";
import { stubRuntimeRoutes } from "./helpers/runtimeRoute";

test("loads focused studio empty state", async ({ page }) => {
  await stubStudioRoute(page);
  await stubRuntimeRoutes(page);

  await page.goto("/");

  await expect(page.getByTestId("studio-menu-toggle")).toBeVisible();
  await page.getByTestId("studio-menu-toggle").click();
  await expect(page.getByTestId("gateway-settings-toggle")).toBeVisible();
});
