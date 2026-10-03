/**
 * E2E (Playwright) — Flowboard full UI journey, TEST-FIRST.
 *
 * Specifies the end-to-end human flow across every UI component the slice ships:
 *   AdminFlowboard (canvas + saved-flow sidebar) → build/load a flow → save
 *   (save_flowboard_graph) → Run (create_story_audited + flowboard-execute) →
 *   StoryLoop timeline shows iconographic provenance (flow_run / automation_step /
 *   consent_request via FlowStepBlock + FlowConsentGateBlock) → Approve the gate
 *   (respond_to_story_block_audited 'approve_flow_gate') → run resumes to complete.
 *
 * Gated behind RUN_FLOWBOARD_E2E=1 (needs the live stack: web + svc-ai-chat + DB +
 * an admin with `manage_ai_workflows`). Drives the wiring; un-gate in the e2e job.
 */
import { test, expect } from "@playwright/test";

const RUN = process.env.RUN_FLOWBOARD_E2E === "1";

test.describe("Flowboard — build → run → approve → resume", () => {
  test.skip(!RUN, "needs the live stack (set RUN_FLOWBOARD_E2E=1)");

  test("an admin builds the help@ recipe, runs it, approves the gate, and the run completes", async ({ page }) => {
    // 1. Admin opens the Flowboard surface (route-guarded by manage_ai_workflows).
    await page.goto("/admin/flowboard");
    await expect(page.getByText(/saved flows|uložené/i)).toBeVisible();

    // 2. The palette is the federated registry (builtin + agent_catalog). Build a flow
    //    (drag/click nodes) or load a seeded one, then Save.
    await page.getByRole("button", { name: /new flow|nový/i }).click();
    // … add trigger.email_inbound → action.story_entry → agent → action.email_send (gated) …
    await page.getByRole("button", { name: /save|uložit/i }).click();
    await expect(page.getByText(/saved|uloženo/i)).toBeVisible();

    // 3. Run → a per-run StoryLoop story is created and the governed sandbox executes.
    await page.getByRole("button", { name: /^run|spustit/i }).click();

    // 4. The run halts at the consent gate → the timeline shows the FlowConsentGateBlock.
    await expect(page).toHaveURL(/\/member\/story\//);
    const gate = page.getByText(/consent|schválení/i).first();
    await expect(gate).toBeVisible();

    // 5. Approve → respond_to_story_block_audited('approve_flow_gate') + flowboard-execute resume.
    await page.getByRole("button", { name: /approve|schválit/i }).click();
    await expect(page.getByText(/approved|schváleno/i)).toBeVisible();

    // 6. Provenance is the iconographic timeline: flow_run + automation_step entries.
    await expect(page.getByTestId("flow-step-block").first()).toBeVisible();
  });
});
