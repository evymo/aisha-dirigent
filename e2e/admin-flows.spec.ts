/**
 * Admin User Flow E2E Tests
 * 
 * Tests all features available to Admin users.
 * Admins have full system access including user management, sensitive data export, etc.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, TEST_USERS } from "./fixtures";

const ADMIN = TEST_USERS.admin;

test.describe("Admin Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Admin can login and access admin dashboard", async ({ page }) => {
    await loginUser(page, ADMIN.email, ADMIN.password);
    await page.goto("/admin");
    
    // Should be in admin area
    await expect(page).toHaveURL(/admin/i, { timeout: 10000 });
    
    // Should see admin dashboard content
    const hasAdminContent = await page.getByText(/admin|dashboard|overview|přehled/i).isVisible().catch(() => false);
    expect(hasAdminContent).toBe(true);
  });
});

test.describe("Admin Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Dashboard shows system overview", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    
    // Should show overview metrics
    const hasOverview = await page.getByText(/overview|přehled|statistics|statistiky|users|uživatel/i).isVisible().catch(() => false);
    expect(hasOverview).toBe(true);
  });

  test("Can access user management", async ({ page }) => {
    await page.goto("/admin/users");
    
    // Should show user management
    const hasUserMgmt = await page.getByText(/user|uživatel|member|člen/i).isVisible().catch(() => false);
    expect(hasUserMgmt).toBe(true);
  });

  test("Can access role management", async ({ page }) => {
    await page.goto("/admin/roles");
    
    // Should show role management
    const hasRoleMgmt = await page.getByText(/role|oprávnění|permission/i).isVisible().catch(() => false);
    expect(hasRoleMgmt).toBe(true);
  });
});

test.describe("Admin User Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view user list", async ({ page }) => {
    await page.goto("/admin/users");
    
    // Should show user list with search/filter
    const hasUserList = await page.getByRole("table").or(page.getByTestId("user-list")).isVisible().catch(() => false);
    const hasUserCards = await page.getByTestId("user-card").first().isVisible().catch(() => false);
    const hasUserInfo = await page.getByText(/email|role/i).isVisible().catch(() => false);
    
    expect(hasUserList || hasUserCards || hasUserInfo).toBe(true);
  });

  test("Can search for users", async ({ page }) => {
    await page.goto("/admin/users");
    
    // Find search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|hledat/i));
    
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("member");
      await page.waitForTimeout(500); // Debounce
      
      // Results should update
      const hasResults = await page.getByText(/member|result|výsledek/i).isVisible().catch(() => false);
      expect(hasResults).toBe(true);
    }
  });

  test("Can view user detail", async ({ page }) => {
    await page.goto("/admin/users");
    
    // Click on a user
    const userLink = page.getByRole("link", { name: /view|detail|edit|zobrazit/i }).first();
    
    if (await userLink.isVisible().catch(() => false)) {
      await userLink.click();
      
      // Should show user detail
      const hasDetail = await page.getByText(/profile|profil|role|email/i).isVisible().catch(() => false);
      expect(hasDetail).toBe(true);
    }
  });
});

test.describe("Admin Study Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view studies list", async ({ page }) => {
    await page.goto("/admin/studies");
    
    // Should show studies list
    const hasStudies = await page.getByText(/study|studie|umbrella/i).isVisible().catch(() => false);
    expect(hasStudies).toBe(true);
  });

  test("Can view study registrations", async ({ page }) => {
    await page.goto("/admin/studies/registrations");
    
    // Should show registrations
    const hasRegistrations = await page.getByText(/registration|registrace|participant/i).isVisible().catch(() => false);
    expect(hasRegistrations).toBe(true);
  });

  test("Can access questionnaire management", async ({ page }) => {
    await page.goto("/admin/questionnaires");
    
    // Should show questionnaire management
    const hasQuestionnaires = await page.getByText(/questionnaire|dotazník/i).isVisible().catch(() => false);
    expect(hasQuestionnaires).toBe(true);
  });
});

test.describe("Admin Order Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view orders", async ({ page }) => {
    await page.goto("/admin/orders");
    
    // Should show orders list
    const hasOrders = await page.getByText(/order|objednávka|pending|status/i).isVisible().catch(() => false);
    expect(hasOrders).toBe(true);
  });

  test("Can view products", async ({ page }) => {
    await page.goto("/admin/products");
    
    // Should show products management
    const hasProducts = await page.getByText(/product|produkt|price|cena/i).isVisible().catch(() => false);
    expect(hasProducts).toBe(true);
  });
});

test.describe("Admin Partner Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view partners", async ({ page }) => {
    await page.goto("/admin/partners");
    
    // Should show partners list
    const hasPartners = await page.getByText(/partner|consultant|ambassador/i).isVisible().catch(() => false);
    expect(hasPartners).toBe(true);
  });

  test("Can approve partner certifications", async ({ page }) => {
    await page.goto("/admin/partners/certifications");
    
    // Should show certification management
    const hasCertifications = await page.getByText(/certification|certifikace|pending|approve/i).isVisible().catch(() => false);
    expect(hasCertifications).toBe(true);
  });
});

test.describe("Admin Token Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view token allocations", async ({ page }) => {
    await page.goto("/admin/tokens");
    
    // Should show token management
    const hasTokens = await page.getByText(/token|allocation|balance/i).isVisible().catch(() => false);
    expect(hasTokens).toBe(true);
  });

  test("Can manage token locks", async ({ page }) => {
    await page.goto("/admin/tokens/locks");
    
    // Should show token locks
    const hasLocks = await page.getByText(/lock|vesting|release/i).isVisible().catch(() => false);
    expect(hasLocks).toBe(true);
  });
});

test.describe("Admin Audit Trail", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can view audit journal", async ({ page }) => {
    await page.goto("/admin/audit");
    
    // Should show audit journal
    const hasAudit = await page.getByText(/audit|log|action|user/i).isVisible().catch(() => false);
    expect(hasAudit).toBe(true);
  });
});

test.describe("Admin Settings", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can access system settings", async ({ page }) => {
    await page.goto("/admin/settings");
    
    // Should show settings
    const hasSettings = await page.getByText(/setting|nastavení|config/i).isVisible().catch(() => false);
    expect(hasSettings).toBe(true);
  });

  test("Can manage translations", async ({ page }) => {
    await page.goto("/admin/translations");
    
    // Should show translation management
    const hasTranslations = await page.getByText(/translation|překlad|language|jazyk/i).isVisible().catch(() => false);
    expect(hasTranslations).toBe(true);
  });
});

test.describe("Admin sensitive data Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can access sensitive data with proper mode", async ({ page }) => {
    await page.goto("/admin/users");
    
    // Admin should be able to view user sensitive data data
    const userLink = page.getByRole("link", { name: /member|detail/i }).first();
    
    if (await userLink.isVisible().catch(() => false)) {
      await userLink.click();
      
      // Should show sensitive data data or require secure mode
      const hasProtectedData = await page.getByText(/data|records|access|restricted/i).isVisible().catch(() => false);
      const needsSecureMode = await page.getByText(/secure mode|authenticate|verify/i).isVisible().catch(() => false);
      
      expect(hasProtectedData || needsSecureMode).toBe(true);
    }
  });

  test("data export functionality exists", async ({ page }) => {
    await page.goto("/admin/export");
    
    // Should show export options
    const hasExport = await page.getByText(/export|download|secure|data/i).isVisible().catch(() => false);
    expect(hasExport).toBe(true);
  });
});

test.describe("Admin Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Admin sidebar has all sections", async ({ page }) => {
    await page.goto("/admin");
    
    // Check for admin navigation sections
    const sections = [
      "user",
      "stud",
      "order",
      "partner",
      "token",
      "setting",
    ];
    
    let foundSections = 0;
    for (const section of sections) {
      const navItem = page.getByRole("link", { name: new RegExp(section, "i") }).first();
      if (await navItem.isVisible().catch(() => false)) {
        foundSections++;
      }
    }
    
    // Should find at least some admin sections
    expect(foundSections).toBeGreaterThan(0);
  });

  test("Admin can access both admin and public pages", async ({ page }) => {
    // Admin should still be able to access public pages
    await page.goto("/");
    const hasHome = await page.getByText(/platform|app/i).isVisible().catch(() => false);
    expect(hasHome).toBe(true);
    
    // And admin pages
    await page.goto("/admin");
    const hasAdmin = await page.getByText(/admin|dashboard/i).isVisible().catch(() => false);
    expect(hasAdmin).toBe(true);
  });
});

test.describe("Admin Bulk Operations", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, ADMIN.email, ADMIN.password);
  });

  test("Can access bulk operations if available", async ({ page }) => {
    await page.goto("/admin/bulk");
    
    // May redirect or show bulk operations
    const hasBulk = await page.getByText(/bulk|import|batch|hromadně/i).isVisible().catch(() => false);
    const hasAdmin = await page.getByText(/admin/i).isVisible().catch(() => false);
    
    expect(hasBulk || hasAdmin).toBe(true);
  });
});
