/**
 * Unit tests for envelope Zod schema (Phase 13.1).
 *
 * The envelope is the contract between get_workspace_context() RPC and every
 * IDE template adapter. Drift = silent failure in agent context. These tests
 * lock the shape down.
 */
import { describe, it, expect } from "vitest";
import {
  WorkspaceContextEnvelopeSchema,
  StorySchema,
  ActiveRunSchema,
  PendingApprovalSchema,
  AuditEntrySchema,
  DeployStateSchema,
} from "../lib/envelope.js";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

describe("envelope schemas", () => {
  it("StorySchema accepts a minimal valid story", () => {
    const result = StorySchema.safeParse({
      id: VALID_UUID,
      title: "My story",
      status: "inbox",
      delivery_status: "draft",
      is_stack_default: false,
      default_branch: "main",
      last_activity_at: "2026-05-19T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("StorySchema rejects non-UUID id", () => {
    const result = StorySchema.safeParse({
      id: "not-a-uuid",
      title: "Bad",
      status: null,
      delivery_status: null,
      is_stack_default: false,
      default_branch: null,
      last_activity_at: null,
    });
    expect(result.success).toBe(false);
  });

  it("ActiveRunSchema accepts null story_id", () => {
    const result = ActiveRunSchema.safeParse({
      id: VALID_UUID,
      story_id: null,
      kind: "deploy",
      status: "running",
      started_at: "2026-05-19T10:00:00Z",
      current_agent_slug: null,
    });
    expect(result.success).toBe(true);
  });

  it("PendingApprovalSchema requires story_id + title", () => {
    const ok = PendingApprovalSchema.safeParse({
      story_id: VALID_UUID,
      story_title: "Pending story",
      delivery_status: "awaiting_approval",
      last_activity_at: null,
    });
    expect(ok.success).toBe(true);
  });

  it("AuditEntrySchema allows null severity/area/summary", () => {
    const result = AuditEntrySchema.safeParse({
      id: VALID_UUID,
      action: "STORY_CREATED",
      severity: null,
      area: null,
      summary: null,
      created_at: "2026-05-19T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("DeployStateSchema enforces blue|green active_slot enum", () => {
    const ok = DeployStateSchema.safeParse({
      app_name: "aisha-app",
      story_id: VALID_UUID,
      active_slot: "blue",
      last_switch_at: null,
      blue_health: "healthy",
      green_health: "unknown",
    });
    expect(ok.success).toBe(true);

    const bad = DeployStateSchema.safeParse({
      app_name: "aisha-app",
      story_id: VALID_UUID,
      active_slot: "purple",
      last_switch_at: null,
      blue_health: "healthy",
      green_health: "unknown",
    });
    expect(bad.success).toBe(false);
  });

  it("WorkspaceContextEnvelopeSchema accepts empty arrays + nulls", () => {
    const result = WorkspaceContextEnvelopeSchema.safeParse({
      user_id: VALID_UUID,
      workspace_id: null,
      generated_at: "2026-05-19T10:00:00Z",
      is_privileged: false,
      stories: [],
      active_runs: [],
      pending_approvals: [],
      recent_audit: [],
      deploy_state: [],
    });
    expect(result.success).toBe(true);
  });

  it("WorkspaceContextEnvelopeSchema rejects missing required field", () => {
    const result = WorkspaceContextEnvelopeSchema.safeParse({
      user_id: VALID_UUID,
      workspace_id: null,
      // generated_at missing → invalid
      is_privileged: false,
      stories: [],
      active_runs: [],
      pending_approvals: [],
      recent_audit: [],
      deploy_state: [],
    });
    expect(result.success).toBe(false);
  });
});
