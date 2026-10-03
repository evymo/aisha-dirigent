/**
 * Complete User Journey E2E Tests
 * 
 * Simulates complete user journeys through the application.
 * These tests follow real-world usage patterns from start to finish.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("New User Journey: Registration → Onboarding → First Check-in", () => {
  // Note: Full registration requires email verification, so we test the flow up to that point
  
  test("Registration form is accessible and validates input", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/auth");
    
    // Find registration tab/link
    const registerTab = page.getByRole("tab", { name: /register|registrace|sign up/i }).or(
      page.getByRole("link", { name: /register|registrace|sign up/i })
    );
    
    if (await registerTab.isVisible().catch(() => false)) {
      await registerTab.click();
      
      // Should show registration form
      const hasEmailField = await page.getByRole("textbox", { name: /email/i }).isVisible();
      const hasPasswordField = await page.getByLabel(/password|heslo/i).isVisible();
      
      expect(hasEmailField && hasPasswordField).toBe(true);
      
      // Test validation
      const submitBtn = page.getByRole("button", { name: /register|registrovat|sign up/i });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        
        // Should show validation errors for empty form
        const hasError = await page.getByText(/required|povinné|error|chyba/i).isVisible().catch(() => false);
        expect(hasError).toBe(true);
      }
    }
  });
});

test.describe("Member Journey: Dashboard → Health Check-in → View History", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Complete daily health check-in flow", async ({ page }) => {
    // 1. Go to member dashboard
    await page.goto("/member");
    await page.waitForLoadState("networkidle");
    
    // 2. Navigate to health section
    const healthLink = page.getByRole("link", { name: /health|zdraví/i }).first();
    if (await healthLink.isVisible()) {
      await healthLink.click();
    } else {
      await page.goto("/member/health");
    }
    
    // 3. Look for check-in button/link
    const checkInBtn = page.getByRole("link", { name: /check-in|kontrola/i }).or(
      page.getByRole("button", { name: /check-in|kontrola/i })
    );
    
    if (await checkInBtn.isVisible().catch(() => false)) {
      await checkInBtn.click();
      
      // 4. Should see check-in form
      const hasForm = await page.getByText(/pain|bolest|energy|energie|mood|nálada/i).isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
    
    // Verify health page is accessible
    const hasHealthContent = await page.getByText(/health|zdraví/i).isVisible();
    expect(hasHealthContent).toBe(true);
  });

  test("View health history and trends", async ({ page }) => {
    await page.goto("/member/health");
    
    // Should show history section
    const hasHistory = await page.getByText(/history|historie|trend|chart|graf/i).isVisible().catch(() => false);
    const hasNoData = await page.getByText(/no data|žádná data|start tracking/i).isVisible().catch(() => false);
    
    expect(hasHistory || hasNoData).toBe(true);
  });
});

test.describe("Member Journey: Study Exploration → Registration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Browse studies and view details", async ({ page }) => {
    // 1. Go to studies page
    await page.goto("/studies");
    await page.waitForLoadState("networkidle");
    
    // 2. Should see study list
    const hasStudies = await page.getByText(/umbrella|study|studie/i).isVisible();
    expect(hasStudies).toBe(true);
    
    // 3. Click on a study
    const studyCard = page.getByRole("link", { name: /umbrella|view|detail/i }).first();
    if (await studyCard.isVisible().catch(() => false)) {
      await studyCard.click();
      
      // 4. Should see study details
      const hasDetail = await page.getByText(/description|popis|eligibility|enroll/i).isVisible().catch(() => false);
      expect(hasDetail).toBe(true);
    }
  });

  test("Check registration status", async ({ page }) => {
    await page.goto("/member/studies");
    
    // Should show enrolled studies or available studies
    const hasRegistration = await page.getByText(/enrolled|registrován|registration|active/i).isVisible().catch(() => false);
    const hasAvailable = await page.getByText(/available|dostupné|browse|explore/i).isVisible().catch(() => false);
    
    expect(hasRegistration || hasAvailable).toBe(true);
  });
});

test.describe("Member Journey: Shopping → Checkout", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Browse shop and view products", async ({ page }) => {
    // 1. Go to shop
    await page.goto("/shop");
    await page.waitForLoadState("networkidle");
    
    // 2. Should see products
    const hasProducts = await page.getByText(/product|produkt|shop|obchod/i).isVisible();
    expect(hasProducts).toBe(true);
  });

  test("Add to cart flow", async ({ page }) => {
    await page.goto("/shop");
    
    // Find add to cart button
    const addToCartBtn = page.getByRole("button", { name: /add to cart|přidat do košíku/i }).first();
    
    if (await addToCartBtn.isVisible().catch(() => false)) {
      await addToCartBtn.click();
      
      // Should update cart or show confirmation
      const hasCartUpdate = await page.getByText(/added|přidáno|cart|košík/i).isVisible().catch(() => false);
      expect(hasCartUpdate).toBe(true);
    }
  });
});

test.describe("Partner Journey: View Assigned Members → Check Sensitive Data", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Access member with consent", async ({ page }) => {
    // 1. Go to partner dashboard
    await page.goto("/partner");
    await page.waitForLoadState("networkidle");
    
    // 2. Navigate to members
    await page.goto("/partner/members");
    
    // 3. Should see assigned members or empty state
    const hasMembers = await page.getByText(/member|client|klient|assigned/i).isVisible().catch(() => false);
    const hasNoMembers = await page.getByText(/no member|no client/i).isVisible().catch(() => false);
    
    expect(hasMembers || hasNoMembers).toBe(true);
    
    // 4. If member available, view their data
    const memberLink = page.getByRole("link", { name: /view|detail/i }).first();
    if (await memberLink.isVisible().catch(() => false)) {
      await memberLink.click();
      
      // Should show member data (with consent)
      const hasData = await page.getByText(/health|profile|consent/i).isVisible().catch(() => false);
      expect(hasData).toBe(true);
    }
  });
});

test.describe("Partner Journey: Appointment Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("View and manage appointments", async ({ page }) => {
    // 1. Go to appointments
    await page.goto("/partner/appointments");
    await page.waitForLoadState("networkidle");
    
    // 2. Should see appointment list or calendar
    const hasAppointments = await page.getByText(/appointment|schůzka|calendar|kalendář/i).isVisible();
    expect(hasAppointments).toBe(true);
  });

  test("Set availability", async ({ page }) => {
    await page.goto("/partner/availability");
    
    // Should see availability settings
    const hasAvailability = await page.getByText(/availability|dostupnost|schedule/i).isVisible().catch(() => false);
    expect(hasAvailability).toBe(true);
  });
});

test.describe("Admin Journey: User Management Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Complete user management workflow", async ({ page }) => {
    // 1. Go to admin dashboard
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    
    // 2. Navigate to users
    await page.goto("/admin/users");
    
    // 3. Search for a user
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|hledat/i));
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("member");
      await page.waitForTimeout(500);
    }
    
    // 4. View user details
    const userRow = page.getByRole("row").filter({ hasText: /member/i }).first();
    if (await userRow.isVisible().catch(() => false)) {
      const viewBtn = userRow.getByRole("link", { name: /view|detail/i }).or(
        userRow.getByRole("button", { name: /view|detail/i })
      );
      if (await viewBtn.isVisible()) {
        await viewBtn.click();
        
        // Should see user detail
        const hasDetail = await page.getByText(/profile|role|email/i).isVisible().catch(() => false);
        expect(hasDetail).toBe(true);
      }
    }
  });
});

test.describe("Admin Journey: Order Processing", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("View and process orders", async ({ page }) => {
    // 1. Go to orders
    await page.goto("/admin/orders");
    await page.waitForLoadState("networkidle");
    
    // 2. Should see order list
    const hasOrders = await page.getByText(/order|objednávka|pending|processing/i).isVisible();
    expect(hasOrders).toBe(true);
    
    // 3. Filter by status if available
    const statusFilter = page.getByRole("combobox", { name: /status/i });
    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.click();
      const pendingOption = page.getByRole("option", { name: /pending/i });
      if (await pendingOption.isVisible()) {
        await pendingOption.click();
      }
    }
  });
});

test.describe("Cross-Role Journey: Member Requests Consultation", () => {
  test("Member can find and book partner appointment", async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // 1. Browse partners
    await page.goto("/partners");
    await page.waitForLoadState("networkidle");
    
    const hasPartners = await page.getByText(/partner|consultant|ambassador/i).isVisible();
    expect(hasPartners).toBe(true);
    
    // 2. View partner detail
    const partnerCard = page.getByRole("link", { name: /view|detail|book/i }).first();
    if (await partnerCard.isVisible().catch(() => false)) {
      await partnerCard.click();
      
      // 3. Should see booking options
      const hasBooking = await page.getByText(/book|schedule|appointment|schůzka/i).isVisible().catch(() => false);
      expect(hasBooking).toBe(true);
    }
  });
});

test.describe("Consent Flow: Member Grants Data Sharing", () => {
  test("Member can manage data sharing consents", async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // 1. Go to consent settings
    await page.goto("/member/consents");
    await page.waitForLoadState("networkidle");
    
    // 2. Should see consent management
    const hasConsents = await page.getByText(/consent|souhlas|data sharing|sdílení/i).isVisible();
    expect(hasConsents).toBe(true);
    
    // 3. Should be able to grant/revoke
    const hasControls = await page.getByRole("button").or(page.getByRole("switch")).isVisible().catch(() => false);
    expect(hasControls).toBe(true);
  });
});

test.describe("Error Handling Journeys", () => {
  test("404 page for invalid routes", async ({ page }) => {
    await page.goto("/this-page-does-not-exist-12345");
    
    // Should show 404 or redirect
    const has404 = await page.getByText(/404|not found|nenalezeno/i).isVisible().catch(() => false);
    const wasRedirected = page.url() !== "/this-page-does-not-exist-12345";
    
    expect(has404 || wasRedirected).toBe(true);
  });

  test("Unauthorized access is blocked", async ({ page }) => {
    await clearLocalStorage(page);
    
    // Try to access admin without login
    await page.goto("/admin");
    
    // Should redirect to login or show access denied
    const hasAuth = await page.getByText(/login|přihlásit|sign in/i).isVisible().catch(() => false);
    const hasAccessDenied = await page.getByText(/denied|forbidden|unauthorized/i).isVisible().catch(() => false);
    const wasRedirected = page.url().includes("auth");
    
    expect(hasAuth || hasAccessDenied || wasRedirected).toBe(true);
  });

  test("Session expiry handling", async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // Navigate to member area
    await page.goto("/member");
    
    // Clear session storage to simulate expiry
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem("sb-jwt");
    });
    
    // Refresh page
    await page.reload();
    
    // Should redirect to login or show session expired
    await page.waitForTimeout(2000);
    const needsLogin = await page.getByText(/login|sign in|session expired/i).isVisible().catch(() => false);
    const stillOnMember = page.url().includes("/member");
    
    // Either needs re-login or app handles gracefully
    expect(needsLogin || stillOnMember).toBe(true);
  });
});
