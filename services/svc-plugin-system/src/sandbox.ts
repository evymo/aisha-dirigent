import { createHash } from 'node:crypto';
import {
  constantTimeStringCompare,
  createSsrfGuard,
  SsrfBlockedError,
  parseHostAllowlist,
} from '@aisha/security';
import { config } from './config.js';
import { callGovernedLlm } from './llm-router.js';
import { rpcSandboxed, rpcService } from './postgrest.js';

// ── Types ──

export interface PluginManifest {
  /** plugin_catalog.id — klíč telemetrie (plugin_health_events) a povolení zdroje. */
  id: string;
  slug: string;
  version: string;
  name: string;
  description: string;
  capabilities: string[];
  /** Fully-qualified download URL for the plugin artifact (from plugin_versions.artifact_url). */
  artifactUrl: string;
  /** Expected SHA-256 of the artifact (from plugin_versions.artifact_sha256). */
  sha256: string;
  status: string;
  /**
   * Per-tenant configuration the plugin reads as `ctx.config` — for a connector
   * the endpoint and the credentials.
   *
   * ⛔ It does NOT come from get_available_plugins. The catalog is callable by
   * anon (public /agents) and by plugins themselves through the sandbox broker,
   * so it must never carry `plugin_tenant_overrides.config_override` (vendor
   * credentials); since 2026-09-15 the SQL does not project it. The runtime
   * source belongs to tenant resolution on this host, which does not exist yet
   * (this host has no verified tenant — see runner-client.ts tenantId), so the
   * value is empty — exactly what the catalog yielded before, because
   * resolvePlugin never passed p_tenant_id.
   */
  config: Record<string, unknown>;
}

/**
 * Raw row shape emitted by the get_available_plugins RPC. The SQL projects the
 * artifact identity as `artifact_url` / `artifact_sha256` and only ever returns
 * rows whose status is in ('canary','ga') — never 'active'. resolvePlugin
 * bridges these field names into the PluginManifest consumed downstream.
 */
interface PluginCatalogRow {
  plugin_id: string;
  slug: string;
  version: string;
  name: string;
  description: string;
  capabilities: string[];
  status: string;
  artifact_url: string;
  artifact_sha256: string;
}

export interface SandboxContext {
  /** RPC call (sandboxed to whitelist) */
  rpc: <T = unknown>(fn: string, params: Record<string, unknown>) => Promise<T>;
  /** Key-value store scoped to plugin */
  kv: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  /** Fetch with network allowlist enforcement */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** LLM completion through the governed AISHA router */
  llm: (prompt: string, options?: { model?: string; maxTokens?: number }) => Promise<string>;
  /** Send push notification */
  notify: (userId: string, title: string, body: string) => Promise<void>;
  /** Log for plugin audit trail */
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

// ── Plugin resolution ──

export async function resolvePlugin(slug: string): Promise<PluginManifest | null> {
  const rows = await rpcService<PluginCatalogRow[]>('get_available_plugins', {});
  // get_available_plugins filters `status IN ('canary','ga')` in SQL, so accept
  // exactly those statuses here — filtering on 'active' (which the RPC never
  // emits) would 404 every plugin.
  const row = rows.find(
    (p) =>
      p.slug === slug &&
      (p.status === 'canary' ||
        p.status === 'ga'),
  );
  if (!row) return null;
  // Bridge the RPC's real artifact field names (artifact_url / artifact_sha256)
  // into the manifest shape consumed by the execute route.
  return {
    id: row.plugin_id,
    capabilities: row.capabilities,
    description: row.description,
    name: row.name,
    slug: row.slug,
    status: row.status,
    version: row.version,
    artifactUrl: row.artifact_url,
    sha256: row.artifact_sha256,
    // No configuration source yet (see PluginManifest.config) — and never the
    // catalog row, even if a future SQL change put `config` back into it.
    config: {},
  };
}

/** Validate plugin capabilities against required set */
export function validateCapabilities(
  pluginCapabilities: string[],
  requiredCapabilities: string[],
): boolean {
  return requiredCapabilities.every((req) =>
    pluginCapabilities.some((cap) => {
      if (cap === '*') return true;
      if (cap === req) return true;
      // Wildcard matching: "rpc.*" matches "rpc.read"
      if (cap.endsWith('.*')) {
        const prefix = cap.slice(0, -2);
        return req.startsWith(prefix + '.');
      }
      return false;
    }),
  );
}

// ── Sandbox context factory ──

export function createSandboxContext(
  pluginSlug: string,
  userId: string,
  logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>,
): SandboxContext {
  return {
    rpc: <T = unknown>(fn: string, params: Record<string, unknown>) => rpcSandboxed<T>(fn, params),

    kv: {
      get: async (key: string) =>
        rpcService<unknown>('plugin_kv_get', { p_key: key, p_plugin: pluginSlug }),
      set: async (key: string, value: unknown) => {
        await rpcService('plugin_kv_set', { p_key: key, p_plugin: pluginSlug, p_value: value });
      },
      delete: async (key: string) => {
        await rpcService('plugin_kv_delete', { p_key: key, p_plugin: pluginSlug });
      },
    },

    fetch: async (url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:') {
        throw new Error(`Plugin network access to '${parsedUrl.protocol}' URLs is not allowed`);
      }
      if (config.networkAllowlist.length === 0) {
        throw new Error('No network destinations are allowed for this plugin');
      }
      const allowed = config.networkAllowlist.some(
        (pattern) => parsedUrl.hostname === pattern || parsedUrl.hostname.endsWith('.' + pattern),
      );
      if (!allowed) {
        throw new Error(`Plugin network access to '${parsedUrl.hostname}' is not allowed`);
      }
      return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    },

    llm: async (prompt: string, options?: { model?: string; maxTokens?: number }) => {
      return callGovernedLlm({
        maxTokens: options?.maxTokens,
        model: options?.model,
        pluginSlug,
        prompt,
        userId,
      });
    },

    notify: async (targetUserId: string, title: string, body: string) => {
      await fetch(`${config.pushServiceUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: targetUserId,
          title,
          body,
          source: `plugin:${pluginSlug}`,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    },

    log: (level: string, message: string, meta?: Record<string, unknown>) => {
      logs.push({ level, message, meta });
    },
  };
}

// ── Artifact download & verification ──

/**
 * SSRF guard for the plugin-artifact download.
 *
 * `artifactUrl` comes from the registry (`plugin_versions.artifact_url`), i.e.
 * from data — not from trusted service config — so a tampered row could point
 * the fetch at an internal host (cloud metadata, a sibling service). The
 * SHA-256 check below only validates *content* and runs *after* the request,
 * so it does nothing to stop the request itself. We therefore pin the fetch to
 * the configured artifact store host + scheme (plus any operator allowlist).
 * `allowInternalNetworks` is true because the store (MinIO) is intra-cluster —
 * but loopback / 169.254 metadata / multicast stay blocked even so.
 */
function artifactGuard() {
  const store = new URL(config.s3Endpoint);
  return createSsrfGuard({
    service: 'svc-plugin-system',
    hostAllowlist: [store.hostname, ...parseHostAllowlist(config.ssrfHostAllowlist)],
    allowedSchemes: [store.protocol],
    allowInternalNetworks: true,
  });
}

export async function downloadAndVerifyArtifact(
  artifactUrl: string,
  expectedSha256: string,
): Promise<string> {
  let res: Response;
  try {
    res = await artifactGuard().safeFetch(artifactUrl, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new Error(`Plugin artifact URL blocked by SSRF guard (${err.reason}): ${artifactUrl}`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to download plugin artifact: ${res.status}`);

  const code = await res.text();

  // SHA-256 verification — constant-time compare so an attacker cannot
  // leak bytes of the expected hash through response-timing differences.
  // Same pattern wave 9c/10b applied across service-role token + HMAC
  // verifications. Integrity-hash compares belong on that same list.
  const hash = createHash('sha256').update(code).digest('hex');
  if (!constantTimeStringCompare(hash, expectedSha256)) {
    throw new Error(`Plugin artifact SHA-256 mismatch: expected ${expectedSha256}, got ${hash}`);
  }

  return code;
}
