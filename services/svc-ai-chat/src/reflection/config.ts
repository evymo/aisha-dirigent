import { requireEnv } from '@aisha/security';
/**
 * Reflection capability config — env reads scoped to the reflection runtime
 * inside svc-ai-chat. Adjacent to (not replacing) the main svc-ai-chat config.
 *
 * All entries are optional; runtime soft-fails when a capability env is missing.
 */
export const reflectionConfig = {
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-ai-chat', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // OWASP A10 — outbound host allowlist (comma-separated); mirrors src/config.ts
  ssrfHostAllowlist:
    process.env.SSRF_HOST_ALLOWLIST ??
    'api.openai.com,api.anthropic.com,generativelanguage.googleapis.com',

  // External capabilities invoked by reflection graph nodes
  openclawUrl: process.env.OPENCLAW_URL ?? '',
  openclawApiKey: process.env.OPENCLAW_API_KEY ?? '',
  blockchainUrl: process.env.SVC_BLOCKCHAIN_URL ?? 'http://svc-blockchain:3050',
  blockchainServiceToken: process.env.SVC_BLOCKCHAIN_SERVICE_TOKEN ?? '',

  // LLM Gateway — used for batch endpoint passthrough only (sync calls go
  // directly via llmRouter providers).
  llmGatewayUrl: process.env.AISHA_LLM_GATEWAY_URL ?? '',
  llmGatewayKey: process.env.AISHA_LLM_GATEWAY_KEY ?? '',

  defaultAgentSlug: process.env.LANGGRAPH_DEFAULT_AGENT_SLUG ?? 'aisha',

  // Runner safety limits
  maxIterationsPerRun: parseInt(process.env.LANGGRAPH_MAX_ITERATIONS ?? '20', 10),
  defaultNodeTimeoutMs: parseInt(process.env.LANGGRAPH_NODE_TIMEOUT_MS ?? '60000', 10),
  maxNodeTimeoutMs: parseInt(process.env.LANGGRAPH_MAX_NODE_TIMEOUT_MS ?? '600000', 10),

  // Capability toggle flags (graceful skip when off)
  enableOpenclaw: process.env.LANGGRAPH_ENABLE_OPENCLAW !== 'false',
  enableCosmosAnchor: process.env.LANGGRAPH_ENABLE_COSMOS !== 'false',
  enableSoulforge: process.env.LANGGRAPH_ENABLE_SOULFORGE !== 'false',
  // PR-J workbench runtime executor (poll+block rail to the aisha-dirigent extension).
  // The adapter is "wired in this process" by default; the real gate is the
  // ai_runtime_registry.is_enabled seed flip (disabled until the extension ships).
  enableWorkbench: process.env.LANGGRAPH_ENABLE_WORKBENCH !== 'false',
  workbenchPollTimeoutMs: parseInt(process.env.AISHA_WORKBENCH_POLL_TIMEOUT_MS ?? '60000', 10),

  // Per-story budget enforcement at the orchestration control layer (node
  // boundary). 'off' disables the hard halt (advisory/metering only); the gate
  // still records consumption + audits. Default on.
  budgetEnforcement: process.env.AISHA_BUDGET_ENFORCEMENT !== 'off',
} as const;
