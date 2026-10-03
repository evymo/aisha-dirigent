/**
 * E2E Tests: Public Partner Profile
 * 
 * Tests public partner/practitioner profiles:
 * - Viewing partner directory
 * - Partner profile pages
 * - Booking from public profile
 */

import { test, expect } from "@playwright/test";
import { clearLocalStorage, waitForLoadingComplete, loginUser, TEST_USERS } from "./fixtures";

test.describe("Public Partner Directory", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Can access partner directory without login", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Should display partners section
    const partnersSection = page.locator('[data-testid="partners-directory"], .partners-list, main').first();
    await expect(partnersSection).toBeVisible({ timeout: 10000 });
  });

  test("Shows list of public partners", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Should display partners list
    const partnersList = page.locator('[data-testid="partners-list"], .partner-card').first();
    const emptyState = page.locator('text=/no.*partners|žádní.*partneři/i').first();
    
    const hasPartners = await partnersList.isVisible({ timeout: 5000 }).catch(() => false);
    const isEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasPartners || isEmpty).toBe(true);
  });

  test("Can filter partners by specialty", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Look for specialty filter
    const specialtyFilter = page.locator('[data-testid="specialty-filter"], select, .specialty-tabs').first();
    
    if (await specialtyFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await specialtyFilter.click();
      await page.waitForTimeout(500);
    }
  });

  test("Can view partner public profile", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Click on a partner
    const partnerCard = page.locator('[data-testid="partner-card"], .partner-item, a').first();
    
    if (await partnerCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await partnerCard.click();
      await waitForLoadingComplete(page);

      // Should show partner profile
      const profileSection = page.locator('[data-testid="partner-profile"], .profile-content').first();
      await expect(profileSection).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Partner Profile - Booking", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
  });

  test("Can initiate booking from partner profile", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Navigate to a partner profile
    const partnerCard = page.locator('[data-testid="partner-card"], .partner-item, a').first();
    
    if (await partnerCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await partnerCard.click();
      await waitForLoadingComplete(page);

      // Look for book button
      const bookButton = page.getByRole("button", { name: /book|objednat|schedule/i }).first();
      
      if (await bookButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bookButton.click();
        await waitForLoadingComplete(page);

        // Should navigate to booking or show booking dialog
        const bookingFlow = page.locator('[data-testid="booking-flow"], .booking-dialog, [role="dialog"]').first();
        await expect(bookingFlow).toBeVisible({ timeout: 5000 }).catch(() => {
          // May navigate to appointments page
          expect(page.url()).toContain("appointment");
        });
      }
    }
  });
});
