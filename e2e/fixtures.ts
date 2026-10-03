/**
 * E2E Test Fixtures & Utilities
 * 
 * Rozšiřuje základní Playwright test o:
 * - Autentizované page objekty pro různé role
 * - Helper funkce pro Keycloak/OIDC session state
 * - Utility pro čekání na loading states
 * 
 * Role:
 * - admin: Plný přístup, admin dashboard
 * - member: Běžný člen, vlastní data
 * - partner: Production provider, přístup k pacientům
 * - public: Neautorizovaný uživatel (žádná session)
 */

import { test as base, expect, Page } from "@playwright/test";

// Auth state file paths
export const AUTH_FILES = {
  admin: "e2e/.auth/admin.json",
  member: "e2e/.auth/member.json",
  partner: "e2e/.auth/partner.json",
};

// Test user credentials
export const TEST_USERS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? "admin@platform.rtn",
    password: process.env.E2E_ADMIN_PASSWORD ?? "Admin123!",
    role: "admin" as const,
    description: "Full system administrator",
  },
  staff: {
    email: process.env.E2E_STAFF_EMAIL ?? "staff@platform.rtn",
    password: process.env.E2E_STAFF_PASSWORD ?? "Staff123!",
    role: "staff" as const,
    description: "Limited admin staff",
  },
  member: {
    email: process.env.E2E_MEMBER_EMAIL ?? "member@platform.rtn",
    password: process.env.E2E_MEMBER_PASSWORD ?? "Member123!",
    role: "member" as const,
    description: "Regular platform user",
  },
  partner: {
    email: process.env.E2E_PARTNER_EMAIL ?? "partner@platform.rtn",
    password: process.env.E2E_PARTNER_PASSWORD ?? "Partner123!",
    role: "practitioner" as const,
    description: "Production provider / Partner",
  },
};

export type TestUserRole = keyof typeof TEST_USERS;

type OidcProfile = Record<string, unknown> & {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  id_token?: string;
  "not-before-policy"?: number;
  session_state?: string;
  scope?: string;
}

interface KeycloakConfig {
  authority: string;
  clientId: string;
  clientSecret?: string;
}

interface E2EAuthState {
  storageKey: string;
  oidcUserJson: string;
  accessToken: string;
}

const readNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const [, payload] = token.split(".");
  if (!payload) return {};

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return asRecord(JSON.parse(decoded)) ?? {};
  } catch {
    return {};
  }
};

const resolveKeycloakConfig = (): KeycloakConfig => {
  const kcUrl = readNonEmptyString(process.env.E2E_KC_URL)
    ?? readNonEmptyString(process.env.VITE_KC_URL)
    ?? "http://127.0.0.1:8080";
  const realm = readNonEmptyString(process.env.KEYCLOAK_REALM) ?? "aisha";
  const authority = readNonEmptyString(process.env.E2E_KC_AUTHORITY)
    ?? readNonEmptyString(process.env.VITE_KC_AUTHORITY)
    ?? `${kcUrl.replace(/\/$/, "")}/realms/${realm}`;

  return {
    authority,
    clientId:
      readNonEmptyString(process.env.E2E_KC_CLIENT_ID)
      ?? readNonEmptyString(process.env.VITE_KC_CLIENT_ID)
      ?? "aisha-app",
    clientSecret:
      readNonEmptyString(process.env.E2E_KC_CLIENT_SECRET)
      ?? readNonEmptyString(process.env.KC_CLIENT_SECRET),
  };
};

const parseTokenResponse = (body: unknown): KeycloakTokenResponse => {
  const record = asRecord(body);
  const accessToken = readNonEmptyString(record?.access_token);
  const expiresIn = typeof record?.expires_in === "number" ? record.expires_in : undefined;

  if (!record || !accessToken || !expiresIn) {
    throw new Error("Keycloak token response is missing access_token or expires_in.");
  }

  return {
    access_token: accessToken,
    expires_in: expiresIn,
    refresh_expires_in: typeof record.refresh_expires_in === "number" ? record.refresh_expires_in : undefined,
    refresh_token: readNonEmptyString(record.refresh_token),
    token_type: readNonEmptyString(record.token_type),
    id_token: readNonEmptyString(record.id_token),
    "not-before-policy": typeof record["not-before-policy"] === "number" ? record["not-before-policy"] : undefined,
    session_state: readNonEmptyString(record.session_state),
    scope: readNonEmptyString(record.scope),
  };
};

const getTokenErrorText = async (response: Response): Promise<string> => {
  try {
    const body = asRecord(await response.json());
    const error = readNonEmptyString(body?.error);
    const description = readNonEmptyString(body?.error_description);
    return [error, description].filter(Boolean).join(" - ");
  } catch {
    return response.statusText;
  }
};

async function requestKeycloakPasswordToken(
  email: string,
  password: string,
  config: KeycloakConfig,
): Promise<KeycloakTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: config.clientId,
    username: email,
    password,
    scope: "openid profile email",
  });
  if (config.clientSecret) {
    params.set("client_secret", config.clientSecret);
  }

  const tokenUrl = `${config.authority.replace(/\/$/, "")}/protocol/openid-connect/token`;
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Keycloak is not reachable at ${tokenUrl}. Start the local Keycloak stack or set E2E_KC_AUTHORITY. Cause: ${message}`,
    );
  }

  if (!response.ok) {
    const details = await getTokenErrorText(response);
    throw new Error(
      `Keycloak password grant failed: status=${response.status}${details ? ` details=${details}` : ""}`,
    );
  }

  return parseTokenResponse(await response.json());
}

const buildOidcProfile = (token: KeycloakTokenResponse): OidcProfile => {
  const claims = decodeJwtPayload(token.id_token ?? token.access_token);
  const sub = readNonEmptyString(claims.sub);
  if (!sub) throw new Error("Keycloak token does not contain a subject claim.");

  return {
    ...claims,
    sub,
    email: readNonEmptyString(claims.email),
    email_verified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
    preferred_username: readNonEmptyString(claims.preferred_username),
    name: readNonEmptyString(claims.name),
    given_name: readNonEmptyString(claims.given_name),
    family_name: readNonEmptyString(claims.family_name),
    picture: readNonEmptyString(claims.picture),
  };
};

async function createKeycloakAuthState(email: string, password: string): Promise<E2EAuthState> {
  const config = resolveKeycloakConfig();
  const token = await requestKeycloakPasswordToken(email, password, config);
  const profile = buildOidcProfile(token);
  const issuedAt = Math.floor(Date.now() / 1000);
  const oidcUser = {
    id_token: token.id_token,
    session_state: token.session_state,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type ?? "Bearer",
    scope: token.scope ?? "openid profile email",
    profile,
    expires_at: issuedAt + token.expires_in,
  };

  return {
    storageKey: `oidc.user:${config.authority}:${config.clientId}`,
    oidcUserJson: JSON.stringify(oidcUser),
    accessToken: token.access_token,
  };
}

const defaultPathForEmail = (email: string): string => {
  const user = Object.values(TEST_USERS).find((candidate) => candidate.email === email);
  if (user?.role === "admin" || user?.role === "staff") return "/admin";
  if (user?.role === "partner" || user?.role === "practitioner") return "/partner";
  return "/member";
};

async function installAuthState(page: Page, authState: E2EAuthState) {
  if (page.url() === "about:blank") {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  }

  await page.evaluate((state) => {
    window.localStorage.setItem(state.storageKey, state.oidcUserJson);
    window.localStorage.setItem("aisha-e2e-auth-token", state.accessToken);
    // Compatibility for older E2E helpers that only need a bearer token string.
    window.localStorage.setItem("sb-e2e-auth-token", state.accessToken);
  }, authState);
}

// Custom test fixture s helper metodami
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  // Authenticated page fixture
   
  authenticatedPage: async ({ page }, runTest) => {
    // Načti uloženou session a spusť test
    await runTest(page);
  },
});

// Re-export expect
export { expect };

/**
 * Helper: Počkej na dokončení loading state
 */
export async function waitForLoadingComplete(page: Page) {
  // Počkej až zmizí loading spinner
  await page.waitForSelector('[data-testid="loading"]', { state: "hidden", timeout: 10000 }).catch(() => {});
  // Počkej na network idle
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

/**
 * Helper: Přepni na password fallback login (pokud je potřeba)
 */
export async function ensurePasswordLoginForm(page: Page) {
  // Počkej na stabilizaci stránky
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);

  // Dismiss consent banner if present (blocks click on elements below)
  const consentBtn = page.locator(
    'button:has-text("ROZUMÍM A SOUHLASÍM"), button:has-text("Souhlasím"), button:has-text("Accept")',
  ).first();
  const hasConsent = await consentBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (hasConsent) {
    await consentBtn.click();
    await page.waitForTimeout(300);
  }
  
  const passwordInput = page.locator('input[type="password"], input[name="password"], #password').first();
  const hasPassword = await passwordInput.isVisible().catch(() => false);

  if (!hasPassword) {
    // Button text: "Přihlásit se heslem" / "Sign in with password"
    const fallbackButton = page.locator(
      'button:has-text("heslem"), button:has-text("password"), button:has-text("heslo")',
    ).first();
    // Počkej na stabilní stav tlačítka — may need to scroll down past social buttons
    try {
      await fallbackButton.scrollIntoViewIfNeeded({ timeout: 5000 });
      await fallbackButton.waitFor({ state: "visible", timeout: 5000 });
      await fallbackButton.click({ timeout: 5000 });
    } catch {
      // Tlačítko neexistuje nebo se změnilo - to je OK pokud password input je viditelný
    }
  }

  await passwordInput.waitFor({ state: "visible", timeout: 5000 });
}

/**
 * Helper: Přihlášení uživatele
 */
export async function loginUser(
  page: Page,
  email: string,
  password: string,
  options?: { skipGoto?: boolean }
) {
  const authState = await createKeycloakAuthState(email, password);
  const targetPath = defaultPathForEmail(email);

  if (!options?.skipGoto || page.url() === "about:blank") {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  }

  await installAuthState(page, authState);

  const currentPath = new URL(page.url()).pathname;
  if (!options?.skipGoto || currentPath.startsWith("/auth")) {
    await page.goto(targetPath);
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  await page.waitForFunction(
    (storageKey) => Boolean(window.localStorage.getItem(storageKey)),
    authState.storageKey,
    { timeout: 20_000 },
  );
}

/**
 * Helper: Odhlášení uživatele
 */
export async function logoutUser(page: Page) {
  // Klikni na user menu
  await page.getByTestId("user-menu").click().catch(async () => {
    // Fallback - hledej podle aria
    await page.getByRole("button", { name: /profil|account|menu/i }).click();
  });
  
  // Klikni na odhlásit
  await page.getByRole("menuitem", { name: /odhlásit|logout|sign out/i }).click();
  
  // Počkej na redirect na login
  await page.waitForURL(/\/(login|\/)/, { timeout: 10000 });
}

/**
 * Helper: Vyčisti session + localStorage
 */
export async function clearLocalStorage(page: Page) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Helper: Ověř toast notifikaci
 */
export async function expectToast(page: Page, textPattern: RegExp | string) {
  const toast = page.locator('[role="status"], [data-sonner-toast], .toast, [class*="toast"]');
  await expect(toast.filter({ hasText: textPattern })).toBeVisible({ timeout: 5000 });
}

/**
 * Helper: Vyplň formulář podle field names
 */
export async function fillForm(page: Page, fields: Record<string, string>) {
  for (const [name, value] of Object.entries(fields)) {
    const input = page.locator(`[name="${name}"], [id="${name}"]`).first();
    await input.fill(value);
  }
}

/**
 * Helper: Klikni na button a počkej na response
 */
export async function clickAndWaitForResponse(
  page: Page, 
  buttonSelector: string, 
  urlPattern: RegExp
) {
  const responsePromise = page.waitForResponse(urlPattern);
  await page.click(buttonSelector);
  return responsePromise;
}

/**
 * Helper: Screenshot pro debug
 */
export async function debugScreenshot(page: Page, name: string) {
  await page.screenshot({ 
    path: `e2e/screenshots/debug-${name}-${Date.now()}.png`,
    fullPage: true 
  });
}
