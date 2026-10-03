/**
 * E2E Tests: Member Portal
 *
 * Testy členské sekce - dostupnost stránek a check-in formuláře.
 */

import { test, expect, waitForLoadingComplete } from "./fixtures";

const memberPages = [
  { name: "dashboard", path: "/member" },
  { name: "profile", path: "/member/profile" },
  { name: "orders", path: "/member/orders" },
  { name: "tokens", path: "/member/tokens" },
  { name: "appointments", path: "/member/appointments" },
  { name: "assessment", path: "/member/assessment" },
];

test.describe("Member Pages", () => {
  for (const pageDef of memberPages) {
    test(`member page loads: ${pageDef.name}`, async ({ page }) => {
      await page.goto(pageDef.path);
      await waitForLoadingComplete(page);

      // /member/assessment is intentionally a standalone page (no Header/Footer layout).
      // It may not render a <main> element.
      if (pageDef.path === "/member/assessment") {
        const heading = page.getByRole("heading", { name: /hodnocen[ií]|assessment/i }).first();
        await expect(heading).toBeVisible();
        return;
      }

      const content = page.locator("main, [role='main']").first();
      await expect(content).toBeVisible();
    });
  }
});

test.describe("Member Check-in", () => {
  test("check-in page loads", async ({ page }) => {
    await page.goto("/member/check-in");
    await waitForLoadingComplete(page);

    // secure mode gate: unlock with password if prompted.
    const securePasswordInput = page.locator("#secure-password").first();
    if (await securePasswordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await securePasswordInput.fill(process.env.E2E_MEMBER_PASSWORD ?? "Member123!");
      
      // The unlock button
      const unlockButton = page.getByRole("button", { name: /unlock|odemknout/i }).first();
      if (await unlockButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unlockButton.click();
      }
      
      // Wait for the sensitive data dialog to disappear (either form or "already checked in" shows)
      await page.waitForSelector("#secure-password", { state: "hidden", timeout: 15000 }).catch(() => {});
    }
    
    await waitForLoadingComplete(page);

    // Page should show either the check-in form or "already checked in" message
    const form = page.locator("form").first();
    const alreadyCheckedIn = page.getByRole("heading", { name: /already checked in|již jste provedli/i });
    const dailyCheckIn = page.getByRole("heading", { name: /daily health check-in|denní zdravotní/i });
    
    // Wait for one of the expected elements
    await Promise.race([
      form.waitFor({ state: "visible", timeout: 10000 }).catch(() => null),
      alreadyCheckedIn.waitFor({ state: "visible", timeout: 10000 }).catch(() => null),
      dailyCheckIn.waitFor({ state: "visible", timeout: 10000 }).catch(() => null),
    ]);
    
    const formVisible = await form.isVisible().catch(() => false);
    const alreadyVisible = await alreadyCheckedIn.isVisible().catch(() => false);
    const dailyVisible = await dailyCheckIn.isVisible().catch(() => false);
    
    expect(formVisible || alreadyVisible || dailyVisible).toBe(true);
  });

  test("check-in form has inputs or already checked in today", async ({ page }) => {
    await page.goto("/member/check-in");
    await waitForLoadingComplete(page);

    // secure mode gate: unlock with password if prompted.
    const securePassword = page.locator("#secure-password").first();
    if (await securePassword.isVisible().catch(() => false)) {
      await securePassword.fill(process.env.E2E_MEMBER_PASSWORD ?? "Member123!");
      const unlockButton = page
        .getByRole("button", { name: /unlock|odemknout|zp\w*stupnit|povolit/i })
        .first();
      await unlockButton.click();
      await waitForLoadingComplete(page);
    }

    // Two valid scenarios:
    // 1. User hasn't checked in today -> form with inputs is visible
    // 2. User already checked in today -> summary is visible (no form inputs)
    const alreadyCheckedIn = page.getByRole("heading", { name: /already checked in|již jste provedli/i });
    const hasCheckedIn = await alreadyCheckedIn.isVisible().catch(() => false);

    if (hasCheckedIn) {
      // User already checked in - verify summary has some content
      const summary = page.locator("main").first();
      await expect(summary).toBeVisible();
      // Check that there are metric values displayed (Pain Level, Energy, Sleep Quality)
      const metrics = page.getByText(/Pain Level|Energy|Sleep Quality/i);
      const metricsCount = await metrics.count();
      expect(metricsCount).toBeGreaterThan(0);
    } else {
      // User hasn't checked in - form should be visible with inputs
      const form = page.locator("form").first();
      await expect(form).toBeVisible();
      const inputs = await form.locator("input, select, textarea, [role='slider']").count();
      expect(inputs).toBeGreaterThan(0);
    }
  });
});

test.describe("Member Portal Tabs", () => {
  const unlockSecureIfNeeded = async (page: import("@playwright/test").Page) => {
    const securePassword = page.locator("#secure-password").first();
    if (await securePassword.isVisible().catch(() => false)) {
      await securePassword.fill(process.env.E2E_MEMBER_PASSWORD ?? "Member123!");
      const unlockButton = page
        .getByRole("button", { name: /unlock|odemknout|zp\w*stupnit|povolit/i })
        .first();
      await unlockButton.click();
      await waitForLoadingComplete(page);
    }
  };

  test("activity tab renders", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    const activityTab = page.getByRole("tab", { name: /aktivita|activity/i }).first();
    if (await activityTab.isVisible().catch(() => false)) {
      await activityTab.click();
    }

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("documents tab renders with sensitive data gate", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    const documentsTab = page.getByRole("tab", { name: /dokumenty|documents/i }).first();
    if (await documentsTab.isVisible().catch(() => false)) {
      await documentsTab.click();
    }

    await unlockSecureIfNeeded(page);

    const documentsTitle = page.getByText(/dokumenty|documents/i).first();
    await expect(documentsTitle).toBeVisible();
  });
});
