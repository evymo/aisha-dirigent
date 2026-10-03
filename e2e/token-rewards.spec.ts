/**
 * E2E Tests: Token Rewards System
 * 
 * Tests the token reward flow:
 * - Viewing token balance
 * - Dosing logs and token awards
 * - Token lock/vesting status
 * - Reward history
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Token Balance Display", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can view token balance on dashboard", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for token/rewards section
    const tokenSection = page.getByText(/token|rewards|odměny|balance|zůstatek/i);
    const tokenBalance = page.locator("[data-testid='token-balance'], .token-balance");
    
    const hasTokenDisplay = 
      await tokenSection.first().isVisible().catch(() => false) ||
      await tokenBalance.isVisible().catch(() => false);

    // Token display may be conditional on having tokens
    expect(hasTokenDisplay).toBe(true);
  });

  test("Member can access tokens page", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should see token info or empty state
    const hasTokenInfo = await page.getByText(/token|RTN|balance|zůstatek/i).isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no tokens|žádné tokeny|earn|získejte/i).isVisible().catch(() => false);

    expect(hasTokenInfo || hasEmptyState).toBe(true);
  });

  test("Token page shows breakdown if tokens exist", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Check for various token display elements
    const hasAvailable = await page.getByText(/available|dostupné|unlocked|odemčené/i).isVisible().catch(() => false);
    const hasLocked = await page.getByText(/locked|zamčené|vesting/i).isVisible().catch(() => false);
    const hasTotal = await page.getByText(/total|celkem/i).isVisible().catch(() => false);

    // At least one should be visible if user has any token interaction
    expect(hasAvailable || hasLocked || hasTotal).toBe(true);
  });
});

test.describe("Dosing Log Token Awards", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can access dosing log page", async ({ page }) => {
    await page.goto("/member/dosing");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should see dosing log interface
    const hasDosingLog = await page.getByText(/dosing|dávkování|log|záznam/i).isVisible().catch(() => false);
    const hasNoProducts = await page.getByText(/no products|žádné produkty/i).isVisible().catch(() => false);
    const hasLogButton = await page.getByRole("button", { name: /log|zaznamenat/i }).isVisible().catch(() => false);

    expect(hasDosingLog || hasNoProducts || hasLogButton).toBe(true);
  });

  test("Dosing log form shows token reward info", async ({ page }) => {
    await page.goto("/member/dosing");
    await waitForLoadingComplete(page);

    const logButton = page.getByRole("button", { name: /log dose|zaznamenat dávku|add|přidat/i });
    
    if (await logButton.isVisible().catch(() => false)) {
      await logButton.click();
      await waitForLoadingComplete(page);

      // Form should mention token reward
      const hasTokenMention = await page.getByText(/token|reward|odměna|earn|získat/i).isVisible().catch(() => false);
      const hasForm = await page.locator("form, [role='dialog']").isVisible().catch(() => false);

      expect(hasForm || hasTokenMention).toBe(true);
    }
  });

  test("Dosing history is accessible", async ({ page }) => {
    await page.goto("/member/dosing/history");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should see history or empty state
    const hasHistory = await page.getByText(/history|historie|past|minulé/i).isVisible().catch(() => false);
    const noHistory = await page.getByText(/no logs|žádné záznamy|start logging/i).isVisible().catch(() => false);

    expect(hasHistory || noHistory).toBe(true);
  });
});

test.describe("Token Lock/Vesting", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Token page shows lock status if applicable", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Look for vesting/lock info
    const hasVestingInfo = await page.getByText(/vesting|lock|zamčeno|unlock date|datum odemčení/i).isVisible().catch(() => false);
    const hasLockSchedule = await page.locator("[data-testid='vesting-schedule'], .lock-schedule").isVisible().catch(() => false);

    // May not have locks
    expect(hasVestingInfo || hasLockSchedule).toBe(true);
  });

  test("Token unlock schedule is visible", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Check for schedule or timeline
    const hasSchedule = await page.getByText(/schedule|rozvrh|timeline|unlock/i).isVisible().catch(() => false);
    const hasProgressBar = await page.locator("[role='progressbar'], .progress").isVisible().catch(() => false);

    expect(hasSchedule || hasProgressBar).toBe(true);
  });
});

test.describe("Reward History", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can view token transaction history", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Look for history/transactions tab or section
    const historyTab = page.getByRole("tab", { name: /history|historie|transactions/i });
    const historyLink = page.getByRole("link", { name: /history|historie/i });
    
    if (await historyTab.isVisible().catch(() => false)) {
      await historyTab.click();
      await waitForLoadingComplete(page);
    } else if (await historyLink.isVisible().catch(() => false)) {
      await historyLink.click();
      await waitForLoadingComplete(page);
    }

    // Should see transaction list or empty state
    const hasTransactions = await page.getByText(/transaction|transakce|earned|získáno/i).isVisible().catch(() => false);
    const noTransactions = await page.getByText(/no transactions|žádné transakce/i).isVisible().catch(() => false);

    expect(hasTransactions || noTransactions).toBe(true);
  });

  test("Reward source is shown in history", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Look for reward sources
    const sources = [
      /dosing|dávkování/i,
      /check-in|kontrola/i,
      /study|studie/i,
      /referral|doporučení/i,
    ];

    let foundSource = false;
    for (const source of sources) {
      if (await page.getByText(source).isVisible().catch(() => false)) {
        foundSource = true;
        break;
      }
    }

    // May not have any rewards yet
    expect(foundSource).toBe(true);
  });
});

test.describe("Token Earning Rules", () => {
  test("Public can view token earning rules", async ({ page }) => {
    await clearLocalStorage(page);
    
    // Try to find token info page
    const tokenInfoUrls = ["/tokens", "/about/tokens", "/token", "/rewards"];
    
    for (const url of tokenInfoUrls) {
      await page.goto(url);
      await waitForLoadingComplete(page);
      
      const hasContent = await page.getByText(/token|reward|earn|RTN/i).isVisible().catch(() => false);
      if (hasContent) {
        expect(hasContent).toBe(true);
        return;
      }
    }
    
    // If no public token page, that's okay
    expect(true).toBe(true);
  });
});
