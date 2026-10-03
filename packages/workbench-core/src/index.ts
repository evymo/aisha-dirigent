/**
 * @aisha/workbench-core — public API barrel.
 *
 * Exports all platform-agnostic interfaces, types, and adapters
 * shared between the AISHA Dirigent extension and the AISHA Workbench fork.
 *
 * @module
 */

// Auth types
export type { AuthState, AuthCredentials } from "./auth/AuthState.js";
export type { IAuthAdapter } from "./auth/IAuthAdapter.js";
export type { ITokenStorage } from "./auth/ITokenStorage.js";

// Auth implementations
export { SupabaseGoTrueAdapter } from "./auth/SupabaseGoTrueAdapter.js";
export type { SupabaseGoTrueAdapterOptions } from "./auth/SupabaseGoTrueAdapter.js";
export { ApiKeyAdapter } from "./auth/ApiKeyAdapter.js";
export type { ApiKeyAdapterOptions } from "./auth/ApiKeyAdapter.js";
export { KeycloakOidcAdapter } from "./auth/KeycloakOidcAdapter.js";
export type { KeycloakOidcAdapterOptions } from "./auth/KeycloakOidcAdapter.js";

// Backend profile
export type {
  BackendProfile,
  BackendType,
  ConnectionProfile,
  LlmConfig,
  LlmProvider,
  LlmProviderPreset,
} from "./backend/BackendProfile.js";
export { DEFAULT_LLM_CONFIG, DEFAULT_LLM_PRESETS } from "./backend/BackendProfile.js";

// SSE
export type {
  ISseClient,
  AishaPushEvent,
  AishaPushEventType,
  PushEventHandler,
  SseConnectionStatus,
} from "./sse/ISseClient.js";

// Story types
export type {
  Story,
  StoryEntry,
  StoryItem,
  StoryKnowledge,
  StoryTemplate,
  StoryTemplateType,
  CreateStoryParams,
  PostEntryParams,
} from "./story/types.js";

// Workbench execution-queue contract (PR-J rail)
export type {
  WorkbenchRequestStatus,
  WorkbenchClow,
  WorkbenchExecutionRequest,
  ClaimPendingWorkbenchParams,
  CompleteWorkbenchParams,
  CompleteWorkbenchResult,
} from "./workbench/types.js";

// Workbench drainer engine (platform-agnostic claim→run→complete loop)
export { WorkbenchDrainer } from "./workbench/WorkbenchDrainer.js";
export type {
  WorkbenchQueuePort,
  WorkbenchRunner,
  WorkbenchCompletion,
  WorkbenchRunOutput,
  WorkbenchDrainerOptions,
  WorkbenchDrainEvent,
  WorkbenchDrainPhase,
} from "./workbench/WorkbenchDrainer.js";
