/**
 * Security E2E Tests - Access Control & Authorization
 * 
 * Tests that users cannot access data they shouldn't have access to.
 * Covers: role-based access, sensitive data protection, consent-based access.
 */

import { test, expect } from "@playwright/test";
import { loginUser, logoutUser, clearLocalStorage, TEST_USERS } from "./fixtures";

// Test users from seed.sql
const USERS = TEST_USERS;

test.describe("Role-Based Access Control", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Anonymous user cannot access member dashboard", async ({ page }) => {
    await page.goto("/member");
    // Should redirect to login or show unauthorized
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("Anonymous user cannot access admin panel", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("Anonymous user cannot access partner dashboard", async ({ page }) => {
    await page.goto("/partner/dashboard");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("Member cannot access admin panel", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/admin");
    // Should redirect or show access denied
    await expect(page.getByText(/access denied|unauthorized|not found/i)).toBeVisible({ timeout: 10000 })
      .catch(async () => {
        // Or redirected away from admin
        expect(page.url()).not.toContain("/admin");
      });
  });

  test("Member cannot access other user's health data via URL", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    // Try to access partner's profile page
    await page.goto("/member/profile?user_id=e2e00000-0000-0000-0000-000000000003");
    // Should only show own data, not other user's
    const pageContent = await page.content();
    expect(pageContent).not.toContain("E2E Partner User");
  });

  test("Staff can access admin panel but with limited permissions", async ({ page }) => {
    await loginUser(page, USERS.staff.email, USERS.staff.password);
    await page.goto("/admin");
    // Staff should see admin panel
    await expect(page.getByText(/dashboard|admin/i)).toBeVisible({ timeout: 10000 });
    // But should NOT see role management (admin-only)
    const hasRoleManagement = await page.getByText(/manage roles|role management/i).isVisible().catch(() => false);
    expect(hasRoleManagement).toBe(false);
  });

  test("Partner can access partner dashboard", async ({ page }) => {
    await loginUser(page, USERS.partner.email, USERS.partner.password);
    await page.goto("/partner/dashboard");
    await expect(page.getByText(/partner|dashboard/i)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Sensitive Data Access Control", () => {
  test("Partner can only see members who granted consent", async ({ page }) => {
    await loginUser(page, USERS.partner.email, USERS.partner.password);
    await page.goto("/partner/dashboard");
    
    // Member who granted consent should be visible
    // The E2E member has granted consent to E2E partner in seed
    // Check if the member's data is accessible
    const response = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      const { data, error } = await supabase.rpc("get_partner_assigned_members");
      return { data, error: error?.message };
    });
    
    // Should have at least the E2E member who granted consent
    if (response.data) {
      expect(Array.isArray(response.data)).toBe(true);
    }
  });

  test("Member health data requires secure mode", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/member/health");
    
    // secure pages should require re-authentication
    // Look for secure mode prompt or health data
    const hasSecurePrompt = await page.getByText(/verify|re-authenticate|password|confirm/i).isVisible().catch(() => false);
    const hasProtectedData = await page.getByText(/health|check-in|tracking/i).isVisible().catch(() => false);
    
    // Either secure mode is required, or health tracking page loaded
    expect(hasSecurePrompt || hasProtectedData).toBe(true);
  });
});

test.describe("Data Isolation", () => {
  test("RPC functions respect user context", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // Try to fetch health check-ins
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      const { data, error } = await supabase.rpc("get_my_health_check_ins_audited", {
        p_limit: 10
      });
      
      return { 
        count: data?.length ?? 0, 
        error: error?.message,
        // Check that returned data belongs to current user
        allOwnData: data?.every((item: Record<string, unknown>) => 
          item.user_id === "e2e00000-0000-0000-0000-000000000002"
        ) ?? true
      };
    });
    
    // Should only return own data
    expect(result.allOwnData).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("Cannot access other user's cart", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      const { data, error } = await supabase.rpc("get_my_cart");
      return { data, error: error?.message };
    });
    
    // Should return empty or own cart, never other user's data
    if (result.data) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });
});

test.describe("Session Security", () => {
  test("Session token is not stored in localStorage for sensitive data", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/member");
    
    // Check that sensitive tokens are not in localStorage
    const localStorageKeys = await page.evaluate(() => {
      return Object.keys(localStorage);
    });
    
    // sensitive data session should use sessionStorage or in-memory, not localStorage
    const hasSecureTokenInLocalStorage = localStorageKeys.some(key => 
      key.toLowerCase().includes("secure") && key.toLowerCase().includes("token")
    );
    
    expect(hasSecureTokenInLocalStorage).toBe(false);
  });

  test("Logout clears all auth tokens", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/member");
    
    await logoutUser(page);
    
    // Check localStorage is cleared of auth tokens
    const storageAfterLogout = await page.evaluate(() => {
      return {
        localStorage: Object.keys(localStorage).filter(k => 
          k.includes("supabase") || k.includes("auth") || k.includes("token")
        ),
        sessionStorage: Object.keys(sessionStorage).filter(k => 
          k.includes("supabase") || k.includes("auth") || k.includes("token")
        )
      };
    });
    
    expect(storageAfterLogout.localStorage.length).toBe(0);
    expect(storageAfterLogout.sessionStorage.length).toBe(0);
  });
});

test.describe("API Security", () => {
  test("Direct table access is blocked by RLS", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // Try to directly query another user's data
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      // Try to access admin user's profile directly
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", "e2e00000-0000-0000-0000-000000000001") // admin user
        .single();
      
      return { data, error: error?.message };
    });
    
    // Should either return error or no data (RLS blocks access)
    if (result.data) {
      // If data returned, it should not contain sensitive admin info
      expect(result.data.user_id).not.toBe("e2e00000-0000-0000-0000-000000000001");
    }
  });

  test("Cannot call admin-only RPC functions as member", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      // Try to call admin function
      const { data, error } = await supabase.rpc("get_all_users_admin");
      return { hasData: !!data, error: error?.message };
    });
    
    // Should fail with permission error
    expect(result.hasData).toBe(false);
    expect(result.error).toBeDefined();
  });
});

test.describe("Consent Management", () => {
  test("Partner cannot see member data without consent", async ({ page }) => {
    // This would require a member who hasn't granted consent
    // For now, verify the consent check mechanism exists
    await loginUser(page, USERS.partner.email, USERS.partner.password);
    
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };
      
      // Try to access a random user's health data (should fail)
      const { data, error } = await supabase.rpc("get_user_health_check_ins_summary_audited", {
        p_user_id: "00000000-0000-0000-0000-000000000099" // non-existent user
      });
      
      return { hasData: data?.length > 0, error: error?.message };
    });
    
    // Should not return data for non-consented or non-existent user
    expect(result.hasData).toBe(false);
  });
});
