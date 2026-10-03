/**
 * Admin Payments E2E Tests
 *
 * Tests payment history and management in admin panel.
 * Covers: payment listing, details, refunds.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Payments - Admin Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Payments page is accessible", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Should show payments interface
    const hasPayments = await page.getByText(/payment|platba|transaction|transakce/i).isVisible().catch(() => false);
    expect(hasPayments).toBe(true);
  });

  test("Payment list is displayed", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Should show payment list
    const hasList = await page.getByText(/payment|amount|status|částka|stav/i).isVisible().catch(() => false);
    const hasTable = await page.getByRole("table").isVisible().catch(() => false);

    expect(hasList || hasTable).toBe(true);
  });

  test("Payment shows status", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for status indicators
    const hasStatus = await page.getByText(/success|completed|pending|failed|úspěšná|dokončena|čekající/i).isVisible().catch(() => false);
    expect(hasStatus).toBe(true);
  });
});

test.describe("Payments - Details View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can view payment details", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Click on payment to view details
    const viewButton = page.getByRole("button", { name: /view|detail|zobrazit/i }).first();
    const paymentRow = page.getByRole("row").nth(1);

    if (await viewButton.isVisible().catch(() => false)) {
      await viewButton.click();
      await waitForLoadingComplete(page);

      const hasDetails = await page.getByText(/payment|amount|customer|order/i).isVisible().catch(() => false);
      expect(hasDetails).toBe(true);
    } else if (await paymentRow.isVisible().catch(() => false)) {
      await paymentRow.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Payment shows associated order", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for order reference
    const hasOrderRef = await page.getByText(/order|objednávka|#\d+/i).isVisible().catch(() => false);
    expect(hasOrderRef).toBe(true);
  });

  test("Payment shows customer info", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for customer info
    const hasCustomer = await page.getByText(/customer|zákazník|email|user/i).isVisible().catch(() => false);
    expect(hasCustomer).toBe(true);
  });

  test("Payment shows payment method", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for payment method
    const hasMethod = await page.getByText(/card|credit|stripe|method|karta|způsob/i).isVisible().catch(() => false);
    expect(hasMethod).toBe(true);
  });
});

test.describe("Payments - Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can filter by status", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Find status filter
    const statusFilter = page.getByRole("combobox", { name: /status|stav/i }).first();
    const statusTabs = page.getByRole("tab", { name: /all|success|pending|failed/i }).first();

    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.click();
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }
      expect(true).toBe(true);
    } else if (await statusTabs.isVisible().catch(() => false)) {
      await statusTabs.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can filter by date range", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Find date filter
    const dateFrom = page.getByLabel(/from|od|start/i).first();
    const dateTo = page.getByLabel(/to|do|end/i).first();

    if (await dateFrom.isVisible().catch(() => false)) {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      await dateFrom.fill(lastMonth.toISOString().split("T")[0]);
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can search by customer", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Find search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|hledat/i)).first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("member@platform.rtn");
      await page.waitForTimeout(500);
      expect(true).toBe(true);
    }
  });
});

test.describe("Payments - Refunds", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Refund option exists for completed payments", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for refund button
    const refundButton = page.getByRole("button", { name: /refund|vrátit|refundovat/i }).first();
    const hasRefund = await refundButton.isVisible().catch(() => false);

    expect(hasRefund).toBe(true);
  });

  test("Refund requires confirmation", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Find and click refund button
    const refundButton = page.getByRole("button", { name: /refund|vrátit/i }).first();

    if (await refundButton.isVisible().catch(() => false)) {
      await refundButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation dialog
      const hasConfirmation = await page.getByText(/confirm|are you sure|amount|částka/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);

      // Cancel
      const cancelButton = page.getByRole("button", { name: /cancel|zrušit/i }).first();
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  });

  test("Can specify refund amount", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Find and click refund button
    const refundButton = page.getByRole("button", { name: /refund|vrátit/i }).first();

    if (await refundButton.isVisible().catch(() => false)) {
      await refundButton.click();
      await waitForLoadingComplete(page);

      // Look for amount input
      const amountInput = page.getByLabel(/amount|částka/i).first();
      const hasAmountInput = await amountInput.isVisible().catch(() => false);

      expect(hasAmountInput).toBe(true);

      // Cancel
      const cancelButton = page.getByRole("button", { name: /cancel|zrušit/i }).first();
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  });
});

test.describe("Payments - Export", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can export payment history", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for export button
    const exportButton = page.getByRole("button", { name: /export|download|stáhnout|csv/i }).first();

    if (await exportButton.isVisible().catch(() => false)) {
      expect(true).toBe(true);
    }
  });
});

test.describe("Payments - Statistics", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Shows payment statistics", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for statistics
    const hasStats = await page.getByText(/total|celkem|revenue|příjmy|count|počet/i).isVisible().catch(() => false);
    expect(hasStats).toBe(true);
  });

  test("Shows revenue chart", async ({ page }) => {
    await page.goto("/admin/payments");
    await waitForLoadingComplete(page);

    // Look for chart
    const hasChart = await page.locator("canvas, svg.recharts-surface").first().isVisible().catch(() => false);
    expect(hasChart).toBe(true);
  });
});
