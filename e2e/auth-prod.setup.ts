/**
 * Production Auth Setup — UI-based login (PKCE flow)
 *
 * Differs from auth.setup.ts (which uses ROPC password grant):
 *  - Production aisha-app client has directAccessGrantsEnabled=false
 *    (security best practice — ROPC bypasses 2FA/CAPTCHA)
 *  - This setup performs a REAL browser login via the Keycloak login page
 *    so it works against production unmodified
 *
 * Required env vars:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *   E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD (optional — skips if missing)
 *   E2E_PARTNER_EMAIL, E2E_PARTNER_PASSWORD (optional — skips if missing)
 *
 * Run via:
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
 *     npx playwright test --config=playwright.prod.config.ts \
 *     --project=setup
 */
import { test as setup, expect, Page } from "@playwright/test";

const AUTH_DIR = "e2e/.auth";

interface UserConfig {
  role: "admin" | "member" | "partner";
  email: string | undefined;
  password: string | undefined;
  storageFile: string;
}

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD;
const PARTNER_EMAIL = process.env.E2E_PARTNER_EMAIL;
const PARTNER_PASSWORD = process.env.E2E_PARTNER_PASSWORD;

const USERS: UserConfig[] = [
  {
    role: "admin",
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    storageFile: `${AUTH_DIR}/admin.json`,
  },
  {
    role: "member",
    email: MEMBER_EMAIL,
    password: MEMBER_PASSWORD,
    storageFile: `${AUTH_DIR}/member.json`,
  },
  {
    role: "partner",
    email: PARTNER_EMAIL,
    password: PARTNER_PASSWORD,
    storageFile: `${AUTH_DIR}/partner.json`,
  },
];

/**
 * Performs Keycloak browser-based login via PKCE auth code flow.
 *
 * Flow:
 *  1. Navigate to /auth — SPA initiates KC redirect via oidc-client-ts
 *  2. Land on ${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth
 *  3. Fill #username + #password (KC default login.ftl form)
 *  4. Submit; KC redirects back to ${APP_DOMAIN}/auth/callback?code=...
 *  5. SPA's callback handler exchanges code for tokens
 *  6. Save full session storage state (cookies + localStorage)
 */
async function loginViaKeycloakUI(page: Page, email: string, password: string): Promise<void> {
  // Step 1: trigger PKCE redirect by visiting the protected /auth route
  await page.goto("/auth");
  await page.waitForLoadState("domcontentloaded");

  // Dismiss cookie/consent banner if present (would block clicks below)
  const consentBtn = page.locator(
    'button:has-text("ROZUMÍM A SOUHLASÍM"), button:has-text("Souhlasím"), button:has-text("Accept")',
  ).first();
  if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await consentBtn.click();
    await page.waitForTimeout(300);
  }

  // The SPA may render its own auth wrapper before redirecting to KC. Look
  // for a "Sign in with password" / "Přihlásit heslem" button to trigger
  // the KC redirect, OR wait for the URL to change to KC host.
  const passwordFallbackBtn = page.locator(
    'button:has-text("Přihlásit"), button:has-text("Sign in"), button:has-text("Continue with password"), button:has-text("Pokračovat heslem")',
  ).first();

  if (await passwordFallbackBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await passwordFallbackBtn.click();
  }

  // Step 2: wait for KC login page (URL host change) OR KC form on same page
  await page.waitForURL(/auth\.backend\.id3a\.cz/, { timeout: 20_000 }).catch(() => {});

  // KC default login form: #username + #password + #kc-login button
  const usernameInput = page.locator('#username, input[name="username"]').first();
  const passwordInput = page.locator('#password, input[name="password"]').first();
  const submitBtn = page.locator('#kc-login, button[type="submit"]').first();

  await usernameInput.waitFor({ state: "visible", timeout: 20_000 });
  await usernameInput.fill(email);

  // Some KC themes have separate steps for username then password
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Pokračovat")').first();
  if (await passwordInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await passwordInput.fill(password);
  } else if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await continueBtn.click();
    await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
    await passwordInput.fill(password);
  } else {
    await passwordInput.fill(password);
  }

  await submitBtn.click();

  // Step 3: wait for redirect back to app
  await page.waitForURL(/web\.aisha\.guru\//, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");

  // Step 4: post-login terms-of-service consent gate (if shown)
  const termsCheckbox = page.locator("#terms-consent-gate");
  if (await termsCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    await termsCheckbox.click();
    const tosBtn = page
      .locator('button:has-text("Pokračovat"), button:has-text("Continue")')
      .first();
    await tosBtn.click().catch(() => {});
    await termsCheckbox.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }

  // Step 5: ensure we're past /auth (auth completed)
  await expect(page).not.toHaveURL(/\/auth(\/|$)/);
}

for (const u of USERS) {
  setup(`authenticate as ${u.role} (${u.email ?? "skipped"})`, async ({ page }) => {
    setup.skip(!u.email || !u.password, `${u.role}: missing E2E_${u.role.toUpperCase()}_EMAIL or _PASSWORD`);

    if (!u.email || !u.password) return;

    console.log(`🔐 Logging in as ${u.role}: ${u.email}`);
    await loginViaKeycloakUI(page, u.email, u.password);

    // Save the post-login storage state
    await page.context().storageState({ path: u.storageFile });
    console.log(`✅ ${u.role} auth saved to ${u.storageFile}`);
  });
}
