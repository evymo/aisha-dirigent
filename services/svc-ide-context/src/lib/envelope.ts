/**
 * Workspace envelope shape — mirrors the get_workspace_context() RPC output.
 *
 * Zod schema enforced at API boundary per CLAUDE.md "Zod Validation" rule
 * (-1.1.3). Reject invalid PostgREST responses with 502 (not silently leak
 * malformed data to IDE clients).
 *
 * NO PII fields — only IDs, statuses, timestamps, counts. Verified by gate
 * test `wp-13-1-svc-ide-context-no-pii.gate.test.ts` (string match).
 */
import { z } from "zod";

export const StorySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string().nullable(),
  delivery_status: z.string().nullable(),
  is_stack_default: z.boolean(),
  default_branch: z.string().nullable(),
  last_activity_at: z.string().nullable(),
});

export const ActiveRunSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid().nullable(),
  kind: z.string(),
  status: z.string(),
  started_at: z.string(),
  current_agent_slug: z.string().nullable(),
});

export const PendingApprovalSchema = z.object({
  story_id: z.string().uuid(),
  story_title: z.string(),
  delivery_status: z.string().nullable(),
  last_activity_at: z.string().nullable(),
});

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  severity: z.string().nullable(),
  area: z.string().nullable(),
  summary: z.string().nullable(),
  created_at: z.string(),
});

export const DeployStateSchema = z.object({
  app_name: z.string(),
  story_id: z.string().uuid().nullable(),
  active_slot: z.enum(["blue", "green"]),
  last_switch_at: z.string().nullable(),
  blue_health: z.string(),
  green_health: z.string(),
});

export const WorkspaceContextEnvelopeSchema = z.object({
  user_id: z.string().uuid(),
  workspace_id: z.string().nullable(),
  generated_at: z.string(),
  is_privileged: z.boolean(),
  stories: z.array(StorySchema),
  active_runs: z.array(ActiveRunSchema),
  pending_approvals: z.array(PendingApprovalSchema),
  recent_audit: z.array(AuditEntrySchema),
  deploy_state: z.array(DeployStateSchema),
});

export type WorkspaceContextEnvelope = z.infer<
  typeof WorkspaceContextEnvelopeSchema
>;
export type Story = z.infer<typeof StorySchema>;
export type ActiveRun = z.infer<typeof ActiveRunSchema>;
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type DeployState = z.infer<typeof DeployStateSchema>;
