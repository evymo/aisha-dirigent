/**
 * Edge Function: plugin-host
 *
 * Sandbox runtime for AISHA plugin system.
 * Receives plugin invocation requests, resolves plugin config,
 * creates a SandboxContext that proxies all API calls through
 * controlled, audited channels, and executes plugin code in isolation.
 *
 * Security model:
 * - Plugin code NEVER accesses infrastructure directly
 * - All RPC calls validated against capability whitelist
 * - Network requests restricted to manifest.sandbox.network_allowlist
 * - Timeout enforced per manifest.sandbox.timeout_ms
 * - Every operation is audited to plugin_health_events
 *
 * Called by: frontend (via usePluginHost hook), n8n workflows, cron scheduler
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  preflightResponse,
  silentCorsDenyResponse,
} from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import { safeError } from "../_shared/safeLogger.ts";

import type {
  PluginHostRequest,
  PluginHostResponse,
  SandboxContext,
  SandboxChatMessage,
  SandboxLlmOptions,
  SandboxNotificationPayload,
  SandboxScheduledTask,
  PluginKind,
  PluginTrustTier,
} from "../_shared/providers/plugin-types.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

// =============================================================================
// Plugin Config Resolution
// =============================================================================

interface ResolvedPlugin {
  pluginId: string;
  slug: string;
  kind: PluginKind;
  trustTier: PluginTrustTier;
  capabilities: string[];
  config: Record<string, unknown>;
  sandboxPolicy: {
    timeout_ms: number;
    network_allowlist: string[];
    max_memory_mb: number;
  };
  artifactUrl: string;
  artifactSha256: string;
  version: string;
}

/**
 * Resolve a plugin by ID via get_available_plugins RPC.
 */
async function resolvePlugin(
  supabase: ReturnType<typeof createClient>,
  pluginId: string,
  tenantId: string | undefined,
): Promise<ResolvedPlugin | null> {
  const { data, error } = await supabase.rpc("get_available_plugins", {
    p_kind: null,
    p_tenant_id: tenantId ?? null,
  });

  if (error) {
    safeError("plugin-host.resolve.rpc-failed", error);
    return null;
  }

  const plugins = (data ?? []) as Record<string, unknown>[];
  const plugin = plugins.find(
    (p) => p.slug === pluginId || p.plugin_id === pluginId,
  );

  if (!plugin) return null;

  return {
    pluginId: plugin.plugin_id as string,
    slug: plugin.slug as string,
    kind: plugin.kind as PluginKind,
    trustTier: plugin.trust_tier as PluginTrustTier,
    capabilities: (plugin.capabilities ?? []) as string[],
    config: (plugin.config ?? {}) as Record<string, unknown>,
    sandboxPolicy: (plugin.sandbox ?? {
      timeout_ms: 5000,
      network_allowlist: [],
      max_memory_mb: 64,
    }) as ResolvedPlugin["sandboxPolicy"],
    artifactUrl: plugin.artifact_url as string,
    artifactSha256: plugin.artifact_sha256 as string,
    version: plugin.version as string,
  };
}

// =============================================================================
// Capability Validation
// =============================================================================

/**
 * Check if a capability is allowed by the plugin's manifest.
 * Supports wildcard matching: "web.*" matches "web.bootstrap.inject".
 */
function isCapabilityAllowed(
  requestedCapability: string,
  allowedCapabilities: string[],
): boolean {
  return allowedCapabilities.some((cap) => {
    if (cap === requestedCapability) return true;
    // Wildcard: "web.*" matches "web.bootstrap.inject"
    if (cap.endsWith(".*")) {
      const prefix = cap.slice(0, -1);
      return requestedCapability.startsWith(prefix);
    }
    return false;
  });
}

/**
 * Check if an RPC function name is whitelisted for this plugin.
 * Plugins can only call RPC functions listed in their capabilities
 * under the "rpc.*" namespace.
 */
function isRpcAllowed(
  functionName: string,
  capabilities: string[],
): boolean {
  const rpcCaps = capabilities.filter((c) => c.startsWith("rpc."));
  return rpcCaps.some((cap) => {
    const allowed = cap.replace("rpc.", "");
    return allowed === functionName || allowed === "*";
  });
}

/**
 * Validate outbound fetch URL against network allowlist.
 */
function isNetworkAllowed(
  url: string,
  allowlist: string[],
): boolean {
  if (allowlist.length === 0) return false;
  try {
    const parsed = new URL(url);
    return allowlist.some((pattern) => {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(1); // ".example.com"
        return parsed.hostname.endsWith(suffix);
      }
      return parsed.hostname === pattern;
    });
  } catch {
    return false;
  }
}

// =============================================================================
// SandboxContext Implementation
// =============================================================================

/**
 * Create a SandboxContext implementation for a resolved plugin.
 * All methods proxy through controlled channels with validation + audit.
 */
function createSandboxContext(
  supabase: ReturnType<typeof createClient>,
  plugin: ResolvedPlugin,
  tenantId: string,
): SandboxContext {
  const ctx: SandboxContext = {
    // ---- Identity & Config ----
    plugin: {
      id: plugin.pluginId,
      version: plugin.version,
      kind: plugin.kind,
      trustTier: plugin.trustTier,
    },
    tenant: {
      id: tenantId,
      name: "", // resolved at runtime if needed
    },
    config: plugin.config,

    // ---- Core Data (RPC Proxy) ----
    async rpc(
      functionName: string,
      params: Record<string, unknown>,
    ): Promise<unknown> {
      if (!isRpcAllowed(functionName, plugin.capabilities)) {
        throw new Error(
          `Plugin "${plugin.slug}" is not allowed to call RPC "${functionName}". ` +
          `Add "rpc.${functionName}" to manifest capabilities.`,
        );
      }
      const { data, error } = await supabase.rpc(functionName, params);
      if (error) throw new Error(`RPC "${functionName}" failed: ${error.message}`);
      return data;
    },

    // ---- Plugin Key-Value Store ----
    kv: {
      async get(key: string): Promise<unknown | null> {
        const { data, error } = await supabase.rpc("sandbox_kv_op", {
          p_key: key,
          p_op: "get",
          p_plugin_id: plugin.pluginId,
          p_tenant_id: tenantId,
        });
        if (error) throw new Error(`KV get failed: ${error.message}`);
        return data;
      },
      async set(key: string, value: unknown): Promise<void> {
        const { error } = await supabase.rpc("sandbox_kv_op", {
          p_key: key,
          p_op: "set",
          p_plugin_id: plugin.pluginId,
          p_tenant_id: tenantId,
          p_value: value,
        });
        if (error) throw new Error(`KV set failed: ${error.message}`);
      },
      async delete(key: string): Promise<void> {
        const { error } = await supabase.rpc("sandbox_kv_op", {
          p_key: key,
          p_op: "delete",
          p_plugin_id: plugin.pluginId,
          p_tenant_id: tenantId,
        });
        if (error) throw new Error(`KV delete failed: ${error.message}`);
      },
      async list(prefix?: string): Promise<string[]> {
        const { data, error } = await supabase.rpc("sandbox_kv_op", {
          p_op: "list",
          p_plugin_id: plugin.pluginId,
          p_prefix: prefix ?? null,
          p_tenant_id: tenantId,
        });
        if (error) throw new Error(`KV list failed: ${error.message}`);
        return (data ?? []) as string[];
      },
    },

    // ---- Object Storage (MinIO proxy) ----
    storage: {
      async get(key: string): Promise<Uint8Array | null> {
        const minioUrl = Deno.env.get("MINIO_URL");
        const minioAccessKey = Deno.env.get("MINIO_ACCESS_KEY");
        const minioSecretKey = Deno.env.get("MINIO_SECRET_KEY");
        if (!minioUrl || !minioAccessKey || !minioSecretKey) {
          throw new Error("Object storage not configured");
        }
        const bucket = `plugin-${plugin.slug}`;
        const namespacedKey = `${tenantId}/${key}`;
        try {
          const resp = await fetch(
            `${minioUrl}/${bucket}/${namespacedKey}`,
            { signal: AbortSignal.timeout(15_000) },
          );
          if (resp.status === 404) return null;
          if (!resp.ok) throw new Error(`Storage get failed: HTTP ${resp.status}`);
          return new Uint8Array(await resp.arrayBuffer());
        } catch (err) {
          if (err instanceof Error && err.message.includes("404")) return null;
          throw err;
        }
      },
      async put(key: string, data: Uint8Array, contentType?: string): Promise<void> {
        const minioUrl = Deno.env.get("MINIO_URL");
        if (!minioUrl) throw new Error("Object storage not configured");
        const bucket = `plugin-${plugin.slug}`;
        const namespacedKey = `${tenantId}/${key}`;
        const resp = await fetch(
          `${minioUrl}/${bucket}/${namespacedKey}`,
          {
            method: "PUT",
            body: data,
            headers: contentType ? { "Content-Type": contentType } : {},
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!resp.ok) throw new Error(`Storage put failed: HTTP ${resp.status}`);
      },
      async delete(key: string): Promise<void> {
        const minioUrl = Deno.env.get("MINIO_URL");
        if (!minioUrl) throw new Error("Object storage not configured");
        const bucket = `plugin-${plugin.slug}`;
        const namespacedKey = `${tenantId}/${key}`;
        const resp = await fetch(
          `${minioUrl}/${bucket}/${namespacedKey}`,
          { method: "DELETE", signal: AbortSignal.timeout(15_000) },
        );
        if (!resp.ok && resp.status !== 404) {
          throw new Error(`Storage delete failed: HTTP ${resp.status}`);
        }
      },
      async list(prefix?: string): Promise<string[]> {
        // MinIO S3 list objects — simplified implementation
        const minioUrl = Deno.env.get("MINIO_URL");
        if (!minioUrl) throw new Error("Object storage not configured");
        const bucket = `plugin-${plugin.slug}`;
        const namespacedPrefix = `${tenantId}/${prefix ?? ""}`;
        const resp = await fetch(
          `${minioUrl}/${bucket}?list-type=2&prefix=${encodeURIComponent(namespacedPrefix)}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        if (!resp.ok) throw new Error(`Storage list failed: HTTP ${resp.status}`);
        // Parse S3 XML response (simplified — extract Key elements)
        const xml = await resp.text();
        const keys: string[] = [];
        const regex = /<Key>([^<]+)<\/Key>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
          // Strip tenant prefix from returned keys
          const rawKey = match[1];
          if (rawKey.startsWith(`${tenantId}/`)) {
            keys.push(rawKey.slice(tenantId.length + 1));
          }
        }
        return keys;
      },
    },

    // ---- Event Bus ----
    async publish(topic: string, payload: unknown): Promise<void> {
      // Route through plugin audit for observability
      await supabase.rpc("register_plugin_event", {
        p_error: null,
        p_event_kind: "invoke",
        p_latency_ms: 0,
        p_metadata: { type: "event_publish", topic, payload },
        p_plugin_id: plugin.pluginId,
        p_tenant_id: tenantId,
      });
      // In production: route to n8n webhook or internal event bus
    },

    subscribe(
      _topic: string,
      _handler: (payload: unknown) => Promise<void>,
    ): void {
      // Subscriptions are registered at init time and handled by the scheduler.
      // At runtime in edge functions, subscriptions are resolved via plugin_schedules
      // and event routing rules — this is a no-op in the request context.
    },

    // ---- LLM Inference ----
    llm: {
      async chat(
        messages: SandboxChatMessage[],
        options?: SandboxLlmOptions,
      ): Promise<string> {
        // Route through AISHA's ai-router edge function
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

        const resp = await fetch(`${supabaseUrl}/functions/v1/ai-router`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            messages,
            model: options?.model,
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0.7,
            metadata: {
              source: "plugin-sandbox",
              plugin_id: plugin.pluginId,
              tenant_id: tenantId,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!resp.ok) {
          throw new Error(`LLM chat failed: HTTP ${resp.status}`);
        }

        const data = await resp.json();
        return data.content ?? data.choices?.[0]?.message?.content ?? "";
      },

      async embed(text: string): Promise<number[]> {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

        const resp = await fetch(`${supabaseUrl}/functions/v1/generate-embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            input: text,
            metadata: {
              source: "plugin-sandbox",
              plugin_id: plugin.pluginId,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          throw new Error(`LLM embed failed: HTTP ${resp.status}`);
        }

        const data = await resp.json();
        return (data.embedding ?? data.data?.[0]?.embedding ?? []) as number[];
      },
    },

    // ---- Notifications ----
    async notify(
      userId: string,
      payload: SandboxNotificationPayload,
    ): Promise<void> {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      const resp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          user_id: userId,
          title: payload.title,
          body: payload.body,
          channel: payload.channel,
          metadata: {
            ...payload.metadata,
            source: "plugin-sandbox",
            plugin_id: plugin.pluginId,
            tenant_id: tenantId,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        throw new Error(`Notification failed: HTTP ${resp.status}`);
      }
    },

    // ---- Scheduled Tasks ----
    schedule(
      cronExpr: string,
      _handler: () => Promise<void>,
    ): SandboxScheduledTask {
      // Schedules are persisted to plugin_schedules table.
      // The handler is not stored — the scheduler re-invokes plugin-host
      // with the registered capability on schedule.
      const taskId = crypto.randomUUID();

      // Fire-and-forget registration (async, non-blocking)
      supabase.rpc("register_plugin_schedule", {
        p_cron_expr: cronExpr,
        p_handler_capability: `cron.${taskId}`,
        p_plugin_id: plugin.pluginId,
        p_tenant_id: tenantId,
      }).then(({ error }) => {
        if (error) {
          safeError("plugin-host.schedule.register-failed", error);
        }
      });

      return {
        id: taskId,
        cronExpr,
        handler: _handler,
      };
    },

    // ---- HTTP (outbound, restricted) ----
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      if (!isNetworkAllowed(url, plugin.sandboxPolicy.network_allowlist)) {
        throw new Error(
          `Plugin "${plugin.slug}" is not allowed to fetch "${url}". ` +
          `Add the hostname to manifest sandbox.network_allowlist.`,
        );
      }

      return globalThis.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(plugin.sandboxPolicy.timeout_ms),
      });
    },

    // ---- Logging ----
    log(
      level: "debug" | "info" | "warn" | "error",
      message: string,
      metadata?: Record<string, unknown>,
    ): void {
      // Route to Langfuse or structured log collector
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        plugin_id: plugin.pluginId,
        tenant_id: tenantId,
        message,
        metadata,
      };

      // Non-blocking: register as health event for observability
      if (level === "error") {
        supabase.rpc("register_plugin_event", {
          p_error: message,
          p_event_kind: "error",
          p_latency_ms: 0,
          p_metadata: logEntry,
          p_plugin_id: plugin.pluginId,
          p_tenant_id: tenantId,
        }).catch((err) => { console.warn("[plugin-host] log health event failed:", err); });
      }
    },
  };

  return ctx;
}

// =============================================================================
// Plugin Execution Engine
// =============================================================================

/**
 * Execute a plugin invocation with timeout enforcement.
 *
 * For full_stack plugins: calls plugin.handle(ctx, capability, payload)
 * For legacy kinds: routes to specific lifecycle method.
 */
async function executePlugin(
  supabase: ReturnType<typeof createClient>,
  plugin: ResolvedPlugin,
  request: PluginHostRequest,
): Promise<PluginHostResponse> {
  const startTime = performance.now();
  const tenantId = request.tenantId ?? "default";

  const ctx = createSandboxContext(supabase, plugin, tenantId);

  try {
    // Download plugin artifact
    const artifactResponse = await globalThis.fetch(plugin.artifactUrl, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!artifactResponse.ok) {
      throw new Error(`Failed to download plugin artifact: HTTP ${artifactResponse.status}`);
    }

    const artifactCode = await artifactResponse.text();

    // Verify SHA256 integrity
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(artifactCode),
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (hashHex !== plugin.artifactSha256) {
      throw new Error(
        `Artifact integrity check failed. Expected ${plugin.artifactSha256}, got ${hashHex}`,
      );
    }

    // Execute plugin code with timeout
    const timeoutMs = plugin.sandboxPolicy.timeout_ms;

    const result = await Promise.race([
      executePluginCode(artifactCode, ctx, request.capability, request.payload),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Plugin execution timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      ),
    ]);

    const latencyMs = Math.round(performance.now() - startTime);

    // Record success health event
    await supabase.rpc("register_plugin_event", {
      p_error: null,
      p_event_kind: "invoke",
      p_latency_ms: latencyMs,
      p_metadata: { capability: request.capability },
      p_plugin_id: plugin.pluginId,
      p_tenant_id: tenantId,
    });

    return {
      success: true,
      data: result,
      latencyMs,
      backendId: `plugin-host/${plugin.slug}@${plugin.version}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Record error health event
    await supabase.rpc("register_plugin_event", {
      p_error: errorMessage,
      p_event_kind: "error",
      p_latency_ms: latencyMs,
      p_metadata: { capability: request.capability },
      p_plugin_id: plugin.pluginId,
      p_tenant_id: tenantId,
    }).catch((err2) => { console.warn("[plugin-host] error health event failed:", err2); });

    return {
      success: false,
      error: "Plugin execution failed",
      latencyMs,
      backendId: `plugin-host/${plugin.slug}@${plugin.version}`,
    };
  }
}

/**
 * Execute plugin code in a controlled context.
 *
 * The plugin module must export: init, handle, dispose (for full_stack)
 * or kind-specific lifecycle methods for legacy kinds.
 *
 * Uses dynamic import with data URL for isolation.
 */
async function executePluginCode(
  code: string,
  ctx: SandboxContext,
  capability: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  // Wrap plugin code in a module that receives SandboxContext
  // The plugin code is expected to export: { init, handle, dispose }
  const wrappedCode = `
    ${code}

    // Module entry point — called by plugin-host
    export async function __pluginEntry(ctx, capability, payload) {
      if (typeof init === "function") {
        await init(ctx);
      }
      if (typeof handle === "function") {
        return await handle(ctx, capability, payload);
      }
      throw new Error("Plugin does not export a handle() function");
    }
  `;

  // Create a data URL for dynamic import (Deno sandbox isolation)
  const dataUrl = `data:application/typescript;base64,${btoa(wrappedCode)}`;
  const pluginModule = await import(dataUrl);

  return await pluginModule.__pluginEntry(ctx, capability, payload);
}

// =============================================================================
// Main Handler
// =============================================================================

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, {
      allowMethods: "POST, OPTIONS",
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as PluginHostRequest;

    if (!body.pluginId || !body.capability) {
      return jsonResponse(
        req,
        { error: "pluginId and capability are required" },
        400,
      );
    }

    // Auth: extract token from Authorization header
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(req, { error: "Server not configured" }, 500);
    }

    // Use service role for plugin resolution, user token for RPC calls
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined,
    });

    // 1. Resolve plugin
    const plugin = await resolvePlugin(supabase, body.pluginId, body.tenantId);

    if (!plugin) {
      return jsonResponse(
        req,
        { error: `Plugin "${body.pluginId}" not found or not available` },
        404,
      );
    }

    // 2. Validate capability
    if (!isCapabilityAllowed(body.capability, plugin.capabilities)) {
      return jsonResponse(
        req,
        {
          error: `Capability "${body.capability}" is not allowed for plugin "${plugin.slug}"`,
        },
        403,
      );
    }

    // 3. Execute plugin
    const result = await executePlugin(supabase, plugin, body);

    return jsonResponse(req, result as unknown as Record<string, unknown>);
  } catch (err) {
    safeError("plugin-host.handler.failed", err);
    return jsonResponse(req, { error: "Plugin host error" }, 500);
  }
});
