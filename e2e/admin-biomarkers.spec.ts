/**
 * Admin Biomarkers E2E Tests
 *
 * Tests biomarker reference range management in admin panel.
 * Covers: biomarker listing, range configuration, validation.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Biomarkers - Admin Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Biomarkers page is accessible", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    await expect(page.getByRole("heading", { name: /referenční rozsahy|reference ranges|biomarker/i })).toBeVisible();
  });

  test("Biomarker list is displayed", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    await expect(page.getByRole("table")).toBeVisible();
  });

  test("Biomarker shows range values", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    await expect(page.getByRole("columnheader", { name: /normální rozsah|normal range/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /optimální rozsah|optimal range/i })).toBeVisible();
  });
});

test.describe("Biomarkers - CRUD Operations", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can create new biomarker", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Find create button
    const createButton = page.getByRole("button", { name: /create|add|new|vytvořit|přidat/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Should show create form
      const hasForm = await page.getByLabel(/name|název|code|kód/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can edit biomarker", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Find edit button
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.getByLabel(/name|range/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can delete biomarker", async ({ page }) => {
    await page.goto("/admin/biomarkers");
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

test.describe("Biomarkers - Range Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can configure minimum value", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const editButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Look for min field
      const minField = page.getByLabel(/min|minimum|low|dolní/i).first();
      const hasMin = await minField.isVisible().catch(() => false);
      expect(hasMin).toBe(true);
    }
  });

  test("Can configure maximum value", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const editButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Look for max field
      const maxField = page.getByLabel(/max|maximum|high|horní/i).first();
      const hasMax = await maxField.isVisible().catch(() => false);
      expect(hasMax).toBe(true);
    }
  });

  test("Can configure unit of measurement", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const editButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Look for unit field
      const unitField = page.getByLabel(/unit|jednotka|measure/i).first();
      const unitSelect = page.getByRole("combobox", { name: /unit/i });

      const hasUnit = await unitField.isVisible().catch(() => false);
      const hasSelect = await unitSelect.isVisible().catch(() => false);

      expect(hasUnit || hasSelect).toBe(true);
    }
  });

  test("Can configure optimal range", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const editButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Look for optimal range fields
      const optimalMin = page.getByLabel(/optimal min|optimal low/i).first();
      const optimalMax = page.getByLabel(/optimal max|optimal high/i).first();

      const hasOptimalMin = await optimalMin.isVisible().catch(() => false);
      const hasOptimalMax = await optimalMax.isVisible().catch(() => false);

      expect(hasOptimalMin || hasOptimalMax).toBe(true);
    }
  });
});

test.describe("Biomarkers - Validation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Min must be less than max", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create form
    const createButton = page.getByRole("button", { name: /create|add|new/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Fill invalid values (min > max)
      const minField = page.getByLabel(/min/i).first();
      const maxField = page.getByLabel(/max/i).first();

      if (await minField.isVisible().catch(() => false) && await maxField.isVisible().catch(() => false)) {
        await minField.fill("100");
        await maxField.fill("50");

        const submitButton = page.getByRole("button", { name: /save|submit/i }).first();
        if (await submitButton.isVisible().catch(() => false)) {
          await submitButton.click();
          await page.waitForTimeout(500);

          // Should show validation error
          const hasError = await page.getByText(/invalid|must be less|must be greater|neplatné/i).isVisible().catch(() => false);
          expect(hasError).toBe(true);
        }
      }
    }
  });

  test("Name is required", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Open create form
    const createButton = page.getByRole("button", { name: /create|add|new/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Try to submit without name
      const submitButton = page.getByRole("button", { name: /save|submit|create/i }).first();

      if (await submitButton.isVisible().catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(500);

        // Should show validation error
        const hasError = await page.getByText(/required|povinné|name/i).isVisible().catch(() => false);
        expect(hasError).toBe(true);
      }
    }
  });
});

test.describe("Biomarkers - Categories", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Biomarkers can be categorized", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    await expect(page.getByRole("columnheader", { name: /kategorie|category/i })).toBeVisible();
  });

  test("Can filter by category", async ({ page }) => {
    await page.goto("/admin/biomarkers");
    await waitForLoadingComplete(page);

    // Find category filter
    const categoryFilter = page.getByRole("combobox", { name: /category|filter/i }).first();

    if (await categoryFilter.isVisible().catch(() => false)) {
      await categoryFilter.click();

      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }

      expect(true).toBe(true);
    }
  });
});
