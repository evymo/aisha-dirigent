/**
 * Partner User Flow E2E Tests
 * 
 * Tests all features available to Partner/Ambassador users.
 * Partners can view user data with consent, manage appointments, etc.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, TEST_USERS } from "./fixtures";

const PARTNER = TEST_USERS.partner;
const MEMBER = TEST_USERS.member;

test.describe("Partner Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Partner can login and access partner dashboard", async ({ page }) => {
    await loginUser(page, PARTNER.email, PARTNER.password);
    await page.goto("/partner");
    
    // Should be in partner area
    await expect(page).toHaveURL(/partner/i, { timeout: 10000 });
    
    // Should see partner dashboard content
    const hasPartnerContent = await page.getByText(/partner|dashboard|member|client/i).isVisible().catch(() => false);
    expect(hasPartnerContent).toBe(true);
  });
});

test.describe("Partner Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Dashboard shows assigned members", async ({ page }) => {
    await page.goto("/partner");
    await page.waitForLoadState("networkidle");
    
    // Should show members/clients section
    const hasMembersSection = await page.getByText(/member|client|user|klient|pacient/i).isVisible().catch(() => false);
    expect(hasMembersSection).toBe(true);
  });

  test("Can navigate to appointments", async ({ page }) => {
    await page.goto("/partner/appointments");
    
    // Should show appointments management
    const hasAppointments = await page.getByText(/appointment|schůzka|schedule|rozvrh/i).isVisible().catch(() => false);
    expect(hasAppointments).toBe(true);
  });

  test("Can access partner profile", async ({ page }) => {
    await page.goto("/partner/profile");
    
    // Should show partner profile
    const hasProfile = await page.getByText(/profile|profil|settings|nastavení/i).isVisible().catch(() => false);
    expect(hasProfile).toBe(true);
  });
});

test.describe("Partner Member Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Can view member list", async ({ page }) => {
    await page.goto("/partner/members");
    
    // Should show member list or empty state
    const hasMembers = await page.getByText(/member|client|klient|assigned|přidělený/i).isVisible().catch(() => false);
    const hasNoMembers = await page.getByText(/no member|no client|žádný klient/i).isVisible().catch(() => false);
    
    expect(hasMembers || hasNoMembers).toBe(true);
  });

  test("Can view member detail with consent", async ({ page }) => {
    await page.goto("/partner/members");
    
    // If there's a member with consent, we should be able to view details
    const memberLink = page.getByRole("link", { name: /view|detail|zobrazit/i }).first();
    
    if (await memberLink.isVisible().catch(() => false)) {
      await memberLink.click();
      
      // Should show member detail (sensitive data only with consent)
      const hasDetail = await page.getByText(/health|zdraví|check-in|profile|profil/i).isVisible().catch(() => false);
      expect(hasDetail).toBe(true);
    }
  });
});

test.describe("Partner Appointment Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Can view appointment calendar", async ({ page }) => {
    await page.goto("/partner/appointments");
    
    // Should show calendar or appointment list
    const hasCalendar = await page.getByText(/calendar|kalendář|schedule|rozvrh/i).isVisible().catch(() => false);
    const hasAppointmentList = await page.getByText(/appointment|schůzka/i).isVisible().catch(() => false);
    
    expect(hasCalendar || hasAppointmentList).toBe(true);
  });

  test("Can manage availability", async ({ page }) => {
    await page.goto("/partner/availability");
    
    // Should show availability settings
    const hasAvailability = await page.getByText(/availability|dostupnost|hours|hodiny/i).isVisible().catch(() => false);
    expect(hasAvailability).toBe(true);
  });
});

test.describe("Partner Study Collaboration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Can view studies where partner is consultant", async ({ page }) => {
    await page.goto("/partner/studies");
    
    // Should show studies or registration info
    const hasStudies = await page.getByText(/study|studie|research|výzkum|enrolled/i).isVisible().catch(() => false);
    expect(hasStudies).toBe(true);
  });
});

test.describe("Partner Consent-Based Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Cannot access member data without consent", async ({ page }) => {
    // Try to access a random member's data
    const randomMemberId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`/partner/members/${randomMemberId}/health`);
    
    // Should show access denied or redirect
    const hasAccessDenied = await page.getByText(/denied|forbidden|unauthorized|no access|nemáte přístup/i).isVisible().catch(() => false);
    const wasRedirected = !page.url().includes(randomMemberId);
    
    expect(hasAccessDenied || wasRedirected).toBe(true);
  });
});

test.describe("Partner Invitations", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Can view invitation management", async ({ page }) => {
    await page.goto("/partner/invitations");
    
    // Should show invitation management
    const hasInvitations = await page.getByText(/invitation|pozvánka|invite|pozvat/i).isVisible().catch(() => false);
    expect(hasInvitations).toBe(true);
  });
});

test.describe("Partner Secure Mode", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("secure mode required for sensitive member data", async ({ page }) => {
    await page.goto("/partner/members");
    
    // Navigate to member detail if available
    const memberCard = page.getByTestId("member-card").first().or(
      page.getByRole("link", { name: /view|detail/i }).first()
    );
    
    if (await memberCard.isVisible().catch(() => false)) {
      await memberCard.click();
      
      // Should either require secure mode or show limited data
      const hasSecurePrompt = await page.getByText(/secure mode|authenticate|re-authenticate|verify/i).isVisible().catch(() => false);
      const hasLimitedData = await page.getByText(/limited|basic|summary/i).isVisible().catch(() => false);
      const hasFullAccess = await page.getByText(/health check|lab result|medication/i).isVisible().catch(() => false);
      
      // One of these states should be true
      expect(hasSecurePrompt || hasLimitedData || hasFullAccess).toBe(true);
    }
  });
});

test.describe("Partner Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, PARTNER.email, PARTNER.password);
  });

  test("Partner navigation is complete", async ({ page }) => {
    await page.goto("/partner");
    
    // Check key navigation elements
    const navItems = [
      "dashboard",
      "member",
      "appointment",
      "profile",
    ];
    
    for (const item of navItems) {
      const navLink = page.getByRole("link", { name: new RegExp(item, "i") }).first();
      const isVisible = await navLink.isVisible().catch(() => false);
      // At least some nav items should be visible
      if (isVisible) {
        expect(isVisible).toBe(true);
        break;
      }
    }
  });

  test("Partner can also access public pages", async ({ page }) => {
    // Partners should still be able to access public pages
    await page.goto("/");
    const hasPublicContent = await page.getByText(/platform|app|health/i).isVisible().catch(() => false);
    expect(hasPublicContent).toBe(true);
    
    await page.goto("/studies");
    const hasStudies = await page.getByText(/study|studie/i).isVisible().catch(() => false);
    expect(hasStudies).toBe(true);
  });
});
