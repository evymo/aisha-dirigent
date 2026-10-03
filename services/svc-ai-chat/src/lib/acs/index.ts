/**
 * ACS integration for svc-ai-chat (docs/AGENT_COMMUNICATION_STANDARD.md).
 *
 * LEAN barrel: re-exports only the modules that are safe in ANY import graph
 * (guard, intent — both inert and dependency-free under ACS_MODE=off).
 * acsStructuredChat (IP-1) lives in './generation.js' and must be imported
 * directly by LLM-path call sites — it statically depends on llmRouter.
 */
export {
  acsGlobalMode,
  acsGuardToolExecution,
  resetAcsGuardCache,
  type AcsMode,
  type GuardableToolCall,
  type GuardedResult,
} from './guard.js';
export { ensureIntent } from './intent.js';
