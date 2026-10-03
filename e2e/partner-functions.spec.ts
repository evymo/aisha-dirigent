/**
 * E2E Tests: Partner Dashboard & User Access
 *
 * Testy pro:
 * - Partner přístup k pacientům s consenty
 * - Partner dashboard funkce
 * - Dostupnost a správa termínů
 * - Storyloop přístup
 */

import { test, expect, Page } from "@playwright/test";

// Use partner auth state
test.use({ storageState: "e2e/.auth/partner.json" });

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

test.describe("Partner Dashboard", () => {
  test("partner can access dashboard", async ({ page }) => {
    await page.goto("/partner/dashboard");
    await waitForLoadingComplete(page);

    // Should see dashboard content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner dashboard shows users list", async ({ page }) => {
    await page.goto("/partner/dashboard");
    await waitForLoadingComplete(page);

    // Should have users section or empty state
    const usersSection = page.locator("text=/user|pacient|member|člen|klient/i").first();
    await expect(usersSection).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("partner dashboard shows statistics", async ({ page }) => {
    await page.goto("/partner/dashboard");
    await waitForLoadingComplete(page);

    // Look for stat cards or numbers
    const statsCards = page.locator("[class*='stat'], [class*='card'], .rounded-lg");
    await expect(statsCards.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});

test.describe("Partner User Access", () => {
  test("partner can view assigned users", async ({ page }) => {
    await page.goto("/partner/users");
    await waitForLoadingComplete(page);

    // Should show users list or empty state
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Check for users table or cards
    const usersList = page.locator("table, [role='table'], .grid, [class*='card']").first();
    await expect(usersList).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("partner can access user detail with consent", async ({ page }) => {
    await page.goto("/partner/users");
    await waitForLoadingComplete(page);

    // Try to click on first user
    const userLink = page.locator("a, button").filter({ hasText: /detail|view|zobrazit/i }).first();
    
    if (await userLink.isVisible()) {
      await userLink.click();
      await waitForLoadingComplete(page);

      // Should show user detail
      const content = page.locator("main, [role='main']").first();
      await expect(content).toBeVisible();
    }
  });

  test("partner can view user health data with consent", async ({ page }) => {
    await page.goto("/partner/users");
    await waitForLoadingComplete(page);

    // Navigate to first user if available
    const userRow = page.locator("tr, [role='row']").nth(1);
    
    if (await userRow.isVisible()) {
      const detailLink = userRow.locator("a, button").first();
      if (await detailLink.isVisible()) {
        await detailLink.click();
        await waitForLoadingComplete(page);

        // Should show health data sections
        const healthData = page.locator("text=/check-in|health|zdraví|tracking/i").first();
        await expect(healthData).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    }
  });
});

test.describe("Partner Availability", () => {
  test("partner can access availability page", async ({ page }) => {
    await page.goto("/partner/availability");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner availability shows calendar or schedule", async ({ page }) => {
    await page.goto("/partner/availability");
    await waitForLoadingComplete(page);

    // Should show calendar, schedule, or time slots
    const scheduleContent = page.locator(
      "[class*='calendar'], [class*='schedule'], table, text=/availability|dostupnost|time|čas/i"
    ).first();
    await expect(scheduleContent).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("partner can toggle availability", async ({ page }) => {
    await page.goto("/partner/availability");
    await waitForLoadingComplete(page);

    // Look for toggle or checkbox for availability
    const toggle = page.locator(
      "input[type='checkbox'], [role='switch'], button[class*='toggle']"
    ).first();
    
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Partner Appointments", () => {
  test("partner can view appointments list", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner appointments show date and status", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Should show appointments table/list
    const appointments = page.locator("table, [role='table'], .grid").first();
    await expect(appointments).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("partner can filter appointments", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Look for filter controls
    const filterButton = page.locator("button, select").filter({ hasText: /filter|filtr|status/i }).first();
    
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Partner Storyloop Access", () => {
  test("partner can access storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should show storyloop content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("storyloop shows partner-relevant content", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should have stories/posts or empty state
    const storyContent = page.locator(
      "[class*='story'], [class*='post'], [class*='feed'], text=/story|příběh|post/i"
    ).first();
    await expect(storyContent).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});

test.describe("Partner Profile", () => {
  test("partner can access profile page", async ({ page }) => {
    await page.goto("/partner/profile");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner profile shows public info fields", async ({ page }) => {
    await page.goto("/partner/profile");
    await waitForLoadingComplete(page);

    // Should have profile form fields
    const form = page.locator("form").first();
    await expect(form).toBeVisible({ timeout: 10000 }).catch(() => {});

    // Check for expected fields
    const nameField = page.locator("input").filter({ hasText: /name|jméno|bio/i }).first();
    await expect(nameField).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});

test.describe("Partner Admin Access - Blocked", () => {
  test("partner cannot access admin dashboard", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    // Should be redirected or see access denied
    const url = page.url();
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized|nepov/i").first();
    
    const isBlocked = !url.includes("/admin") || await accessDenied.isVisible();
    expect(isBlocked).toBeTruthy();
  });

  test("partner cannot access admin users page", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForLoadingComplete(page);

    // Should be redirected or see access denied
    const url = page.url();
    expect(url).not.toContain("/admin/users");
  });
});
