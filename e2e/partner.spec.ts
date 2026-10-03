/**
 * Partner E2E Tests
 * 
 * Testy pro production provider (partner) roli:
 * - Partner dashboard
 * - Přístup k pacientům (s consent)
 * - Partner profil
 */

import { test, expect } from "@playwright/test";
import { waitForLoadingComplete } from "./fixtures";

test.describe("Partner Dashboard", () => {
  test("partner může vidět partner dashboard", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);
    
    // Partner by měl vidět dashboard nebo být přesměrován na partner sekci
    await expect(page.locator("body")).toContainText(/partner|dashboard|pacienti|users/i);
  });

  test("partner vidí svůj profil", async ({ page }) => {
    await page.goto("/partner/profile");
    await waitForLoadingComplete(page);
    
    // Partner by měl vidět svůj profil s business názvem
    await expect(page.locator("body")).toContainText(/profil|clinic|partner/i);
  });

  test("partner users page loads", async ({ page }) => {
    await page.goto("/partner/users");
    await waitForLoadingComplete(page);

    await expect(page).toHaveURL(/\/partner\/users/);
    const content = page.locator("main, [role='main'], #root").first();
    await expect(content).toBeVisible();
  });
});

test.describe("Partner Access Control", () => {
  test("partner nemá přístup k admin panelu", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);
    
    // Partner by neměl vidět admin dashboard
    await expect(page).not.toHaveURL(/\/admin$/);
  });
  
  test("partner může přistupovat k member sekcím", async ({ page }) => {
    // Partner má také běžná uživatelská práva
    await page.goto("/member");
    await waitForLoadingComplete(page);
    
    // Měl by mít přístup
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Partner Invitations", () => {
  test("partner can view invitations tab and dialog opens", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);

    // Find and click on Invitations tab
    const invitationsTab = page.getByRole("tab", { name: /pozv\w*|invitation/i }).first();
    if (await invitationsTab.isVisible().catch(() => false)) {
      await invitationsTab.click();
    }

    // Wait for tab content to load
    await page.waitForTimeout(500);

    // Find and click create button
    const createButton = page.getByRole("button", { name: /vytvořit|create/i }).first();
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    // Dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Dialog should have heading
    const dialogHeading = dialog.getByRole("heading").first();
    await expect(dialogHeading).toBeVisible();

    // Close dialog using Escape (most reliable)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });
});
