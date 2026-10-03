/**
 * Zod schemas for GitHub App integration types.
 *
 * Used by hooks and components that interact with GitHub installations,
 * repositories, and repo operations.
 *
 * @module lib/schemas/githubSchemas
 */

import { z } from "zod";

// ===========================================================================
// GitHub App Installation
// ===========================================================================

export const githubInstallationSchema = z.object({
  id: z.string().uuid(),
  installation_id: z.number().int().positive(),
  account_login: z.string().min(1),
  account_type: z.enum(["Organization", "User"]),
  permissions: z.record(z.string(), z.string()).default({}),
  repository_selection: z.enum(["all", "selected"]),
  is_active: z.boolean(),
  installed_at: z.string(),
  repo_count: z.number().int().nonnegative(),
});

export type GitHubInstallation = z.infer<typeof githubInstallationSchema>;

export const githubInstallationArraySchema = z.array(githubInstallationSchema);

// ===========================================================================
// GitHub App Repository
// ===========================================================================

export const githubRepositorySchema = z.object({
  repo_id: z.number().int().positive(),
  repo_full_name: z.string().min(1),
  is_private: z.boolean(),
  default_branch: z.string().default("main"),
  is_active: z.boolean(),
  synced_at: z.string(),
});

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export const githubRepositoryArraySchema = z.array(githubRepositorySchema);

// ===========================================================================
// Integration Events (observability)
// ===========================================================================

export const integrationEventStatsSchema = z.object({
  total_events: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  exhausted: z.number().int().nonnegative(),
  avg_duration_ms: z.number().nonnegative(),
  p95_duration_ms: z.number().nonnegative(),
  error_rate: z.number().min(0).max(1),
  retry_rate: z.number().min(0).max(1),
  top_errors: z.array(z.object({
    error: z.unknown(),
    count: z.number(),
  })).default([]),
  by_event_type: z.array(z.object({
    event_type: z.string(),
    count: z.number(),
    avg_duration_ms: z.number(),
  })).default([]),
});

export type IntegrationEventStats = z.infer<typeof integrationEventStatsSchema>;

export const integrationEventSchema = z.object({
  id: z.string().uuid(),
  event_source: z.string(),
  external_id: z.string(),
  event_type: z.string(),
  status: z.enum(["received", "processing", "completed", "failed", "exhausted", "skipped_duplicate"]),
  duration_ms: z.number().nullable(),
  attempt: z.number().int(),
  routed_to: z.string().nullable(),
  n8n_execution_id: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export type IntegrationEvent = z.infer<typeof integrationEventSchema>;

export const integrationEventArraySchema = z.array(integrationEventSchema);

// ===========================================================================
// AISHA Maturity Score
// ===========================================================================

export const aishaMaturitySchema = z.object({
  story_id: z.string().uuid(),
  webhook_reliability: z.number().min(0).max(1),
  webhook_events_count: z.number().int().nonnegative(),
  avg_response_time_ms: z.number().nonnegative(),
  deployment_success_rate: z.number().min(0).max(1),
  deployments_count: z.number().int().nonnegative(),
  compliance_pass_rate: z.number().min(0).max(1),
  learning_proposals_count: z.number().int().nonnegative(),
  maturity_score: z.number().min(0).max(100),
  maturity_level: z.enum(["novice", "intermediate", "proficient", "expert"]),
  period_days: z.number().int().positive(),
});

export type AishaMaturity = z.infer<typeof aishaMaturitySchema>;

// ===========================================================================
// Repo Operation Request/Response (for github-repo-ops edge function)
// ===========================================================================

export const repoOperationSchema = z.object({
  operation: z.enum([
    "create_repo",
    "get_repo",
    "get_contents",
    "create_branch",
    "commit_file",
    "create_pr",
    "merge_pr",
    "create_issue",
    "create_check_run",
    "dispatch_workflow",
    "list_branches",
    "get_pull_request",
    "compare_commits",
  ]),
  installation_id: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()),
});

export type RepoOperation = z.infer<typeof repoOperationSchema>;

export const repoOperationResponseSchema = z.object({
  ok: z.boolean(),
  operation: z.string(),
  installation_id: z.number(),
  github_status: z.number(),
  data: z.unknown(),
  duration_ms: z.number().nonnegative(),
});

export type RepoOperationResponse = z.infer<typeof repoOperationResponseSchema>;

// ===========================================================================
// Link installation to partner
// ===========================================================================

export const linkInstallationResultSchema = z.object({
  ok: z.boolean(),
  installation_id: z.number(),
  partner_id: z.string().uuid(),
  account_login: z.string(),
});

export type LinkInstallationResult = z.infer<typeof linkInstallationResultSchema>;

// ===========================================================================
// Link story to repo
// ===========================================================================

export const linkStoryRepoResultSchema = z.object({
  ok: z.boolean(),
  story_id: z.string().uuid(),
  installation_id: z.number(),
  repo_full_name: z.string(),
  partner_id: z.string().uuid().nullable(),
});

export type LinkStoryRepoResult = z.infer<typeof linkStoryRepoResultSchema>;
