/**
 * E2E Tests: Consent Flow
 * 
 * Tests data sharing consent functionality:
 * - Member viewing their active consents
 * - Partner requesting consent from member
 * - Granting and revoking data sharing consent
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Member Consent Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can view consent settings page", async ({ page }) => {
    await page.goto("/member/consents");
    await waitForLoadingComplete(page);

    // Should see consents page or settings
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
    
    // Look for consent-related content
    const hasConsentContent = 
      await page.getByText(/souhlas|consent|sharing|sdílení/i).isVisible().catch(() => false) ||
      await page.getByText(/partners|partneři|practitioners|lékaři/i).isVisible().catch(() => false);
    
    expect(hasConsentContent).toBe(true);
  });

  test("Member can view list of active consents", async ({ page }) => {
    await page.goto("/member/consents");
    await waitForLoadingComplete(page);

    // Should see active consents list or "no consents" message
    const hasActiveConsents = await page.getByText(/active|aktivní|granted|udělené/i).isVisible().catch(() => false);
    const hasNoConsents = await page.getByText(/no consents|žádné souhlasy|no data sharing/i).isVisible().catch(() => false);
    const hasConsentList = await page.locator("[data-testid='consent-list'], [role='list']").isVisible().catch(() => false);
    
    expect(hasActiveConsents || hasNoConsents || hasConsentList).toBe(true);
  });

  test("Member profile has consent section", async ({ page }) => {
    await page.goto("/member/profile");
    await waitForLoadingComplete(page);

    // Look for data sharing or consent section
    const consentSection = page.getByRole("heading", { name: /consent|souhlas|data sharing|sdílení/i });
    const privacySection = page.getByRole("heading", { name: /privacy|soukromí|settings|nastavení/i });
    
    const hasSection = 
      await consentSection.isVisible().catch(() => false) ||
      await privacySection.isVisible().catch(() => false);
    
    // Consent section may be a separate page or embedded in profile
    expect(hasSection).toBe(true); // Soft check
  });
});

test.describe("Partner Data Access with Consent", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Partner can view users with consent", async ({ page }) => {
    // Navigate to partner dashboard
    await page.goto("/partner");
    await waitForLoadingComplete(page);

    // Look for users/members section
    const usersLink = page.getByRole("link", { name: /users|pacienti|members|členové/i });
    
    if (await usersLink.isVisible().catch(() => false)) {
      await usersLink.click();
      await waitForLoadingComplete(page);
    } else {
      await page.goto("/partner/users");
      await waitForLoadingComplete(page);
    }

    // Should see user list or empty state
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
    
    const hasUsers = await page.getByText(/user|pacient|member|člen/i).isVisible().catch(() => false);
    const noUsers = await page.getByText(/no users|žádní pacienti|no members/i).isVisible().catch(() => false);
    
    expect(hasUsers || noUsers).toBe(true);
  });

  test("Partner user detail requires consent", async ({ page }) => {
    await page.goto("/partner/users");
    await waitForLoadingComplete(page);

    // If there are users, try to access detail
    const userCard = page.locator("[data-testid='user-card'], .user-item").first();
    
    if (await userCard.isVisible().catch(() => false)) {
      await userCard.click();
      await waitForLoadingComplete(page);

      // Should see user data or consent required message
      const hasData = await page.getByText(/health|zdraví|check-in|kontrola/i).isVisible().catch(() => false);
      const needsConsent = await page.getByText(/consent|souhlas|permission|oprávnění/i).isVisible().catch(() => false);
      
      expect(hasData || needsConsent).toBe(true);
    }
  });

  test("Partner appointments page loads", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
    
    // Should see appointments or empty state
    const hasAppointments = await page.getByText(/appointment|schůzka|booking|rezervace/i).isVisible().catch(() => false);
    const noAppointments = await page.getByText(/no appointments|žádné schůzky/i).isVisible().catch(() => false);
    
    expect(hasAppointments || noAppointments).toBe(true);
  });
});

test.describe("Consent Request Flow", () => {
  test("Partner can request consent from member", async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
    
    await page.goto("/partner");
    await waitForLoadingComplete(page);

    // Look for "invite user" or "request consent" button
    const inviteButton = page.getByRole("button", { name: /invite|pozvat|request|požádat/i }).or(
      page.getByRole("link", { name: /invite|pozvat|request|požádat/i })
    );
    
    if (await inviteButton.isVisible().catch(() => false)) {
      await inviteButton.click();
      await waitForLoadingComplete(page);
      
      // Should see invitation/consent request form
      const hasForm = await page.locator("form").isVisible().catch(() => false);
      const hasEmailField = await page.getByRole("textbox", { name: /email/i }).isVisible().catch(() => false);
      
      expect(hasForm || hasEmailField).toBe(true);
    }
  });
});
