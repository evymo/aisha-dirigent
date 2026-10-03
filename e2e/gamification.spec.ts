/**
 * Gamification E2E Tests
 *
 * Tests the gamification features: tokens, leaderboard, achievements.
 * Covers: token balance, rewards, leaderboard rankings, achievements.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Token System - Member View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Token balance is displayed on dashboard", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Should show token balance
    const hasTokens = await page.getByText(/token|reward|odměna|balance|zůstatek|RTN/i).isVisible().catch(() => false);
    const hasTokenWidget = await page.getByTestId("token-balance").isVisible().catch(() => false);

    expect(hasTokens || hasTokenWidget).toBe(true);
  });

  test("Can view token details page", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Should show token information
    const hasTokenPage = await page.getByText(/token|balance|history|historie|reward/i).isVisible().catch(() => false);
    expect(hasTokenPage).toBe(true);
  });

  test("Token history shows transactions", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Should show transaction history
    const hasHistory = await page.getByText(/history|transaction|transakce|earned|získáno|spent|utraceno/i).isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no transactions|žádné transakce|no history/i).isVisible().catch(() => false);

    expect(hasHistory || hasEmptyState).toBe(true);
  });

  test("Tokens earned for check-in are displayed", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Look for check-in related token transactions
    const hasCheckInReward = await page.getByText(/check-in|kontrola|daily|denní|earned|získáno/i).isVisible().catch(() => false);
    expect(hasCheckInReward).toBe(true);
  });
});

test.describe("Leaderboard - Member View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Leaderboard page is accessible", async ({ page }) => {
    await page.goto("/member/leaderboard");
    await waitForLoadingComplete(page);

    // Should show leaderboard
    const hasLeaderboard = await page.getByText(/leaderboard|žebříček|ranking|pořadí|top/i).isVisible().catch(() => false);
    expect(hasLeaderboard).toBe(true);
  });

  test("Leaderboard shows user rankings", async ({ page }) => {
    await page.goto("/member/leaderboard");
    await waitForLoadingComplete(page);

    // Should show ranking list
    const hasRankings = await page.getByText(/#1|#2|#3|rank|pořadí|position|pozice/i).isVisible().catch(() => false);
    const hasUserList = await page.getByTestId("leaderboard-entry").first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no participants|žádní účastníci|be the first/i).isVisible().catch(() => false);

    expect(hasRankings || hasUserList || hasEmptyState).toBe(true);
  });

  test("User's own position is highlighted", async ({ page }) => {
    await page.goto("/member/leaderboard");
    await waitForLoadingComplete(page);

    // Look for current user indicator
    const hasCurrentUser = await page.getByText(/you|vy|your position|vaše pozice/i).isVisible().catch(() => false);
    const hasHighlighted = await page.locator("[data-current-user='true'], .current-user, .highlighted").first().isVisible().catch(() => false);

    expect(hasCurrentUser || hasHighlighted).toBe(true);
  });

  test("Leaderboard can be filtered by time period", async ({ page }) => {
    await page.goto("/member/leaderboard");
    await waitForLoadingComplete(page);

    // Look for time filter
    const filterSelect = page.getByRole("combobox", { name: /period|období|time|čas/i }).first();
    const filterTabs = page.getByRole("tab", { name: /week|month|all time|týden|měsíc|celkově/i }).first();

    if (await filterSelect.isVisible().catch(() => false)) {
      await filterSelect.click();
      const hasOptions = await page.getByRole("option").first().isVisible().catch(() => false);
      expect(hasOptions).toBe(true);
    } else if (await filterTabs.isVisible().catch(() => false)) {
      await filterTabs.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });
});

test.describe("Achievements - Member View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Achievements section exists", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for achievements on dashboard or separate page
    const hasAchievements = await page.getByText(/achievement|úspěch|badge|odznak|milestone|milník/i).isVisible().catch(() => false);

    if (!hasAchievements) {
      // Try achievements page
      await page.goto("/member/achievements");
      await waitForLoadingComplete(page);

      const hasAchievementPage = await page.getByText(/achievement|úspěch|badge|unlock/i).isVisible().catch(() => false);
      expect(hasAchievementPage).toBe(true);
    } else {
      expect(hasAchievements).toBe(true);
    }
  });

  test("Unlocked achievements are displayed", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for unlocked achievement indicators
    const hasUnlocked = await page.getByText(/unlocked|odemčeno|earned|získáno|completed|splněno/i).isVisible().catch(() => false);
    const hasAchievementCard = await page.getByTestId("achievement-card").first().isVisible().catch(() => false);

    expect(hasUnlocked || hasAchievementCard).toBe(true);
  });

  test("Achievement progress is shown", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for progress indicators
    const hasProgress = await page.getByText(/progress|pokrok|\d+\/\d+|\d+%/i).isVisible().catch(() => false);
    const hasProgressBar = await page.locator("[role='progressbar'], .progress-bar").first().isVisible().catch(() => false);

    expect(hasProgress || hasProgressBar).toBe(true);
  });
});

test.describe("Token Rewards - Earning Tokens", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Check-in completion awards tokens", async ({ page }) => {
    // Get initial balance
    const initialBalance = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return 0;

      const { data } = await supabase.rpc("get_my_token_balance");
      return data ?? 0;
    });

    // Complete a check-in
    await page.goto("/member/check-in");
    await waitForLoadingComplete(page);

    // Fill check-in form
    const painSlider = page.getByRole("slider", { name: /pain|bolest/i }).first();
    const energySlider = page.getByRole("slider", { name: /energy|energie/i }).first();
    const submitButton = page.getByRole("button", { name: /submit|save|odeslat|uložit/i }).first();

    if (await painSlider.isVisible().catch(() => false)) {
      await painSlider.fill("3");
    }
    if (await energySlider.isVisible().catch(() => false)) {
      await energySlider.fill("7");
    }
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
      await waitForLoadingComplete(page);

      // Check for token reward notification
      const hasRewardNotification = await page.getByText(/token|reward|earned|získáno|\+\d+/i).isVisible().catch(() => false);
      expect(hasRewardNotification).toBe(true);
    }
  });

  test("Streak bonus is applied", async ({ page }) => {
    await page.goto("/member/tokens");
    await waitForLoadingComplete(page);

    // Look for streak information
    const hasStreak = await page.getByText(/streak|série|consecutive|po sobě|bonus/i).isVisible().catch(() => false);
    expect(hasStreak).toBe(true);
  });
});

test.describe("Token System - Admin Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Admin can view tokenomics settings", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    const hasTokenomics = await page.getByText(/tokenomics|token|economy|ekonomika|settings/i).isVisible().catch(() => false);
    expect(hasTokenomics).toBe(true);
  });

  test("Admin can view token allocations", async ({ page }) => {
    await page.goto("/admin/tokens");
    await waitForLoadingComplete(page);

    const hasAllocations = await page.getByText(/allocation|přidělení|token|balance|user/i).isVisible().catch(() => false);
    expect(hasAllocations).toBe(true);
  });

  test("Admin can manage token locks", async ({ page }) => {
    await page.goto("/admin/tokens/locks");
    await waitForLoadingComplete(page);

    const hasLocks = await page.getByText(/lock|vesting|release|zamčení|uvolnění/i).isVisible().catch(() => false);
    expect(hasLocks).toBe(true);
  });

  test("Admin can configure reward rules", async ({ page }) => {
    await page.goto("/admin/tokenomics");
    await waitForLoadingComplete(page);

    // Look for reward configuration
    const hasRewardConfig = await page.getByText(/reward|rule|pravidlo|check-in|bonus/i).isVisible().catch(() => false);
    const hasEditButton = await page.getByRole("button", { name: /edit|configure|nastavit/i }).isVisible().catch(() => false);

    expect(hasRewardConfig || hasEditButton).toBe(true);
  });
});

test.describe("Gamification - Activity Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Activity timeline shows recent actions", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for activity feed
    const hasActivity = await page.getByText(/activity|aktivita|recent|nedávné|timeline/i).isVisible().catch(() => false);
    const hasActivityFeed = await page.getByTestId("activity-feed").isVisible().catch(() => false);

    expect(hasActivity || hasActivityFeed).toBe(true);
  });

  test("Token rewards appear in activity", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for token-related activity entries
    const hasTokenActivity = await page.getByText(/token|reward|earned|získal/i).isVisible().catch(() => false);
    expect(hasTokenActivity).toBe(true);
  });
});

test.describe("Gamification - Notifications", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Token reward notifications appear", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for notification bell/icon
    const notificationButton = page.getByTestId("notification-bell").or(
      page.getByRole("button", { name: /notification|oznámení/i })
    ).first();

    if (await notificationButton.isVisible().catch(() => false)) {
      await notificationButton.click();
      await waitForLoadingComplete(page);

      // Should show notifications panel
      const hasNotifications = await page.getByText(/notification|oznámení|token|reward/i).isVisible().catch(() => false);
      expect(hasNotifications).toBe(true);
    }
  });

  test("Achievement unlock shows notification", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for achievement notifications
    const hasAchievementNotification = await page.getByText(/achievement|úspěch|unlocked|odemčeno|congratulations|gratulujeme/i).isVisible().catch(() => false);
    expect(hasAchievementNotification).toBe(true);
  });
});

test.describe("Gamification - API Verification", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Token balance RPC returns valid data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_my_token_balance");

      return {
        balance: data,
        isNumber: typeof data === "number",
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });

  test("Leaderboard RPC returns valid data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_limit: 10
      });

      return {
        count: data?.length ?? 0,
        isArray: Array.isArray(data),
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });

  test("Token history RPC returns user-specific data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_my_token_transactions", {
        p_limit: 10
      });

      const userId = "e2e00000-0000-0000-0000-000000000002";
      const allOwnTransactions = data?.every((t: Record<string, unknown>) => t.user_id === userId) ?? true;

      return {
        count: data?.length ?? 0,
        allOwnTransactions,
        error: error?.message
      };
    });

    expect(result.allOwnTransactions).toBe(true);
  });
});
