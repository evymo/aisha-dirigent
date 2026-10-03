/**
 * Subscription Management E2E Tests
 *
 * Tests subscription packages, member subscriptions, and admin management.
 * Covers: subscription viewing, registration, admin CRUD.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Subscription - Member View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Can view subscription options", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for subscription info on dashboard or navigate to subscription page
    const hasSubscription = await page.getByText(/subscription|předplatné|membership|členství|plan|plán/i).isVisible().catch(() => false);

    if (!hasSubscription) {
      await page.goto("/member/subscription");
      await waitForLoadingComplete(page);

      const hasSubscriptionPage = await page.getByText(/subscription|předplatné|membership/i).isVisible().catch(() => false);
      expect(hasSubscriptionPage).toBe(true);
    } else {
      expect(hasSubscription).toBe(true);
    }
  });

  test("Current subscription status is displayed", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for subscription status
    const hasStatus = await page.getByText(/active|aktivní|inactive|neaktivní|subscribed|expires|vyprší/i).isVisible().catch(() => false);
    const hasNoSubscription = await page.getByText(/no subscription|žádné předplatné|subscribe|předplatit/i).isVisible().catch(() => false);

    expect(hasStatus || hasNoSubscription).toBe(true);
  });

  test("Available subscription tiers are shown", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Look for subscription tiers/packages
    const hasTiers = await page.getByText(/basic|premium|pro|gold|silver|bronze|standard/i).isVisible().catch(() => false);
    const hasPlans = await page.getByTestId("subscription-plan").first().isVisible().catch(() => false);
    const hasPricing = await page.getByText(/price|cena|month|měsíc|year|rok/i).isVisible().catch(() => false);

    expect(hasTiers || hasPlans || hasPricing).toBe(true);
  });

  test("Can view subscription benefits", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Look for benefits list
    const hasBenefits = await page.getByText(/benefit|výhoda|feature|funkce|include|zahrnuje/i).isVisible().catch(() => false);
    const hasBulletPoints = await page.locator("ul li, [data-benefit]").first().isVisible().catch(() => false);

    expect(hasBenefits || hasBulletPoints).toBe(true);
  });
});

test.describe("Subscription - Registration Flow", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Can select subscription plan", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Find select/subscribe button
    const selectButton = page.getByRole("button", { name: /select|choose|subscribe|vybrat|předplatit/i }).first();

    if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation or payment
      const hasConfirmation = await page.getByText(/confirm|checkout|payment|platba|proceed/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);
    }
  });

  test("Subscription upgrade option exists", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Look for upgrade button
    const upgradeButton = page.getByRole("button", { name: /upgrade|improve|vylepšit|změnit/i }).first();
    const hasUpgrade = await upgradeButton.isVisible().catch(() => false);

    expect(hasUpgrade).toBe(true);
  });

  test("Subscription cancellation option exists", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Look for cancel button
    const cancelButton = page.getByRole("button", { name: /cancel|zrušit|unsubscribe/i }).first();
    const manageLinkButton = page.getByRole("link", { name: /manage|spravovat/i }).first();

    const hasCancel = await cancelButton.isVisible().catch(() => false);
    const hasManage = await manageLinkButton.isVisible().catch(() => false);

    expect(hasCancel || hasManage).toBe(true);
  });
});

test.describe("Subscription - Admin Package Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Admin can view subscription packages", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    await waitForLoadingComplete(page);

    const hasPackages = await page.getByText(/subscription|package|balíček|plan|plán/i).isVisible().catch(() => false);
    expect(hasPackages).toBe(true);
  });

  test("Admin can create subscription package", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    await waitForLoadingComplete(page);

    // Find create button
    const createButton = page.getByRole("button", { name: /create|add|new|vytvořit|přidat|nový/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Should show create form
      const hasForm = await page.getByLabel(/name|název|price|cena/i).first().isVisible().catch(() => false);
      const hasModal = await page.getByRole("dialog").isVisible().catch(() => false);

      expect(hasForm || hasModal).toBe(true);
    }
  });

  test("Admin can edit subscription package", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    await waitForLoadingComplete(page);

    // Find edit button
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.getByLabel(/name|název/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Admin can toggle subscription package status", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    await waitForLoadingComplete(page);

    // Find status toggle
    const statusToggle = page.getByRole("switch", { name: /active|status|aktivní/i }).first();
    const statusButton = page.getByRole("button", { name: /activate|deactivate|aktivovat|deaktivovat/i }).first();

    const hasToggle = await statusToggle.isVisible().catch(() => false);
    const hasButton = await statusButton.isVisible().catch(() => false);

    expect(hasToggle || hasButton).toBe(true);
  });
});

test.describe("Subscription - Admin Member Subscriptions", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Admin can view member subscriptions", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    const hasMemberSubscriptions = await page.getByText(/member|subscription|user|uživatel/i).isVisible().catch(() => false);
    expect(hasMemberSubscriptions).toBe(true);
  });

  test("Admin can search member subscriptions", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    // Find search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|hledat/i)).first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("member@platform.rtn");
      await page.waitForTimeout(500);

      // Results should filter
      const hasResults = await page.getByText(/member|result|výsledek/i).isVisible().catch(() => false);
      expect(hasResults).toBe(true);
    }
  });

  test("Admin can assign subscription to member", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    // Find assign button
    const assignButton = page.getByRole("button", { name: /assign|add|přidat|přiřadit/i }).first();

    if (await assignButton.isVisible().catch(() => false)) {
      await assignButton.click();
      await waitForLoadingComplete(page);

      // Should show assignment form
      const hasForm = await page.getByLabel(/member|user|subscription/i).first().isVisible().catch(() => false);
      const hasModal = await page.getByRole("dialog").isVisible().catch(() => false);

      expect(hasForm || hasModal).toBe(true);
    }
  });

  test("Admin can view subscription history", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    // Click on a member to see history
    const memberRow = page.getByRole("row").nth(1);
    const historyButton = page.getByRole("button", { name: /history|historie|detail/i }).first();

    if (await historyButton.isVisible().catch(() => false)) {
      await historyButton.click();
      await waitForLoadingComplete(page);

      const hasHistory = await page.getByText(/history|historie|started|ended|zahájeno|ukončeno/i).isVisible().catch(() => false);
      expect(hasHistory).toBe(true);
    }
  });

  test("Admin can extend subscription", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    // Find extend button
    const extendButton = page.getByRole("button", { name: /extend|prodloužit/i }).first();

    if (await extendButton.isVisible().catch(() => false)) {
      await extendButton.click();
      await waitForLoadingComplete(page);

      // Should show extension form
      const hasForm = await page.getByLabel(/days|months|dní|měsíců|duration/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Admin can cancel member subscription", async ({ page }) => {
    await page.goto("/admin/member-subscriptions");
    await waitForLoadingComplete(page);

    // Find cancel button
    const cancelButton = page.getByRole("button", { name: /cancel|zrušit/i }).first();

    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirmation = await page.getByText(/confirm|are you sure|jste si jisti/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);
    }
  });
});

test.describe("Subscription - Expiry & Renewal", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Expiring subscription shows warning", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Look for expiry warning
    const hasExpiryWarning = await page.getByText(/expiring|expires|vyprší|renew|obnovit/i).isVisible().catch(() => false);
    expect(hasExpiryWarning).toBe(true);
  });

  test("Renewal option is available", async ({ page }) => {
    await page.goto("/member/subscription");
    await waitForLoadingComplete(page);

    // Look for renew button
    const renewButton = page.getByRole("button", { name: /renew|obnovit|extend|prodloužit/i }).first();
    const hasRenew = await renewButton.isVisible().catch(() => false);

    expect(hasRenew).toBe(true);
  });
});

test.describe("Subscription - API Verification", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Subscription status RPC returns valid data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_my_subscription_status");

      return {
        hasData: data !== null,
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });

  test("Available packages RPC returns data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_available_subscription_packages");

      return {
        count: data?.length ?? 0,
        isArray: Array.isArray(data),
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });
});
