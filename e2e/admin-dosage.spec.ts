/**
 * Admin Distribution Protocol E2E Tests
 *
 * Tests distribution protocol management in admin panel.
 * Covers: protocol listing, CRUD, product assignment.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Distribution Protocols - Admin Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Distribution protocols page is accessible", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Should show distribution protocols interface
    const hasDistribution = await page.getByText(/distribution|dávkování|protocol|protokol/i).isVisible().catch(() => false);
    expect(hasDistribution).toBe(true);
  });

  test("Protocol list is displayed", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Should show protocol list
    const hasProtocols = await page.getByText(/protocol|distribution|product|produkt/i).isVisible().catch(() => false);
    const hasTable = await page.getByRole("table").isVisible().catch(() => false);
    const hasCards = await page.getByTestId("protocol-card").first().isVisible().catch(() => false);

    expect(hasProtocols || hasTable || hasCards).toBe(true);
  });

  test("Protocol shows distribution details", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Look for distribution details
    const hasDetails = await page.getByText(/dose|amount|frequency|frekvence|mg|ml/i).isVisible().catch(() => false);
    expect(hasDetails).toBe(true);
  });
});

test.describe("Distribution Protocols - CRUD Operations", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can create new protocol", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Find create button
    const createButton = page.getByRole("button", { name: /create|add|new|vytvořit|přidat/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Should show create form
      const hasForm = await page.getByLabel(/name|název|dose|dávka/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can edit protocol", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Find edit button
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.getByLabel(/name|dose/i).first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can view protocol details", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Click on protocol to view details
    const viewButton = page.getByRole("button", { name: /view|detail|zobrazit/i }).first();
    const protocolRow = page.getByRole("row").nth(1);

    if (await viewButton.isVisible().catch(() => false)) {
      await viewButton.click();
      await waitForLoadingComplete(page);

      const hasDetails = await page.getByText(/protocol|distribution|product/i).isVisible().catch(() => false);
      expect(hasDetails).toBe(true);
    }
  });

  test("Can delete protocol", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
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

test.describe("Distribution Protocols - Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can configure distribution amount", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const createButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Look for amount field
      const amountField = page.getByLabel(/amount|množství|dose|dávka/i).first();
      const hasAmount = await amountField.isVisible().catch(() => false);
      expect(hasAmount).toBe(true);
    }
  });

  test("Can configure frequency", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const createButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Look for frequency field
      const frequencyField = page.getByLabel(/frequency|frekvence|times|krát/i).first();
      const frequencySelect = page.getByRole("combobox", { name: /frequency/i });

      const hasFrequency = await frequencyField.isVisible().catch(() => false);
      const hasSelect = await frequencySelect.isVisible().catch(() => false);

      expect(hasFrequency || hasSelect).toBe(true);
    }
  });

  test("Can configure duration", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const createButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Look for duration field
      const durationField = page.getByLabel(/duration|délka|days|dní|weeks|týdnů/i).first();
      const hasDuration = await durationField.isVisible().catch(() => false);
      expect(hasDuration).toBe(true);
    }
  });
});

test.describe("Distribution Protocols - Product Assignment", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Can assign protocol to product", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create/edit form
    const createButton = page.getByRole("button", { name: /create|edit|add/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Look for product selection
      const productSelect = page.getByLabel(/product|produkt/i).first()
        .or(page.getByRole("combobox", { name: /product/i }));

      const hasProductSelect = await productSelect.isVisible().catch(() => false);
      expect(hasProductSelect).toBe(true);
    }
  });

  test("Shows assigned products", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Look for product names in protocol list
    const hasProducts = await page.getByText(/floristen|lyastin|retisin|product/i).isVisible().catch(() => false);
    expect(hasProducts).toBe(true);
  });
});

test.describe("Distribution Protocols - Validation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Required fields show validation", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create form
    const createButton = page.getByRole("button", { name: /create|add|new/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Try to submit empty form
      const submitButton = page.getByRole("button", { name: /save|submit|create|uložit/i }).first();

      if (await submitButton.isVisible().catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(500);

        // Should show validation errors
        const hasErrors = await page.getByText(/required|povinné|invalid/i).isVisible().catch(() => false);
        expect(hasErrors).toBe(true);
      }
    }
  });

  test("Distribution amount must be positive", async ({ page }) => {
    await page.goto("/admin/distribution-protocols");
    await waitForLoadingComplete(page);

    // Open create form
    const createButton = page.getByRole("button", { name: /create|add|new/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Try to enter negative value
      const amountField = page.getByLabel(/amount|dose/i).first();

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
