/**
 * Plugin Module Types — Contracts for AISHA Plugin System
 *
 * Plugins are sandboxed execution environments managed by AISHA.
 * User/partner development happens primarily inside plugins —
 * AISHA provides the platform, runtime, and SandboxContext API.
 *
 * Module interfaces:
 * - WebPlugin — browser-side lifecycle hooks (tracking, analytics)
 * - AuthPlugin — OAuth/OIDC provider registration
 * - BackendPlugin — extends InferenceBackend for new LLM providers
 * - AutomationPlugin — n8n custom node registration
 * - FullStackPlugin — general-purpose sandbox app (routes, UI, backend, data)
 *
 * SandboxContext is the API surface injected by AISHA into every plugin runtime.
 * Plugins NEVER access infrastructure directly — all interaction through SandboxContext.
 *
 * @module
 */

import type { InferenceBackend } from "./types.ts";

// =============================================================================
// Shared Plugin Types
// =============================================================================

/** Plugin kind — determines load strategy and runtime behaviour. */
export type PluginKind =
  | "web_tracking"
  | "auth_provider"
  | "backend_provider"
  | "automation_node"
  | "full_stack";

/** Trust tier — determines sandbox strictness and approval flow. */
export type PluginTrustTier = "internal" | "partner" | "external";

/** Plugin lifecycle status (mirrors DB enum). */
export type PluginStatus =
  | "submitted"
  | "reviewing"
  | "sandbox_testing"
  | "approved"
  | "canary"
  | "ga"
  | "disabled"
  | "archived";

/** Load strategy — cold = blocking before app render, hot = lazy async. */
export type PluginLoadStrategy = "hot" | "cold";

/** Plugin health event kind. */
export type PluginHealthEventKind =
  | "load"
  | "invoke"
  | "error"
  | "timeout"
  | "rollback"
  | "patch";

/** Sandbox policy from manifest. */
export interface PluginSandboxPolicy {
  readonly timeoutMs: number;
  readonly networkAllowlist: string[];
  readonly maxMemoryMb: number;
}

/** Resolved plugin configuration (merged global + tenant override). */
export interface PluginConfig {
  readonly pluginId: string;
  readonly kind: PluginKind;
  readonly trustTier: PluginTrustTier;
  readonly status: PluginStatus;
  readonly capabilities: string[];
  readonly config: Record<string, unknown>;
  readonly sandbox: PluginSandboxPolicy;
  readonly loadStrategy: PluginLoadStrategy;
  readonly artifactUrl: string;
  readonly artifactSha256: string;
  readonly version: string;
}

// =============================================================================
// Web Plugin Module (kind: web_tracking)
// =============================================================================

/**
 * Web Plugin — injects browser-side behaviour (tracking, analytics, A/B tests).
 *
 * Lifecycle: bootstrap() → ready() → dispose()
 * Load strategy: HOT (lazy, after app render) by default.
 */
export interface WebPlugin {
  /** Called early during app init. Receives tenant config. */
  bootstrap(config: Record<string, unknown>): Promise<void>;

  /** Called after app is fully rendered and interactive. */
  ready(): Promise<void>;

  /** Called on app unmount or plugin disable. Must clean up DOM/listeners. */
  dispose(): Promise<void>;
}

// =============================================================================
// Auth Plugin Module (kind: auth_provider)
// =============================================================================

/** OAuth/OIDC provider configuration for GoTrue/Supabase Auth. */
export interface AuthProviderConfig {
  /** Provider slug used in signInWithOAuth (e.g. "azure", "github"). */
  readonly providerId: string;
  /** Human-readable label for the login button. */
  readonly label: string;
  /** Icon name from lucide-react icon set. */
  readonly iconName: string;
  /** OIDC issuer URL. */
  readonly issuerUrl: string;
  /** Client ID (non-secret, passed to frontend). */
  readonly clientId: string;
  /** Scopes to request. */
  readonly scopes: string[];
  /** Additional GoTrue provider options. */
  readonly options?: Record<string, unknown>;
}

/**
 * Auth Plugin — registers a new OAuth/OIDC provider.
 *
 * Load strategy: COLD (blocking, must be available before login page).
 */
export interface AuthPlugin {
  /** Return the provider configuration for GoTrue registration. */
  getProviderConfig(
    config: Record<string, unknown>,
  ): Promise<AuthProviderConfig>;

  /** Optional: handle callback/webhook from the provider. */
  handleCallback?(
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }>;
}

// =============================================================================
// Backend Plugin Module (kind: backend_provider)
// =============================================================================

/**
 * Backend Plugin — a new inference backend (extends InferenceBackend).
 *
 * Load strategy: COLD (blocking, must be available before any LLM call).
 */
export interface BackendPlugin {
  /** Create an InferenceBackend instance from tenant config. */
  createBackend(
    config: Record<string, unknown>,
  ): Promise<InferenceBackend>;
}

// =============================================================================
// Automation Plugin Module (kind: automation_node)
// =============================================================================

/** Minimal n8n INodeType shape (subset needed for registration). */
export interface N8nNodeTypeDescription {
  readonly displayName: string;
  readonly name: string;
  readonly group: string[];
  readonly version: number;
  readonly description: string;
  readonly defaults: Record<string, unknown>;
  readonly inputs: string[];
  readonly outputs: string[];
  readonly properties: Record<string, unknown>[];
}

/**
 * Automation Plugin — registers an n8n custom node.
 *
 * Load strategy: HOT (lazy, n8n registers async).
 */
export interface AutomationPlugin {
  /** Return node type descriptions for n8n registration. */
  getNodeType(): Promise<N8nNodeTypeDescription>;

  /** Execute the node logic. */
  execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

// =============================================================================
// Sandbox Context — AISHA-provided API for all plugin runtimes
// =============================================================================

/** Chat message for LLM inference via sandbox. */
export interface SandboxChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Options for LLM inference calls. */
export interface SandboxLlmOptions {
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** Notification payload sent to users. */
export interface SandboxNotificationPayload {
  readonly channel: "in_app" | "email" | "push";
  readonly title: string;
  readonly body: string;
  readonly metadata?: Record<string, unknown>;
}

/** Cron-scheduled task registration. */
export interface SandboxScheduledTask {
  readonly id: string;
  readonly cronExpr: string;
  readonly handler: () => Promise<void>;
}

/**
 * SandboxContext — the API surface AISHA injects into every plugin runtime.
 *
 * Plugins NEVER access Supabase, MinIO, or any infra directly.
 * All interaction happens through this context, which is:
 * - Scoped to the plugin's tenant + plugin ID
 * - Rate-limited based on trust_tier
 * - Audited (every call is logged)
 * - Sandboxed (network, memory, timeout enforced)
 */
export interface SandboxContext {
  // ---- Identity & Config ----

  /** Plugin identity. */
  readonly plugin: {
    readonly id: string;
    readonly version: string;
    readonly kind: PluginKind;
    readonly trustTier: PluginTrustTier;
  };

  /** Tenant context (who is running this plugin instance). */
  readonly tenant: {
    readonly id: string;
    readonly name: string;
  };

  /** Merged config (manifest defaults + tenant override). */
  readonly config: Record<string, unknown>;

  // ---- Core Data (RPC Proxy) ----

  /**
   * Call a whitelisted Supabase RPC function.
   * Only functions listed in manifest.capabilities are allowed.
   * AISHA validates + audits every call.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  // ---- Plugin Key-Value Store (namespaced) ----

  /** Plugin-scoped key-value storage. Isolated per plugin + tenant. */
  readonly kv: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };

  // ---- Object Storage (MinIO proxy, namespaced) ----

  /** Plugin-scoped object/file storage. Bucket isolated per plugin. */
  readonly storage: {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };

  // ---- Event Bus ----

  /** Publish an event to the platform event bus. */
  publish(topic: string, payload: unknown): Promise<void>;

  /** Subscribe to platform events (filtered by capability whitelist). */
  subscribe(
    topic: string,
    handler: (payload: unknown) => Promise<void>,
  ): void;

  // ---- LLM Inference ----

  /** LLM inference proxy — routed through AISHA's backend providers. */
  readonly llm: {
    chat(
      messages: SandboxChatMessage[],
      options?: SandboxLlmOptions,
    ): Promise<string>;
    embed(text: string): Promise<number[]>;
  };

  // ---- Notifications ----

  /** Send a notification to a user via platform notification system. */
  notify(
    userId: string,
    payload: SandboxNotificationPayload,
  ): Promise<void>;

  // ---- Scheduled Tasks ----

  /**
   * Register a cron-scheduled task.
   * Max frequency depends on trust_tier (external: min 15m, partner: 5m, internal: 1m).
   */
  schedule(
    cronExpr: string,
    handler: () => Promise<void>,
  ): SandboxScheduledTask;

  // ---- HTTP (outbound, restricted) ----

  /**
   * Make an outbound HTTP request (restricted to manifest.sandbox.network_allowlist).
   * All requests are logged and rate-limited.
   */
  fetch(url: string, init?: RequestInit): Promise<Response>;

  // ---- Logging (safe, no PII) ----

  /** Structured log — routed to Langfuse trace for observability. */
  log(level: "debug" | "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>): void;
}

// =============================================================================
// Full-Stack Plugin Module (kind: full_stack)
// =============================================================================

/**
 * FullStackPlugin — general-purpose sandbox application.
 *
 * The primary development surface for partners/users.
 * Can define routes, handle webhooks, run scheduled tasks, serve UI.
 * All interaction through SandboxContext — no direct infra access.
 *
 * Load strategy: HOT (lazy, on-demand per route/event).
 */
export interface FullStackPlugin {
  /** Initialize the plugin. Called once when first loaded in sandbox. */
  init(ctx: SandboxContext): Promise<void>;

  /**
   * Handle an incoming request (webhook, route, event trigger).
   * The `capability` field determines the handler type:
   * - "http.*" — HTTP route handling (e.g. "http.POST./api/custom")
   * - "event.*" — Platform event handling (e.g. "event.user.created")
   * - "cron.*" — Scheduled task execution (e.g. "cron.daily-sync")
   * - "ui.*" — UI component rendering (e.g. "ui.dashboard-widget")
   */
  handle(
    ctx: SandboxContext,
    capability: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Called before plugin is unloaded. Clean up subscriptions, timers. */
  dispose(ctx: SandboxContext): Promise<void>;
}

// =============================================================================
// Plugin Module Union
// =============================================================================

/** Union of all plugin module types. */
export type PluginModule =
  | WebPlugin
  | AuthPlugin
  | BackendPlugin
  | AutomationPlugin
  | FullStackPlugin;

/** Map plugin kind to its module interface. */
export interface PluginKindModuleMap {
  web_tracking: WebPlugin;
  auth_provider: AuthPlugin;
  backend_provider: BackendPlugin;
  automation_node: AutomationPlugin;
  full_stack: FullStackPlugin;
}

// =============================================================================
// Plugin Host Request/Response
// =============================================================================

/** Request payload for the plugin-host edge function. */
export interface PluginHostRequest {
  readonly pluginId: string;
  readonly tenantId?: string;
  readonly capability: string;
  readonly payload: Record<string, unknown>;
}

/** Response from the plugin-host edge function. */
export interface PluginHostResponse {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly latencyMs: number;
  readonly backendId: string;
}
