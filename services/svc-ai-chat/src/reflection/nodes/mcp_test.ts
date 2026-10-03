import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { reflectionConfig as config } from '../config.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
/**
 * mcp_test — probe an MCP server before AISHA relies on it.
 *
 * Two-step pattern (mirrors openclaw_plan/sandbox):
 *   1. Audit via aisha_test_mcp_server RPC → returns probe payload + test_id
 *   2. Issue HTTP probe (http/sse) here; stdio probes deferred to
 *      svc-agent-runner sandbox in a follow-up.
 *   3. Record outcome via aisha_record_mcp_test_result RPC.
 *
 * Config:
 *   - slug (required)            — mcp_server_registry.slug
 *   - probe_method (default tools/list)
 *   - timeout_ms (default 15000)
 *   - require_methods (text[])   — fail node if these methods are NOT exposed
 */
export const mcpTest: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const slug = cfg.slug as string | undefined;
  if (!slug) {
    return {
      output_data: { error: 'config.slug required' },
      fatal_error: 'mcp_test node requires config.slug (mcp_server_registry slug)',
    };
  }
  const probeMethod = (cfg.probe_method as string) ?? 'tools/list';
  const timeoutMs = (cfg.timeout_ms as number) ?? 15_000;
  const requireMethods = (cfg.require_methods as string[]) ?? [];

  // 1. Audit + load probe payload
  let audit;
  try {
    audit = await rpc<{
      test_id: string;
      payload: {
        transport: string;
        endpoint_url: string | null;
        stdio_command: string[] | null;
        auth_kind: string;
        auth_env_var: string | null;
        probe_method: string;
      };
    }>('aisha_test_mcp_server', { p_probe_method: probeMethod, p_slug: slug });
  } catch (err) {
    return {
      output_data: { error: 'audit_rpc_failed', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
    };
  }

  // 2. Probe (http/sse only — stdio left to sandbox runner)
  const probeStartedAt = Date.now();
  let ok = false;
  let latencyMs = 0;
  let supportedMethods: string[] = [];
  let sampleExcerpt: string | null = null;
  let errorMsg: string | null = null;

  if (audit?.payload?.transport === 'http' || audit?.payload?.transport === 'sse') {
    try {
      const token = audit.payload.auth_env_var ? process.env[audit.payload.auth_env_var] : undefined;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      // OWASP A10 — endpoint_url is user-registered MCP endpoint; route
      // through SSRF guard so DNS rebinding / internal-IP probing is rejected.
      const { createSsrfGuard, parseHostAllowlist } = await import('@aisha/security');
      const guard = createSsrfGuard({
        service: 'svc-ai-chat',
        hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
        allowedSchemes: ['https:', 'http:'],
        allowInternalNetworks: true, // MCP registry may target intra-mesh services
      });
      const res = await guard.safeFetch(audit.payload.endpoint_url ?? '', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: audit.test_id,
          method: audit.payload.probe_method,
          params: {},
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      latencyMs = Date.now() - probeStartedAt;
      const text = await res.text();
      sampleExcerpt = text.slice(0, 280);
      ok = res.ok;
      try {
        const parsedResp = JSON.parse(text) as { result?: { tools?: Array<{ name: string }> } };
        const tools = parsedResp.result?.tools;
        if (Array.isArray(tools)) {
          supportedMethods = tools.map((t) => t.name).slice(0, 50);
        }
      } catch {
        // sample retained as text only
      }
      if (!ok) errorMsg = `HTTP ${res.status}`;
    } catch (err) {
      latencyMs = Date.now() - probeStartedAt;
      ok = false;
      errorMsg = String(err).slice(0, 200);
    }
  } else {
    ok = false;
    errorMsg = `transport=${audit?.payload?.transport} requires sandbox runner; deferred`;
  }

  // 3. Capability gate: require_methods must all be present
  if (ok && requireMethods.length > 0) {
    const missing = requireMethods.filter((m) => !supportedMethods.includes(m));
    if (missing.length > 0) {
      ok = false;
      errorMsg = `missing required methods: ${missing.join(',')}`;
    }
  }

  // 4. Record outcome
  try {
    await rpc<Record<string, unknown>>('aisha_record_mcp_test_result', {
      p_slug: slug,
      p_ok: ok,
      p_latency_ms: latencyMs,
      p_supported_methods: supportedMethods,
      p_sample_response_excerpt: sampleExcerpt,
      p_error: errorMsg,
    });
  } catch (err) {
    // record failure should not break the graph; advisory log only
    log.safeWarn('[mcp_test] aisha_record_mcp_test_result failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // The provided config flag soft_fail controls whether a failed test halts
  // the graph or merely emits a transition_key the caller can branch on.
  const softFail = (cfg.soft_fail as boolean) ?? true;

  return {
    output_data: {
      slug,
      ok,
      latency_ms: latencyMs,
      supported_methods: supportedMethods,
      error: errorMsg,
      probe_method: probeMethod,
    },
    state_patch: {
      [`mcp_test_${slug}`]: { ok, supported_methods: supportedMethods, latency_ms: latencyMs },
    },
    transition_key: ok ? 'mcp_ok' : 'mcp_failed',
    fatal_error: !ok && !softFail ? `MCP probe failed for ${slug}: ${errorMsg}` : undefined,
  };
};
