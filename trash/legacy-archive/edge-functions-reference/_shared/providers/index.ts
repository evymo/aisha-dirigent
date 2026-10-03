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
} from "./types.ts";

// OpenAI (Responses API)
export { OpenAIBackend, isReasoningModel, createOpenAIBackend } from "./openai.ts";

// Google Gemini
export { GeminiBackend, createGeminiBackend } from "./gemini.ts";

// Anthropic Claude
export { AnthropicBackend, createAnthropicBackend } from "./anthropic.ts";

// OpenAI-compatible (Ollama, Docker, vLLM, MLX)
export {
  OpenAICompatBackend,
  createOllamaBackend,
  createDockerBackend,
  createVLLMBackend,
} from "./openai-compat.ts";
export type { OpenAICompatConfig } from "./openai-compat.ts";

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
} from "./plugin-types.ts";
