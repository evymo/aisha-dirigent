/**
 * Authentication Setup
 * 
 * Vytváří authenticated session pro všechny test role:
 * - admin: Full system access (admin@platform.rtn)
 * - member: Regular user (member@platform.rtn)
 * - partner: Production provider (partner@platform.rtn)
 * 
 * Běží jako "setup" projekt před ostatními testy.
 */

import { test as setup, expect, Page } from "@playwright/test";
import { AUTH_FILES, TEST_USERS, loginUser } from "./fixtures";

/**
 * Accept Terms of Service consent gate if displayed after login.
 * TermsConsentGate is an inline React component (not a separate route)
 * that blocks /member/* routes until data_processing consent is granted.
 * Uses Radix Checkbox with id="terms-consent-gate".
 */
async function acceptTosIfPresent(page: Page) {
  const checkbox = page.locator('#terms-consent-gate');
  const hasTos = await checkbox.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!hasTos) return;

  console.log('📋 TOS consent gate detected — accepting…');

  // Click the Radix Checkbox (role="checkbox")
  await checkbox.click({ timeout: 5_000 });

  // Click "Pokračovat" / "Continue" button (enabled after checkbox)
  const continueBtn = page.locator(
    'button:has-text("Pokračovat"), button:has-text("Continue")',
  ).first();
  await continueBtn.click({ timeout: 5_000 });

  // Wait for TOS gate to disappear (inline component, same URL)
  await checkbox.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

async function authenticateAndSave(page: Page, role: keyof typeof TEST_USERS, authFile: string) {
  const user = TEST_USERS[role];
  console.log(`🔐 Authenticating as ${user.role}`);

  await loginUser(page, user.email, user.password);

  // loginUser creates a Keycloak-backed oidc-client-ts storage state and redirects from /auth.

  // Accept Terms of Service if required for this user
  await acceptTosIfPresent(page);

  // Ensure we're on a real page (not auth/tos)
  await expect(page).not.toHaveURL(/\/auth/);

  // Save full session state (cookies + localStorage with OIDC user + compatibility bearer token)
  await page.context().storageState({ path: authFile });
  console.log(`✅ ${role} auth saved to ${authFile}`);
}

// ============================================================================
// ADMIN AUTH SETUP
// ============================================================================
setup("authenticate as admin", async ({ page }) => {
  await authenticateAndSave(page, "admin", AUTH_FILES.admin);
});

// ============================================================================
// MEMBER AUTH SETUP
// ============================================================================
setup("authenticate as member", async ({ page }) => {
  await authenticateAndSave(page, "member", AUTH_FILES.member);
});

// ============================================================================
// PARTNER AUTH SETUP
// ============================================================================
setup("authenticate as partner", async ({ page }) => {
  await authenticateAndSave(page, "partner", AUTH_FILES.partner);
});
