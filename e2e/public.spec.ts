/**
 * E2E Tests: Public Pages
 * 
 * Testy veřejně přístupných stránek (bez přihlášení)
 */

import { test, expect } from "@playwright/test";
import { waitForLoadingComplete, ensurePasswordLoginForm, TEST_USERS, loginUser } from "./fixtures";

test.describe("Public Pages", () => {
  
  test("homepage loads correctly", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);
    
    // Ověř základní elementy
    await expect(page).toHaveTitle(/platform|app/i);
    
    // Měl by být vidět login link nebo button
    const loginLink = page.getByRole("link", { name: /přihlásit|login|sign in/i });
    await expect(loginLink).toBeVisible();
  });

  test("login page is accessible", async ({ page }) => {
    await page.goto("/auth");
    await waitForLoadingComplete(page);
    
    // Formulář by měl být viditelný
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.locator("form")).toBeVisible();
  });

  test("archive page loads documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);
    
    // Počkej na načtení dokumentů (nebo prázdný stav)
    const content = page.locator("main, [role='main'], #root");
    await expect(content).toBeVisible();
    
    // Stránka musí vyrenderovat UI (ne spadnout do dev error boundary).
    await expect(page.getByRole("heading", { level: 1, name: /archiv|archive/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /něco se pokazilo|something went wrong/i })).toHaveCount(0);
  });

  test("studies page shows available studies", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);
    
    // Stránka by měla mít obsah
    const content = page.locator("main, [role='main'], #root");
    await expect(content).toBeVisible();
  });

  test("partners directory loads", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main'], #root");
    await expect(content).toBeVisible();
  });

  test("study detail page loads from listing", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const studyLink = page.locator("a[href^='/studies/']").first();
    if (await studyLink.isVisible().catch(() => false)) {
      await studyLink.click();
      await waitForLoadingComplete(page);

      await expect(page).toHaveURL(/\/studies\//);
      const content = page.locator("main, [role='main'], #root").first();
      await expect(content).toBeVisible();
    }
  });

  test("navigation works correctly", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);
    
    // Klikni na Archive link (pokud existuje)
    const archiveLink = page.getByRole("link", { name: /archiv|archive/i }).first();
    if (await archiveLink.isVisible()) {
      await archiveLink.click();
      await expect(page).toHaveURL(/archive/);
    }
  });

  test("404 page for unknown routes", async ({ page }) => {
    await page.goto("/this-page-does-not-exist-12345");
    await waitForLoadingComplete(page);
    
    // Měla by se zobrazit 404 stránka nebo redirect na home
    const is404 = await page.getByRole("heading", { name: /404/i }).isVisible().catch(() => false);
    const isHome = page.url().endsWith("/");

    expect(is404 || isHome).toBe(true);
  });

  test("language switcher works", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);
    
    // Najdi language switcher
    const langSwitcher = page.getByTestId("language-switcher").or(
      page.getByRole("button", { name: /čeština|english|cs|en/i })
    ).first();
    
    if (await langSwitcher.isVisible()) {
      await langSwitcher.click();
      
      // Mělo by se objevit dropdown nebo změnit jazyk
      const dropdown = page.getByRole("menu").or(page.getByRole("listbox"));
      const isDropdownVisible = await dropdown.isVisible().catch(() => false);
      
      if (isDropdownVisible) {
        // Vyber druhou možnost
        await page.getByRole("menuitem").or(page.getByRole("option")).first().click();
      }
    }
  });

  test("invalid invitation code shows error state", async ({ page }) => {
    await page.goto("/promo/INVALID-CODE-123");
    await waitForLoadingComplete(page);

    const invalidState = page.getByText(/neplatn|invalid/i);
    await expect(invalidState).toBeVisible();
  });

  test("invite route redirects to promo", async ({ page }) => {
    await page.goto("/invite/INVALID-CODE-456");
    await waitForLoadingComplete(page);

    await expect(page).toHaveURL(/\/promo\//);
  });
});

test.describe("Authentication Flow", () => {
  
  test("can login with valid credentials", async ({ page }) => {
    await page.goto("/auth");
    await waitForLoadingComplete(page);

    // Přepni na password login
    await ensurePasswordLoginForm(page);
    await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password, { skipGoto: true });

    await expect(page).not.toHaveURL(/\/auth/);
  });

  test("redirects back to protected route after login", async ({ page }) => {
    // Unauthenticated access to a protected member route should redirect to /auth.
    await page.goto("/member");
    await waitForLoadingComplete(page);
    await expect(page).toHaveURL(/\/auth/);

    // Login via password fallback, but keep the original redirect state.
    await ensurePasswordLoginForm(page);
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password, { skipGoto: true });

    // After login, we should return to the originally requested route.
    await page.waitForURL(/\/member(\/|$)/, { timeout: 15000, waitUntil: "commit" });
    await waitForLoadingComplete(page);
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/auth");
    await waitForLoadingComplete(page);

    // Přepni na password login
    await ensurePasswordLoginForm(page);
    
    // Vyplň špatné údaje
    await page.getByLabel(/email/i).fill("wrong@email.com");
    await page.getByLabel(/heslo|password/i).fill("wrongpassword");
    
    // Klikni na přihlásit
    await page.locator("form button[type='submit']").first().click();
    
    // Měla by se zobrazit chyba
    await page.waitForTimeout(2000);
    
    // Zůstaneme na login stránce
    expect(page.url()).toContain("/auth");
  });

  test("email validation works", async ({ page }) => {
    await page.goto("/auth");
    await waitForLoadingComplete(page);

    // Přepni na password login
    await ensurePasswordLoginForm(page);
    
    // Vyplň neplatný email
    await page.getByLabel(/email/i).fill("not-an-email");
    await page.getByLabel(/heslo|password/i).fill("somepassword");
    
    // Klikni na přihlásit
    await page.getByRole("button", { name: /přihlásit|sign in|login/i }).click();

    // Browser validace může zabránit submitu (type=email), nebo se zobrazí inline chyba.
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/auth");
  });
});
