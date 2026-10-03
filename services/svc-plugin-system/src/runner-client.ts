/**
 * runner-client.ts — HTTP client for svc-agent-runner.
 *
 * Called by execute.ts when agentRunnerEnabled=true to dispatch
 * plugin execution to the isolated runner service instead of running
 * plugin code in-process with AsyncFunction.
 */

import { config } from './config.js';

/** Deklarace rozvrhu z init() pluginu (shim → runner). `capability: null` = starý tvar. */
export interface ScheduleDeclaration {
  cron: string;
  capability: string | null;
}

export interface RunnerResult {
  run_id: string;
  status: 'succeeded' | 'failed' | 'timeout';
  exit_code: number;
  result: unknown;
  /** Runner starší než 2026-09-16 pole nevydá (undefined) — pak se rozvrhy NEPŘEPISUJÍ. */
  schedules?: ScheduleDeclaration[];
  logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>;
  duration_ms: number;
}

export async function runPluginInSandbox(args: {
  pluginSlug: string;
  action: string;
  params: Record<string, unknown>;
  image: string;
  codeB64: string;
  codeSha256: string;
  userId: string;
  timeoutMs: number;
  serviceToken: string;
  /** Version being run — the plugin reads it as `ctx.plugin.version`. */
  pluginVersion: string;
  /**
   * Tenant the run is attributed to — `ctx.tenant.id`.
   *
   * Always the AUTHORIZED tenant from execute.ts `urcitTenanta` (the verified
   * user, or a tenant an admin/staff named explicitly) — never a raw request
   * field: the plugin sends it into RPCs the broker runs with the service role.
   */
  tenantId: string;
}): Promise<RunnerResult> {
  const payload = {
    plugin_slug: args.pluginSlug,
    action: args.action,
    params: args.params,
    code_sha256: args.codeSha256,
    plugin_code: Buffer.from(args.codeB64, 'base64').toString('utf-8'),
    plugin_version: args.pluginVersion,
    tenant_id: args.tenantId,
    // ⛔ ŽÁDNÁ konfigurace: payload jede v ENV kontejneru (PLUGIN_PAYLOAD) a nesmí
    // nést pověření. Shim si ji vyzvedne přes broker (/sandbox/config) na token běhu.
  };

  const res = await fetch(`${config.agentRunnerUrl}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.serviceToken}`,
    },
    body: JSON.stringify({
      kind: 'plugin-exec',
      profile: 'docker',
      image: args.image,
      source: `plugin:${args.pluginSlug}`,
      source_ref: args.pluginSlug,
      payload,
      timeout_ms: args.timeoutMs,
    }),
    signal: AbortSignal.timeout(args.timeoutMs + 10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Agent runner error ${res.status}: ${detail.slice(0, 300)}`);
  }

  return (await res.json()) as RunnerResult;
}
