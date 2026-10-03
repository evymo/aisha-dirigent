/**
 * BackendProfile — per-backend connection configuration.
 *
 * Describes a single AISHA backend instance: local dev, self-hosted,
 * or AISHA Cloud. Extracted from aisha-dirigent config.ts so it can be
 * shared with the workbench fork and other tooling.
 *
 * @module
 */

/** Connection data for a single backend. */
export interface ConnectionProfile {
  supabaseUrl?: string;
  anonKey?: string;
  mcpUrl?: string;
  n8nTriggerUrl?: string;
}

/** LLM provider type. */
export type LlmProvider =
  | "docker-desktop"
  | "ollama"
  | "vllm"
  | "lm-studio"
  | "openai"
  | "anthropic"
  | "google"
  | "custom";

/** LLM provider preset for local/remote model routing. */
export interface LlmProviderPreset {
  provider: LlmProvider;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

/** LLM configuration section. */
export interface LlmConfig {
  activePreset: string;
  presets: Record<string, LlmProviderPreset>;
  preferLocalForEval: boolean;
}

/** Backend type — determines which health checks and UI to show. */
export type BackendType = "local" | "self-hosted" | "cloud" | "custom";

/**
 * A named backend profile: everything needed to connect to one AISHA instance.
 * Stored as the active entry in .aisha/dirigent.local.json.
 */
export interface BackendProfile {
  /** Unique profile ID (UUID or kebab-case slug). */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Backend classification used to adapt UI and health checks. */
  type: BackendType;
  /** Connection details. */
  connection: ConnectionProfile;
  /** LLM configuration for this backend. */
  llm?: LlmConfig;
  /** Auth provider configuration. */
  authProvider: "gotrue" | "api_key" | "oidc";
  /** Provider-specific auth config (issuer, clientId, etc.). */
  authConfig?: Record<string, string>;
}

/** Default LLM presets bundled with workbench-core. */
export const DEFAULT_LLM_PRESETS: Record<string, LlmProviderPreset> = {
  "docker-desktop": { provider: "docker-desktop", baseUrl: "http://localhost:12434/v1", enabled: true },
  "ollama": { provider: "ollama", baseUrl: "http://localhost:11434/v1", enabled: true },
  "vllm": { provider: "vllm", baseUrl: "http://localhost:8100/v1", enabled: true },
  "lm-studio": { provider: "lm-studio", baseUrl: "http://localhost:1234/v1", enabled: false },
};

/** Default LlmConfig using local presets. */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  activePreset: "ollama",
  presets: DEFAULT_LLM_PRESETS,
  preferLocalForEval: true,
};
