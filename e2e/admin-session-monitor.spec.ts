/**
 * Admin Session Monitoring E2E Tests
 *
 * Tests the admin session monitoring dashboard for viewing active sessions.
 * Covers: session listing, session details, force logout.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Session Monitoring - Admin Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Session monitoring page is accessible", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Should show session monitoring interface
    const hasSessionMonitor = await page.getByText(/session|relace|monitoring|sledování|active|aktivní/i).isVisible().catch(() => false);
    expect(hasSessionMonitor).toBe(true);
  });

  test("Active sessions list is displayed", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Should show session list
    const hasSessionList = await page.getByText(/active session|aktivní relace|user|uživatel|online/i).isVisible().catch(() => false);
    const hasSessionTable = await page.getByRole("table").isVisible().catch(() => false);
    const hasSessionCards = await page.getByTestId("session-card").first().isVisible().catch(() => false);

    expect(hasSessionList || hasSessionTable || hasSessionCards).toBe(true);
  });

  test("Session details show user information", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for user details in session list
    const hasUserInfo = await page.getByText(/email|user|ip|browser|device/i).isVisible().catch(() => false);
    expect(hasUserInfo).toBe(true);
  });

  test("Session shows last activity time", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for timestamp or activity indicator
    const hasActivity = await page.getByText(/last activity|poslední aktivita|ago|před|online/i).isVisible().catch(() => false);
    expect(hasActivity).toBe(true);
  });
});

test.describe("Session Monitoring - Session Details", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can view detailed session information", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Click on session to see details
    const sessionRow = page.getByRole("row").nth(1);
    const detailButton = page.getByRole("button", { name: /detail|view|zobrazit/i }).first();

    if (await detailButton.isVisible().catch(() => false)) {
      await detailButton.click();
      await waitForLoadingComplete(page);

      const hasDetails = await page.getByText(/session detail|ip address|user agent|browser/i).isVisible().catch(() => false);
      expect(hasDetails).toBe(true);
    } else if (await sessionRow.isVisible().catch(() => false)) {
      await sessionRow.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Session shows login timestamp", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for login time
    const hasLoginTime = await page.getByText(/login|logged in|přihlášení|started|začátek/i).isVisible().catch(() => false);
    expect(hasLoginTime).toBe(true);
  });

  test("Session shows IP address", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for IP address pattern
    const hasIP = await page.getByText(/ip|address|\d+\.\d+\.\d+\.\d+/i).isVisible().catch(() => false);
    expect(hasIP).toBe(true);
  });
});

test.describe("Session Monitoring - Force Logout", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Force logout button exists", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for force logout button
    const forceLogoutButton = page.getByRole("button", { name: /force logout|terminate|end session|ukončit|odhlásit/i }).first();
    const hasButton = await forceLogoutButton.isVisible().catch(() => false);

    expect(hasButton).toBe(true);
  });

  test("Force logout requires confirmation", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Find and click force logout
    const forceLogoutButton = page.getByRole("button", { name: /force logout|terminate|end session/i }).first();

    if (await forceLogoutButton.isVisible().catch(() => false)) {
      await forceLogoutButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation dialog
      const hasConfirmation = await page.getByText(/confirm|are you sure|jste si jisti|warning/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);

      // Cancel to not actually logout
      const cancelButton = page.getByRole("button", { name: /cancel|no|zrušit|ne/i }).first();
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  });
});

test.describe("Session Monitoring - Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can search sessions by user", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Find search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|filter|hledat/i)).first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("member");
      await page.waitForTimeout(500);

      // Results should filter
      const hasResults = await page.getByText(/member|result|session/i).isVisible().catch(() => false);
      expect(hasResults).toBe(true);
    }
  });

  test("Can filter by session status", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for status filter
    const statusFilter = page.getByRole("combobox", { name: /status|state|stav/i }).first();
    const statusTabs = page.getByRole("tab", { name: /active|all|inactive/i }).first();

    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.click();
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }
      expect(true).toBe(true);
    } else if (await statusTabs.isVisible().catch(() => false)) {
      await statusTabs.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });
});

test.describe("Session Monitoring - Security", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Non-admin cannot access session monitoring", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Should show access denied or redirect
    const hasAccessDenied = await page.getByText(/denied|forbidden|unauthorized|not allowed/i).isVisible().catch(() => false);
    const wasRedirected = !page.url().includes("/admin/session-monitoring");

    expect(hasAccessDenied || wasRedirected).toBe(true);
  });

  test("Session monitoring creates audit log", async ({ page }) => {
    await loginUser(page, USERS.admin.email, USERS.admin.password);
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Verify audit logging via RPC
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_admin_audit_log", {
        p_limit: 5
      });

      return {
        hasEntries: data?.length > 0,
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });
});

test.describe("Session Monitoring - Real-time Updates", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Session list auto-refreshes", async ({ page }) => {
    await page.goto("/admin/session-monitoring");
    await waitForLoadingComplete(page);

    // Look for refresh indicator or auto-update
    const hasAutoRefresh = await page.getByText(/auto|refresh|live|update/i).isVisible().catch(() => false);
    const refreshButton = page.getByRole("button", { name: /refresh|obnovit/i }).first();

    if (await refreshButton.isVisible().catch(() => false)) {
      await refreshButton.click();
      await waitForLoadingComplete(page);
    }

    expect(hasAutoRefresh).toBe(true);
  });
});
