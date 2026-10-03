/**
 * E2E Tests: StoryKnowledgeTab (Phase 8 — KB upload + tag editor)
 *
 * Coverage:
 * - File upload section visible to admin
 * - "Add knowledge item" button opens editor
 * - Editor accepts title + body + comma-separated tags
 * - Tag preview chips update live as user types
 * - Cancel button closes editor without persisting
 *
 * Mutations (upsert / delete) are admin-only, audited via audit_journal.
 * We don't assert the audit row in E2E (gate tests cover that); we assert
 * the UI flow is functional + accessible.
 */

import { test, expect, Page } from "@playwright/test";

const waitForLoadingComplete = async (page: Page) => {
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
};

async function gotoStackStoryKnowledgeTab(page: Page) {
  await page.goto("/admin/stack");
  await page.waitForURL(/\/admin\/stories\/[0-9a-f-]+/i, { timeout: 15_000 });
  await waitForLoadingComplete(page);

  await page.getByTestId("tab-trigger-knowledge").click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("tab-content-knowledge")).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("StoryKnowledgeTab — Phase 8 (admin)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("knowledge tab shows file upload + create button", async ({ page }) => {
    await gotoStackStoryKnowledgeTab(page);

    // File upload section (Ragnarok)
    await expect(page.getByTestId("knowledge-file-upload")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("knowledge-file-input")).toBeVisible();

    // Create manual KB item button
    await expect(page.getByTestId("knowledge-create-button")).toBeVisible();
  });

  test("opening the editor reveals all fields", async ({ page }) => {
    await gotoStackStoryKnowledgeTab(page);

    await page.getByTestId("knowledge-create-button").click();
    await expect(page.getByTestId("knowledge-editor")).toBeVisible({
      timeout: 5_000,
    });

    // All editor controls present
    for (const id of [
      "knowledge-editor-title",
      "knowledge-editor-type",
      "knowledge-editor-category",
      "knowledge-editor-tags",
      "knowledge-editor-body",
      "knowledge-editor-save",
      "knowledge-editor-cancel",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 3_000 });
    }
  });

  test("tag preview chips reflect input live", async ({ page }) => {
    await gotoStackStoryKnowledgeTab(page);
    await page.getByTestId("knowledge-create-button").click();
    await expect(page.getByTestId("knowledge-editor")).toBeVisible();

    const tagsInput = page.getByTestId("knowledge-editor-tags");
    await tagsInput.fill("react, typescript, frontend");

    // Tag preview should show 3 chips
    const preview = page.getByTestId("knowledge-editor-tag-preview");
    await expect(preview).toBeVisible();

    // Each tag is rendered (dedup + lowercase normalization happens client-side)
    for (const tag of ["react", "typescript", "frontend"]) {
      await expect(preview.locator(`text=${tag}`)).toBeVisible({
        timeout: 2_000,
      });
    }
  });

  test("cancel closes the editor without persisting", async ({ page }) => {
    await gotoStackStoryKnowledgeTab(page);
    await page.getByTestId("knowledge-create-button").click();
    await expect(page.getByTestId("knowledge-editor")).toBeVisible();

    await page
      .getByTestId("knowledge-editor-title")
      .fill("This will be discarded");

    await page.getByTestId("knowledge-editor-cancel").click();
    await expect(page.getByTestId("knowledge-editor")).toBeHidden({
      timeout: 3_000,
    });

    // The Create button is back (we returned to list view)
    await expect(page.getByTestId("knowledge-create-button")).toBeVisible();
  });
});
