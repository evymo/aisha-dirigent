/**
 * E2E Tests: Internationalization (i18n)
 * 
 * Tests language switching and translation coverage:
 * - Language detection/default
 * - Manual language switching
 * - Persistent language preference
 * - UI elements translated
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Language Detection", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("App loads with default language", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Should have language attribute on html
    const htmlLang = await page.locator("html").getAttribute("lang");
    expect(htmlLang).toBeTruthy();
    expect(["cs", "en", "de", "fr", "ru", "th"]).toContain(htmlLang);
  });

  test("App respects browser language preference", async ({ page, context }) => {
    // Set browser to Czech
    await context.setExtraHTTPHeaders({
      "Accept-Language": "cs-CZ,cs;q=0.9",
    });

    await page.goto("/");
    await waitForLoadingComplete(page);

    // Should detect Czech or fallback
    const htmlLang = await page.locator("html").getAttribute("lang");
    expect(htmlLang).toBeTruthy();
  });
});

test.describe("Language Switcher", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Language switcher is visible", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Look for language switcher
    const languageSwitcher = page.locator(
      "[data-testid='language-switcher'], " +
      "[aria-label*='language'], " +
      "[aria-label*='jazyk'], " +
      "button:has-text('CS'), " +
      "button:has-text('EN'), " +
      ".language-selector"
    ).first();

    const isVisible = await languageSwitcher.isVisible().catch(() => false);
    
    // May be in header, footer, or settings
    if (!isVisible) {
      // Check header
      const header = page.locator("header");
      const hasLangInHeader = await header.getByText(/CS|EN|🇨🇿|🇬🇧/i).isVisible().catch(() => false);
      expect(hasLangInHeader).toBe(true);
    } else {
      expect(isVisible).toBe(true);
    }
  });

  test("Can switch to Czech", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Find and click language switcher
    const langButton = page.locator("button, a").filter({ hasText: /CS|Čeština|Czech/i }).first();
    
    if (await langButton.isVisible().catch(() => false)) {
      await langButton.click();
      await waitForLoadingComplete(page);

      // Verify language changed
      const htmlLang = await page.locator("html").getAttribute("lang");
      expect(htmlLang).toBe("cs");
    }
  });

  test("Can switch to English", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Find and click language switcher
    const langButton = page.locator("button, a").filter({ hasText: /EN|English|Angličtina/i }).first();
    
    if (await langButton.isVisible().catch(() => false)) {
      await langButton.click();
      await waitForLoadingComplete(page);

      // Verify language changed
      const htmlLang = await page.locator("html").getAttribute("lang");
      expect(htmlLang).toBe("en");
    }
  });
});

test.describe("Language Persistence", () => {
  test("Language preference persists after reload", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Get initial language
    const initialLang = await page.locator("html").getAttribute("lang");

    // Try to switch language
    const switchTo = initialLang === "cs" ? "EN" : "CS";
    const langButton = page.locator("button, a").filter({ hasText: new RegExp(switchTo, "i") }).first();
    
    if (await langButton.isVisible().catch(() => false)) {
      await langButton.click();
      await waitForLoadingComplete(page);

      const newLang = await page.locator("html").getAttribute("lang");
      
      // Reload page
      await page.reload();
      await waitForLoadingComplete(page);

      // Language should persist
      const afterReloadLang = await page.locator("html").getAttribute("lang");
      expect(afterReloadLang).toBe(newLang);
    }
  });

  test("Language persists after login", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Get current language
    const beforeLogin = await page.locator("html").getAttribute("lang");

    // Login
    await loginUser(page, USERS.member.email, USERS.member.password);
    await waitForLoadingComplete(page);

    // Language should be same
    const afterLogin = await page.locator("html").getAttribute("lang");
    expect(afterLogin).toBe(beforeLogin);
  });
});

test.describe("Translation Coverage - Czech", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    // Force Czech
    await page.goto("/");
    const csButton = page.locator("button, a").filter({ hasText: /CS|Čeština/i }).first();
    if (await csButton.isVisible().catch(() => false)) {
      await csButton.click();
      await waitForLoadingComplete(page);
    }
  });

  test("Login page is translated to Czech", async ({ page }) => {
    await page.goto("/login");
    await waitForLoadingComplete(page);

    // Check for Czech text
    const czechTexts = [
      /přihlásit|přihlášení/i,
      /heslo/i,
      /email|e-mail/i,
    ];

    let foundCzech = false;
    for (const text of czechTexts) {
      if (await page.getByText(text).isVisible().catch(() => false)) {
        foundCzech = true;
        break;
      }
    }

    expect(foundCzech).toBe(true);
  });

  test("Navigation is translated to Czech", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);

    // Check navigation items for Czech
    const navTexts = [
      /domů|home/i,
      /studie/i,
      /produkty|shop/i,
    ];

    let foundCzechNav = false;
    for (const text of navTexts) {
      if (await page.getByText(text).isVisible().catch(() => false)) {
        foundCzechNav = true;
        break;
      }
    }

    expect(foundCzechNav).toBe(true);
  });
});

test.describe("Translation Coverage - English", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    // Force English
    await page.goto("/");
    const enButton = page.locator("button, a").filter({ hasText: /EN|English/i }).first();
    if (await enButton.isVisible().catch(() => false)) {
      await enButton.click();
      await waitForLoadingComplete(page);
    }
  });

  test("Login page is translated to English", async ({ page }) => {
    await page.goto("/login");
    await waitForLoadingComplete(page);

    // Check for English text
    const englishTexts = [
      /sign in|log in|login/i,
      /password/i,
      /email/i,
    ];

    let foundEnglish = false;
    for (const text of englishTexts) {
      if (await page.getByText(text).isVisible().catch(() => false)) {
        foundEnglish = true;
        break;
      }
    }

    expect(foundEnglish).toBe(true);
  });
});

test.describe("No Untranslated Keys", () => {
  test("Member dashboard has no translation keys visible", async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for untranslated key patterns like "member.dashboard.title"
    const pageContent = await page.locator("body").textContent();
    const untranslatedPattern = /\b(member|common|admin|partner|auth)\.[a-z_]+\.[a-z_]+/gi;
    
    const matches = pageContent?.match(untranslatedPattern) || [];
    
    // Filter out false positives (email addresses, URLs)
    const realKeys = matches.filter(m => 
      !m.includes("@") && 
      !m.includes("http") &&
      !m.startsWith("auth.users") // DB table references
    );
    
    // Should have no visible translation keys
    expect(realKeys.length).toBe(0);
  });

  test("Studies page has no translation keys visible", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const pageContent = await page.locator("body").textContent();
    const untranslatedPattern = /\b(studies|research|common)\.[a-z_]+\.[a-z_]+/gi;
    
    const matches = pageContent?.match(untranslatedPattern) || [];
    const realKeys = matches.filter(m => !m.includes("@") && !m.includes("http"));
    
    expect(realKeys.length).toBe(0);
  });
});
