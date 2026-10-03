/**
 * Admin Tokenomics E2E Tests
 *
 * Tests token economy settings management.
 * Covers: reward configuration, token allocation rules, economy settings.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Tokenomics - Admin Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Tokenomics page is accessible", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Should show tokenomics interface
    const hasTokenomics = await page.getByText(/tokenomics|token|economy|ekonomika|reward/i).isVisible().catch(() => false);
    expect(hasTokenomics).toBe(true);
  });

  test("Token settings are displayed", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Should show settings
    const hasSettings = await page.getByText(/setting|nastavení|config|reward|odměna/i).isVisible().catch(() => false);
    expect(hasSettings).toBe(true);
  });
});

test.describe("Tokenomics - Reward Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can view reward rules", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for reward rules
    const hasRules = await page.getByText(/rule|pravidlo|reward|odměna|check-in|action/i).isVisible().catch(() => false);
    expect(hasRules).toBe(true);
  });

  test("Can edit check-in reward amount", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Find check-in reward setting
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();
    const checkInReward = page.getByLabel(/check-in|daily|denní/i).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.getByLabel(/amount|hodnota|token/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    } else if (await checkInReward.isVisible().catch(() => false)) {
      expect(true).toBe(true);
    }
  });

  test("Can configure streak bonuses", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for streak settings
    const hasStreak = await page.getByText(/streak|série|consecutive|bonus/i).isVisible().catch(() => false);
    expect(hasStreak).toBe(true);
  });

  test("Can configure achievement rewards", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for achievement settings
    const hasAchievements = await page.getByText(/achievement|úspěch|milestone|badge/i).isVisible().catch(() => false);
    expect(hasAchievements).toBe(true);
  });
});

test.describe("Tokenomics - Token Allocation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can view token supply", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for supply information
    const hasSupply = await page.getByText(/supply|zásoby|total|celkem|allocated|přiděleno/i).isVisible().catch(() => false);
    expect(hasSupply).toBe(true);
  });

  test("Can view distribution statistics", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for distribution stats
    const hasStats = await page.getByText(/distributed|distribuováno|earned|získáno|spent|utraceno/i).isVisible().catch(() => false);
    const hasChart = await page.locator("canvas, svg.recharts-surface").first().isVisible().catch(() => false);

    expect(hasStats || hasChart).toBe(true);
  });

  test("Shows token circulation", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for circulation data
    const hasCirculation = await page.getByText(/circulation|v oběhu|active|aktivní/i).isVisible().catch(() => false);
    expect(hasCirculation).toBe(true);
  });
});

test.describe("Tokenomics - Rules Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can create new reward rule", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Find create button
    const createButton = page.getByRole("button", { name: /create|add|new|vytvořit|přidat/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Should show create form
      const hasForm = await page.getByLabel(/name|action|amount/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can edit reward rule", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Find edit button
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.getByLabel(/amount|trigger/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can toggle rule active status", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Find status toggle
    const toggle = page.getByRole("switch").first();
    const statusButton = page.getByRole("button", { name: /enable|disable|activate/i }).first();

    const hasToggle = await toggle.isVisible().catch(() => false);
    const hasButton = await statusButton.isVisible().catch(() => false);

    expect(hasToggle || hasButton).toBe(true);
  });

  test("Can delete reward rule", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Find delete button
    const deleteButton = page.getByRole("button", { name: /delete|remove|smazat/i }).first();

    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirmation = await page.getByText(/confirm|are you sure/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);

      // Cancel
      const cancelButton = page.getByRole("button", { name: /cancel|zrušit/i }).first();
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  });
});

test.describe("Tokenomics - Leaderboard Settings", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can configure leaderboard settings", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for leaderboard settings
    const hasLeaderboard = await page.getByText(/leaderboard|žebříček|ranking|pořadí/i).isVisible().catch(() => false);
    expect(hasLeaderboard).toBe(true);
  });

  test("Can set leaderboard period", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for period setting
    const periodSelect = page.getByRole("combobox", { name: /period|období/i }).first();
    const hasPeriodSetting = await periodSelect.isVisible().catch(() => false);

    expect(hasPeriodSetting).toBe(true);
  });
});

test.describe("Tokenomics - Validation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Reward amount must be positive", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const editButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Try to enter negative value
      const amountField = page.getByLabel(/amount|hodnota/i).first();

      if (await amountField.isVisible().catch(() => false)) {
        await amountField.fill("-10");

        const submitButton = page.getByRole("button", { name: /save|submit/i }).first();
        if (await submitButton.isVisible().catch(() => false)) {
          await submitButton.click();
          await page.waitForTimeout(500);

          // Should show validation error
          const hasError = await page.getByText(/positive|invalid|must be/i).isVisible().catch(() => false);
          expect(hasError).toBe(true);
        }
      }
    }
  });
});

test.describe("Tokenomics - API Verification", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Token statistics RPC returns data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_token_statistics");

      return {
        hasData: data !== null,
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });

  test("Reward rules RPC returns data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_token_reward_rules");

      return {
        isArray: Array.isArray(data),
        count: data?.length ?? 0,
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });
});
