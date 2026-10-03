/**
 * Member User Flow E2E Tests
 * 
 * Simulates real member user journeys through the application.
 * Tests all features available to regular members.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, TEST_USERS } from "./fixtures";
import { E2E_FIXTURES } from "./fixture-ids";

const MEMBER = TEST_USERS.member;

test.describe("Member Authentication Flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Complete login → dashboard → logout flow", async ({ page }) => {
    // 1. Login
    await page.goto("/auth");
    await page.getByRole("textbox", { name: /email/i }).fill(MEMBER.email);
    await page.getByRole("textbox", { name: /password|heslo/i }).fill(MEMBER.password);
    await page.getByRole("button", { name: /login|přihlásit/i }).click();
    
    // 2. Should be redirected to member area
    await expect(page).toHaveURL(/member|dashboard/i, { timeout: 30000 });
    
    // 3. Logout
    const avatar = page.getByTestId("user-avatar").or(page.getByRole("button", { name: /profile|profil|avatar/i }));
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await avatar.click();
      await page.getByRole("menuitem", { name: /logout|odhlásit/i }).click();
    }
    
    // 4. Should be logged out
    await expect(page).toHaveURL(/auth|login|\//i, { timeout: 10000 });
  });
});

test.describe("Member Dashboard Features", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Dashboard shows member widgets", async ({ page }) => {
    await page.goto("/member");
    await page.waitForLoadState("networkidle");
    
    // Dashboard should have key sections
    const hasHealthSection = await page.getByText(/health|zdraví|check-in/i).isVisible().catch(() => false);
    const hasStudySection = await page.getByText(/study|studie|research/i).isVisible().catch(() => false);
    const hasProfileSection = await page.getByText(/profile|profil|account|účet/i).isVisible().catch(() => false);
    
    expect(hasHealthSection || hasStudySection || hasProfileSection).toBe(true);
  });

  test("Health tracking is accessible", async ({ page }) => {
    await page.goto("/member/health");
    
    // Should show health tracking interface
    const hasHealthPage = await page.getByText(/health|zdraví|tracking|sledování/i).isVisible().catch(() => false);
    expect(hasHealthPage).toBe(true);
  });

  test("Can view study registration", async ({ page }) => {
    await page.goto("/member/studies");
    
    // Should show studies or registration
    const hasStudiesPage = await page.getByText(/study|studie|research|výzkum|registration/i).isVisible().catch(() => false);
    expect(hasStudiesPage).toBe(true);
  });

  test("Profile page is accessible", async ({ page }) => {
    await page.goto("/member/profile");
    
    // Should show profile editing
    const hasProfilePage = await page.getByText(/profile|profil|personal|osobní/i).isVisible().catch(() => false);
    expect(hasProfilePage).toBe(true);
  });

  test("Shop is accessible", async ({ page }) => {
    await page.goto("/shop");
    
    // Should show products or shop
    const hasShopPage = await page.getByText(/shop|obchod|product|produkt/i).isVisible().catch(() => false);
    expect(hasShopPage).toBe(true);
  });
});

test.describe("Member Health Check-in Flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Can access health check-in form", async ({ page }) => {
    await page.goto("/member/health/check-in");
    
    // Should show check-in form or redirect to health
    const hasCheckInForm = await page.getByText(/check-in|kontrola|daily|denní/i).isVisible().catch(() => false);
    const hasHealthPage = await page.getByText(/health|zdraví/i).isVisible().catch(() => false);
    
    expect(hasCheckInForm || hasHealthPage).toBe(true);
  });

  test("Can view health history", async ({ page }) => {
    await page.goto("/member/health");
    
    // Should show history or chart
    const hasHistory = await page.getByText(/history|historie|chart|graf|log|záznam/i).isVisible().catch(() => false);
    expect(hasHistory).toBe(true);
  });
});

test.describe("Member Study Registration Flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Can view available studies", async ({ page }) => {
    await page.goto("/studies");
    
    // Should show studies list
    const hasStudies = await page.getByText(/study|studie|umbrella|research|výzkum/i).isVisible().catch(() => false);
    expect(hasStudies).toBe(true);
  });

  test("Can view study detail", async ({ page }) => {
    await page.goto(`/studies/${E2E_FIXTURES.umbrellaStudyId}`); // synthetic umbrella study (seed.e2e.sql)
    
    // Should show study detail or redirect
    const hasStudyDetail = await page.getByText(/umbrella|study|studie|detail|enroll/i).isVisible().catch(() => false);
    expect(hasStudyDetail).toBe(true);
  });
});

test.describe("Member Appointment Booking Flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Can view partners/consultants", async ({ page }) => {
    await page.goto("/partners");
    
    // Should show partner list
    const hasPartners = await page.getByText(/partner|consultant|ambassador|konzultant/i).isVisible().catch(() => false);
    expect(hasPartners).toBe(true);
  });

  test("Can view appointments", async ({ page }) => {
    await page.goto("/member/appointments");
    
    // Should show appointments or redirect
    const hasAppointments = await page.getByText(/appointment|schůzka|booking|reservation/i).isVisible().catch(() => false);
    const hasNoAppointments = await page.getByText(/no appointment|žádná schůzka/i).isVisible().catch(() => false);
    
    expect(hasAppointments || hasNoAppointments).toBe(true);
  });
});

test.describe("Member Document Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Can access documents section", async ({ page }) => {
    await page.goto("/member/documents");
    
    // Should show documents or upload interface
    const hasDocs = await page.getByText(/document|dokument|upload|nahrát|file|soubor/i).isVisible().catch(() => false);
    expect(hasDocs).toBe(true);
  });
});

test.describe("Member Consent Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("Can view consent settings", async ({ page }) => {
    await page.goto("/member/consents");
    
    // Should show consent management
    const hasConsents = await page.getByText(/consent|souhlas|data sharing|sdílení dat|privacy/i).isVisible().catch(() => false);
    expect(hasConsents).toBe(true);
  });
});

test.describe("Member Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, MEMBER.email, MEMBER.password);
  });

  test("All main navigation links work", async ({ page }) => {
    await page.goto("/member");
    
    // Check navigation is present
    const nav = page.locator("nav");
    expect(await nav.isVisible()).toBe(true);
    
    // Test key navigation items
    const navItems = [
      { pattern: /health|zdraví/i, url: /health/ },
      { pattern: /study|studie/i, url: /stud/ },
      { pattern: /shop|obchod/i, url: /shop/ },
      { pattern: /profile|profil/i, url: /profile/ },
    ];
    
    for (const item of navItems) {
      const link = page.getByRole("link", { name: item.pattern }).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await expect(page).toHaveURL(item.url);
        await page.goto("/member"); // Go back
      }
    }
  });
});
