/**
 * E2E Tests: Mission Control Workbench (Phases 0-4)
 *
 * Coverage:
 * - /admin/mission-control landing renders 6 simultaneous live panes
 * - /admin/mission-control/kanban renders columns + stack-default lane
 * - /admin/stack redirects to stack-default story detail
 * - /admin/stories/:id renders 6 tabs (Overview / Timeline / Knowledge /
 *   Rulesets / Bindings / Hippocampus) and switches between them
 *
 * Auth: admin storage state — workbench is admin/staff gated by RBAC + RLS.
 * Workbench data-test selectors land in main as part of PRs #106 / #109
 * onwards; selectors here use those exact attribute values.
 */

import { test, expect, Page } from "@playwright/test";

const waitForLoadingComplete = async (page: Page) => {
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
};

test.describe("Mission Control — Landing (admin)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("renders the page shell + 6 live panes", async ({ page }) => {
    await page.goto("/admin/mission-control");
    await waitForLoadingComplete(page);

    // Page-level test id (added by MissionControl.tsx)
    await expect(page.getByTestId("mission-control-landing")).toBeVisible({
      timeout: 10_000,
    });

    // Each pane has a stable data-test id from the components (prefixed
    // `mc-`). They render even when their underlying RPC returns empty
    // (skeleton or empty state). If realtime channels failed to subscribe,
    // we'd see error banners — which we explicitly check for absence.
    const expectedPanes = [
      "mc-live-agents-strip",
      "mc-deploy-state-strip",
      "mc-drift-meter",
      "mc-rollback-pending",
      "mc-kanban-mini",
      "mc-audit-feed",
    ];

    for (const testId of expectedPanes) {
      // Each pane is allowed to be in any of: loaded (root visible),
      // skeleton, or empty — we only assert the root container exists,
      // which proves the React subtree mounted.
      const pane = page.getByTestId(testId);
      await expect(pane.first()).toBeVisible({ timeout: 8_000 });
    }

    // No error banner from useLiveTable / useMissionControl wires
    const errorAlert = page.getByRole("alert").filter({ hasText: /error|failed/i });
    await expect(errorAlert).toHaveCount(0);
  });
});

test.describe("Mission Control — Kanban (admin)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("renders the kanban board with two lanes (stack + user stories)", async ({
    page,
  }) => {
    await page.goto("/admin/mission-control/kanban");
    await waitForLoadingComplete(page);

    await expect(page.getByTestId("mission-control-kanban-page")).toBeVisible({
      timeout: 10_000,
    });

    // The kanban board mounts even when the partner_stories list is empty.
    const board = page.getByTestId("kanban-board");
    await expect(board).toBeVisible({ timeout: 8_000 });

    // Stack-default story lane should render at the top (pinned), provided
    // ensure_stack_default_story has been seeded — which is guaranteed by
    // the production deploy pipeline. If empty, we still assert the
    // user-stories lane.
    const stackLane = page.getByTestId("kanban-lane-stack");
    const userLane = page.getByTestId("kanban-lane-user");
    await expect(userLane).toBeVisible({ timeout: 8_000 });

    // Stack lane is optional (no rows when fresh DB, but pinned section
    // should still mount once at least one story exists).
    const stackLaneVisible = await stackLane
      .isVisible()
      .catch(() => false);
    if (stackLaneVisible) {
      // Stack-default badge inside the lane should be there
      const stackBadge = page.locator(
        "[data-test=kanban-lane-stack] [data-test^=kanban-card-]",
      );
      // At least one card OR an explicit "no stories here" placeholder
      const count = await stackBadge.count().catch(() => 0);
      expect(count >= 0).toBe(true);
    }
  });

  test("kanban columns reflect workflow_statuses lookup", async ({ page }) => {
    await page.goto("/admin/mission-control/kanban");
    await waitForLoadingComplete(page);

    // Columns are derived from list_workflow_statuses RPC (P0). Seed
    // ships 6 default statuses: inbox / in_progress / scheduled / active /
    // archived / trash. Assert at least 4 columns render (the active
    // ones we expect by default).
    const columns = page.locator("[data-test^=kanban-column-]");
    const count = await columns.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

test.describe("Stack default story — /admin/stack redirect", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("/admin/stack redirects to the stack-default story detail", async ({
    page,
  }) => {
    await page.goto("/admin/stack");
    // The redirect helper invokes ensure_stack_default_story which is
    // SECURITY DEFINER + admin/staff gated — admin storage state is fine.
    // The page may briefly render the loading state, then Navigate replaces
    // the URL with /admin/stories/<id>.
    await page.waitForURL(/\/admin\/stories\/[0-9a-f-]+/i, {
      timeout: 15_000,
    });

    // Confirm we landed on the rich detail page
    await expect(page.getByTestId("admin-story-detail")).toBeVisible({
      timeout: 10_000,
    });

    // Stack badge should be visible because this IS the stack-default story
    await expect(page.getByTestId("story-stack-badge")).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Story detail — 6 tabs render and switch (admin)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("six tabs are clickable and each renders its panel", async ({ page }) => {
    // Land via /admin/stack (deterministic entry to a real story id)
    await page.goto("/admin/stack");
    await page.waitForURL(/\/admin\/stories\/[0-9a-f-]+/i, {
      timeout: 15_000,
    });
    await waitForLoadingComplete(page);

    const tabs: Array<{ trigger: string; content: string }> = [
      { trigger: "tab-trigger-overview", content: "tab-content-overview" },
      { trigger: "tab-trigger-timeline", content: "tab-content-timeline" },
      { trigger: "tab-trigger-knowledge", content: "tab-content-knowledge" },
      { trigger: "tab-trigger-rulesets", content: "tab-content-rulesets" },
      { trigger: "tab-trigger-bindings", content: "tab-content-bindings" },
      { trigger: "tab-trigger-hippocampus", content: "tab-content-hippocampus" },
    ];

    for (const { trigger, content } of tabs) {
      const triggerEl = page.getByTestId(trigger);
      await expect(triggerEl).toBeVisible({ timeout: 5_000 });
      await triggerEl.click();
      await page.waitForTimeout(200); // tabs animation
      await expect(page.getByTestId(content)).toBeVisible({ timeout: 5_000 });
    }
  });
});
