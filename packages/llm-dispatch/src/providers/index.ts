/**
 * Providers — Barrel export for all inference backend implementations.
 *
 * @module
 */

// Types
export type {
  InferenceBackend,
  BackendKind,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ToolSpec,
  ToolCall,
  ToolResult,
  HealthResult,
  // Deprecated aliases for backward compat
  LlmMessage,
  LlmToolSpec,
  LlmToolCall,
  LlmToolResult,
} from "./types.js";

// OpenAI (Responses API)
export { OpenAIBackend, isReasoningModel, createOpenAIBackend } from "./openai.js";

// Google Gemini
export { GeminiBackend, createGeminiBackend } from "./gemini.js";

// Anthropic Claude
export {
  AnthropicBackend,
  createAnthropicBackend,
  // odysseus parity package (impl/12 §A): THE single Anthropic body builder —
  // sync, stream and every batch caller build request bodies through it.
  prepareAnthropicBody,
  CAPABILITY_BETAS,
} from "./anthropic.js";
export type { PreparedAnthropicRequest } from "./anthropic.js";

// OpenAI-compatible (Ollama, Docker, vLLM, MLX)
export {
  OpenAICompatBackend,
  createOllamaBackend,
  createDockerBackend,
  createVLLMBackend,
} from "./openai-compat.js";
export type { OpenAICompatConfig } from "./openai-compat.js";

// Maestro (Alquist Insight dialog management)
export { MaestroBackend, createMaestroBackend } from "./maestro.js";

// Metrics bridge — optional, no-op-by-default access to the AISHA Prometheus
// counters (@aisha/observability). A server publishes the real handle once via
// `setAishaMetrics(createAishaMetrics(...))`; frontend/scripts get the no-op.
export {
  getAishaMetrics,
  setAishaMetrics,
  recordLlmCall,
} from "./metrics.js";
export type {
  AishaMetricsHandle,
  MetricCounterLike,
  MetricHistogramLike,
} from "./metrics.js";

// Plugin system types
export type {
  PluginKind,
  PluginTrustTier,
  PluginStatus,
  PluginLoadStrategy,
  PluginHealthEventKind,
  PluginSandboxPolicy,
  PluginConfig,
  WebPlugin,
  AuthProviderConfig,
  AuthPlugin,
  BackendPlugin,
  N8nNodeTypeDescription,
  AutomationPlugin,
  SandboxChatMessage,
  SandboxLlmOptions,
  SandboxNotificationPayload,
  SandboxScheduledTask,
  SandboxContext,
  FullStackPlugin,
  PluginModule,
  PluginKindModuleMap,
  PluginHostRequest,
  PluginHostResponse,
} from "./plugin-types.js";
