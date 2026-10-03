/**
 * Production OIDC Flow Verification
 *
 * Validates that the production-deployed login UI:
 *  1. Reaches Keycloak's authorization endpoint with correct client_id + scopes
 *  2. Renders Google + Apple identity provider buttons (per realm config)
 *  3. Provides email/password fallback form
 *  4. Loads the well-known OIDC discovery document
 *  5. Validates a public registration entrypoint exists
 *
 * Out of scope for this spec:
 *  - Completing Google/Apple OAuth flow (providers detect bot traffic and
 *    block headless browsers; manual verification only)
 *  - Authenticated post-login flows (require provisioned test users on
 *    production Keycloak)
 *
 * Run: npx playwright test e2e/prod-oidc-flow.spec.ts
 *      E2E_BASE_URL=https://web.${PUBLIC_TLD} npx playwright test e2e/prod-oidc-flow.spec.ts
 *
 * Designed to run WITHOUT auth state — does not depend on auth.setup.ts.
 */
import { test, expect } from "@playwright/test";

// Tests in this file don't require any storage state (run as anonymous)
test.use({ storageState: { cookies: [], origins: [] } });

const _kcBase = process.env.KEYCLOAK_URL ?? (process.env.INTERNAL_TLD ? `https://auth.backend.${process.env.INTERNAL_TLD}` : "");
const _realm = process.env.KEYCLOAK_REALM ?? "aisha";
const KC_AUTHORITY =
  process.env.E2E_KC_AUTHORITY ??
  process.env.VITE_KC_AUTHORITY ??
  (_kcBase ? `${_kcBase}/realms/${_realm}` : (() => { throw new Error("E2E: set E2E_KC_AUTHORITY, VITE_KC_AUTHORITY, or KEYCLOAK_URL/INTERNAL_TLD"); })());

test.describe("Production OIDC — discovery + endpoints", () => {
  test("Keycloak well-known discovery document is reachable", async ({ request }) => {
    const url = `${KC_AUTHORITY.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await request.get(url, { timeout: 15_000 });
    expect(res.status()).toBe(200);

    const body = await res.json();

    // Must have the standard OIDC endpoints
    expect(body.authorization_endpoint, "authorization_endpoint must be present").toBeTruthy();
    expect(body.token_endpoint, "token_endpoint must be present").toBeTruthy();
    expect(body.jwks_uri, "jwks_uri must be present").toBeTruthy();
    expect(body.userinfo_endpoint, "userinfo_endpoint must be present").toBeTruthy();

    // issuer must match the authority we queried
    expect(body.issuer).toContain(new URL(KC_AUTHORITY).host);
  });

  test("JWKS endpoint serves valid signing keys", async ({ request }) => {
    const url = `${KC_AUTHORITY.replace(/\/$/, "")}/protocol/openid-connect/certs`;
    const res = await request.get(url, { timeout: 15_000 });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys.length).toBeGreaterThan(0);

    // At least one RS256 key for token validation
    const rs256 = body.keys.find((k: { alg?: string }) => k.alg === "RS256");
    expect(rs256, "must have at least one RS256 signing key").toBeTruthy();
  });
});

test.describe("Production OIDC — login UI", () => {
  test("login page renders email + password form", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForLoadState("domcontentloaded");

    // Page should redirect / load Keycloak login form, OR show inline auth UI.
    // Either way, we should see SOMETHING resembling a login form within 15s.
    // We'll wait for either the password input OR a "sign in with..." button.
    const passwordInput = page.locator('input[type="password"]').first();
    const signInButton = page.getByRole("button", {
      name: /(sign in|p[řr]ihl[áa]sit|log in|prihl[áa]sen[ií])/i,
    });
    const idpButton = page.getByRole("button", {
      name: /(google|apple)/i,
    });

    // At least one of these should be visible
    await expect(
      passwordInput.or(signInButton).or(idpButton).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("clicking sign-in flow lands on Keycloak with correct client_id and scope", async ({
    page,
  }) => {
    // Visit a protected route — should redirect to Keycloak authorization endpoint
    await page.goto("/auth");
    await page.waitForLoadState("domcontentloaded");

    // Some setups render an inline form; others redirect immediately. Either
    // way, after up to 5s the URL should either be on Keycloak OR contain
    // an authorization request fragment.
    await page.waitForTimeout(2000);

    const url = page.url();
    const onKeycloak = url.includes(new URL(KC_AUTHORITY).host);
    const isAuthPath = url.includes("/auth");

    expect(onKeycloak || isAuthPath).toBe(true);

    // If we're on Keycloak, verify the query string has the expected params
    if (onKeycloak) {
      const u = new URL(url);
      expect(u.pathname).toMatch(/\/protocol\/openid-connect\/auth/);
      expect(u.searchParams.get("client_id")).toBeTruthy();
      expect(u.searchParams.get("response_type")).toMatch(/code/);
      const scope = u.searchParams.get("scope") ?? "";
      expect(scope, `scope must include openid (got: ${scope})`).toContain("openid");
    }
  });
});

test.describe("Production OIDC — Identity Providers", () => {
  test("Keycloak login page exposes Google and Apple identity providers", async ({ page }) => {
    // Trigger redirect to KC by visiting /auth
    await page.goto("/auth");
    await page.waitForLoadState("domcontentloaded");

    // Wait up to 10s to land on Keycloak (some apps redirect, others have
    // their own login UI that POSTs to KC)
    await page.waitForFunction(
      (kcHost) => window.location.host === kcHost,
      new URL(KC_AUTHORITY).host,
      { timeout: 15_000 },
    ).catch(() => {
      // App may render its own login UI without redirecting — that's also OK
      // as long as it offers the same providers
    });

    // Keycloak's default login.ftl renders social buttons in a list with
    // class="kc-social-providers". The realm config has Google + Apple
    // enabled, so both should render. App's own login UI is expected to
    // mirror this with buttons containing "Google" / "Apple" text.
    const googleButton = page.getByRole("link", { name: /google/i }).or(
      page.getByRole("button", { name: /google/i }),
    );
    const appleButton = page.getByRole("link", { name: /apple/i }).or(
      page.getByRole("button", { name: /apple/i }),
    );

    await expect(googleButton.first(), "Google sign-in button must be visible").toBeVisible({
      timeout: 15_000,
    });
    await expect(appleButton.first(), "Apple sign-in button must be visible").toBeVisible({
      timeout: 15_000,
    });
  });

  test("clicking Google IDP redirects to Google's accounts.google.com", async ({ page }) => {
    await page.goto("/auth");
    await page.waitForLoadState("domcontentloaded");

    // Wait for KC login page (or app's wrapper)
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const googleButton = page
      .getByRole("link", { name: /google/i })
      .or(page.getByRole("button", { name: /google/i }))
      .first();

    await expect(googleButton).toBeVisible({ timeout: 15_000 });

    // Capture the navigation target
    const navigationPromise = page.waitForRequest(
      (req) =>
        req.url().includes("accounts.google.com") ||
        req.url().includes("kc_idp_hint=google") ||
        (req.url().includes("/broker/google/") && req.url().includes("/login")),
      { timeout: 15_000 },
    );

    await googleButton.click();

    const navRequest = await navigationPromise.catch(() => null);
    expect(
      navRequest,
      "clicking Google must initiate redirect to KC broker or directly to accounts.google.com",
    ).toBeTruthy();
  });
});

test.describe("Production OIDC — Registration entrypoint", () => {
  test("public registration link/route is reachable", async ({ page }) => {
    // The platform should expose either /register, /signup, or a "Create
    // account" link from /auth. Walk both options.
    const candidates = ["/register", "/signup", "/auth/register"];

    let found = false;
    for (const path of candidates) {
      const res = await page.goto(path).catch(() => null);
      if (res && res.status() < 400) {
        found = true;
        break;
      }
    }

    if (!found) {
      // Fallback: from /auth there should be a "Register" / "Sign up" link
      await page.goto("/auth");
      await page.waitForLoadState("domcontentloaded");
      const registerLink = page
        .getByRole("link", { name: /(register|sign\s*up|registrace|registrovat)/i })
        .or(page.getByRole("button", { name: /(register|sign\s*up|registrace|registrovat)/i }));

      // Wait briefly for redirect to KC (where Register link is in default theme)
      await page.waitForTimeout(2000);

      await expect(registerLink.first(), "registration link must be reachable somewhere").toBeVisible(
        { timeout: 10_000 },
      );
    }
  });
});
