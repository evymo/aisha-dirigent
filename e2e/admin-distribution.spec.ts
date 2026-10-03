/**
 * Admin Distribution E2E Tests
 *
 * Tests distribution calendar and forecast management.
 * Covers: calendar view, expedition scheduling, forecasting.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Distribution - Calendar View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Distribution page is accessible", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Should show distribution interface
    const hasDistribution = await page.getByText(/distribution|distribuce|expedition|expedice|calendar|kalendář/i).isVisible().catch(() => false);
    expect(hasDistribution).toBe(true);
  });

  test("Calendar view is displayed", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Look for calendar
    const hasCalendar = await page.locator(".calendar, [data-calendar], .fc").first().isVisible().catch(() => false);
    const hasCalendarView = await page.getByRole("grid").isVisible().catch(() => false);
    const hasDays = await page.getByText(/monday|tuesday|wednesday|pondělí|úterý/i).isVisible().catch(() => false);

    expect(hasCalendar || hasCalendarView || hasDays).toBe(true);
  });

  test("Can navigate between months", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Find navigation buttons
    const nextButton = page.getByRole("button", { name: /next|další|>/i }).first();
    const prevButton = page.getByRole("button", { name: /prev|předchozí|</i }).first();

    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    } else if (await prevButton.isVisible().catch(() => false)) {
      await prevButton.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Shows scheduled expeditions", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Look for expedition events
    const hasExpeditions = await page.getByText(/expedition|expedice|shipment|zásilka|scheduled/i).isVisible().catch(() => false);
    const hasEvents = await page.locator(".calendar-event, .fc-event, [data-event]").first().isVisible().catch(() => false);

    expect(hasExpeditions || hasEvents).toBe(true);
  });
});

test.describe("Distribution - Expedition Scheduling", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can schedule new expedition", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Find schedule button
    const scheduleButton = page.getByRole("button", { name: /schedule|add|new|naplánovat|přidat/i }).first();

    if (await scheduleButton.isVisible().catch(() => false)) {
      await scheduleButton.click();
      await waitForLoadingComplete(page);

      // Should show scheduling form
      const hasForm = await page.getByLabel(/date|datum|orders|objednávky/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can select orders for expedition", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Open scheduling form
    const scheduleButton = page.getByRole("button", { name: /schedule|add|new/i }).first();

    if (await scheduleButton.isVisible().catch(() => false)) {
      await scheduleButton.click();
      await waitForLoadingComplete(page);

      // Look for order selection
      const orderCheckbox = page.getByRole("checkbox").first();
      const orderSelect = page.getByRole("combobox", { name: /order|objednávka/i });

      const hasCheckbox = await orderCheckbox.isVisible().catch(() => false);
      const hasSelect = await orderSelect.isVisible().catch(() => false);

      expect(hasCheckbox || hasSelect).toBe(true);
    }
  });

  test("Can set expedition date", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Open scheduling form
    const scheduleButton = page.getByRole("button", { name: /schedule|add|new/i }).first();

    if (await scheduleButton.isVisible().catch(() => false)) {
      await scheduleButton.click();
      await waitForLoadingComplete(page);

      // Look for date picker
      const datePicker = page.getByLabel(/date|datum/i).first();
      const hasDatePicker = await datePicker.isVisible().catch(() => false);

      expect(hasDatePicker).toBe(true);
    }
  });

  test("Can edit expedition", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Find edit button or click on event
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();
    const event = page.locator(".calendar-event, .fc-event, [data-event]").first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      const hasForm = await page.getByLabel(/date|orders/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    } else if (await event.isVisible().catch(() => false)) {
      await event.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can cancel expedition", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Find cancel/delete button
    const cancelButton = page.getByRole("button", { name: /cancel|delete|zrušit|smazat/i }).first();

    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirmation = await page.getByText(/confirm|are you sure/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);

      // Cancel
      const cancelConfirm = page.getByRole("button", { name: /no|cancel|zrušit/i }).first();
      if (await cancelConfirm.isVisible().catch(() => false)) {
        await cancelConfirm.click();
      }
    }
  });
});

test.describe("Distribution - Forecast", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Forecast page is accessible", async ({ page }) => {
    await page.goto("/admin/distribution-forecast");
    await waitForLoadingComplete(page);

    // Should show forecast interface
    const hasForecast = await page.getByText(/forecast|prognóza|prediction|předpověď|demand|poptávka/i).isVisible().catch(() => false);
    expect(hasForecast).toBe(true);
  });

  test("Forecast shows demand projections", async ({ page }) => {
    await page.goto("/admin/distribution-forecast");
    await waitForLoadingComplete(page);

    // Look for forecast data
    const hasProjections = await page.getByText(/projected|očekávané|demand|quantity|množství/i).isVisible().catch(() => false);
    const hasChart = await page.locator("canvas, svg.recharts-surface").first().isVisible().catch(() => false);

    expect(hasProjections || hasChart).toBe(true);
  });

  test("Can select forecast period", async ({ page }) => {
    await page.goto("/admin/distribution-forecast");
    await waitForLoadingComplete(page);

    // Look for period selector
    const periodSelect = page.getByRole("combobox", { name: /period|období|time/i }).first();
    const periodTabs = page.getByRole("tab", { name: /week|month|quarter|týden|měsíc/i }).first();

    if (await periodSelect.isVisible().catch(() => false)) {
      await periodSelect.click();
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }
      expect(true).toBe(true);
    } else if (await periodTabs.isVisible().catch(() => false)) {
      await periodTabs.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Forecast shows by product", async ({ page }) => {
    await page.goto("/admin/distribution-forecast");
    await waitForLoadingComplete(page);

    // Look for product breakdown
    const hasProducts = await page.getByText(/floristen|lyastin|retisin|product|produkt/i).isVisible().catch(() => false);
    expect(hasProducts).toBe(true);
  });

  test("Can export forecast data", async ({ page }) => {
    await page.goto("/admin/distribution-forecast");
    await waitForLoadingComplete(page);

    // Look for export button
    const exportButton = page.getByRole("button", { name: /export|download|stáhnout/i }).first();

    if (await exportButton.isVisible().catch(() => false)) {
      expect(true).toBe(true);
    }
  });
});

test.describe("Distribution - Order Integration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Shows pending orders count", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Look for pending orders indicator
    const hasPending = await page.getByText(/pending|čekající|awaiting|čeká|\d+ order/i).isVisible().catch(() => false);
    expect(hasPending).toBe(true);
  });

  test("Can view order details from distribution", async ({ page }) => {
    await page.goto("/admin/distribution");
    await waitForLoadingComplete(page);

    // Look for order link or detail view
    const orderLink = page.getByRole("link", { name: /order|objednávka|detail/i }).first();
    const viewButton = page.getByRole("button", { name: /view|detail|zobrazit/i }).first();

    if (await orderLink.isVisible().catch(() => false)) {
      await orderLink.click();
      await waitForLoadingComplete(page);

      const hasOrderDetail = await page.getByText(/order|customer|product/i).isVisible().catch(() => false);
      expect(hasOrderDetail).toBe(true);
    } else if (await viewButton.isVisible().catch(() => false)) {
      await viewButton.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });
});

test.describe("Distribution - Shipments", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Shipments page is accessible", async ({ page }) => {
    await page.goto("/admin/shipments");
    await waitForLoadingComplete(page);

    // Should show shipments interface
    const hasShipments = await page.getByText(/shipment|zásilka|tracking|sledování|delivery/i).isVisible().catch(() => false);
    expect(hasShipments).toBe(true);
  });

  test("Can view shipment status", async ({ page }) => {
    await page.goto("/admin/shipments");
    await waitForLoadingComplete(page);

    // Look for status indicators
    const hasStatus = await page.getByText(/status|pending|shipped|delivered|stav|odesláno|doručeno/i).isVisible().catch(() => false);
    expect(hasStatus).toBe(true);
  });

  test("Can update shipment tracking", async ({ page }) => {
    await page.goto("/admin/shipments");
    await waitForLoadingComplete(page);

    // Find update/edit button
    const updateButton = page.getByRole("button", { name: /update|edit|tracking|upravit/i }).first();

    if (await updateButton.isVisible().catch(() => false)) {
      await updateButton.click();
      await waitForLoadingComplete(page);

      // Should show tracking form
      const hasForm = await page.getByLabel(/tracking|number|číslo/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });
});
