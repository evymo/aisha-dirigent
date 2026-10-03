import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { reflectionConfig as config } from '../config.js';

/**
 * OpenClaw advisory nodes — reflection runs can request a plan, dry-run risky
 * workflows in a sandbox, or send a multi-channel notification. All paths
 * write an audit row (via aisha_*_openclaw RPCs) and then issue the HTTP call
 * to OpenClaw if it is configured. Degradation-safe: when OPENCLAW_URL is
 * absent, nodes return `skipped` and the graph continues.
 *
 * Why "advisory": OpenClaw never executes side-effects directly. It produces
 * recommendations; AISHA decides whether to act on them (via n8n workflows
 * and reflection orchestrator). This boundary keeps the source-of-truth in
 * AISHA's RPC layer + ai_runs.
 */

export async function postToOpenclaw(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!config.openclawUrl || !config.openclawApiKey) {
    return { ok: false, status: 503, data: { error: 'openclaw_not_configured' } };
  }
  const url = `${config.openclawUrl.replace(/\/$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openclawApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 502, data: { error: 'openclaw_unreachable', detail: String(err).slice(0, 200) } };
  }
}

/**
 * openclaw_plan — request a multi-step execution plan from OpenClaw.
 */
export const openclawPlan: NodeHandler = async (ctx) => {
  if (!config.enableOpenclaw || !config.openclawUrl) {
    return {
      output_data: { skipped: 'openclaw_disabled' },
      state_patch: { execution_plan: null },
      transition_key: 'skipped',
    };
  }

  const cfg = ctx.node.config;
  const task = (ctx.run.metadata.input ?? {}) as Record<string, unknown>;
  const constraints = (cfg.constraints as Record<string, unknown>) ?? {};

  // Audit + request_id via RPC (single source of truth for "AISHA asked OpenClaw").
  const audit = await rpc<{ request_id?: string }>('aisha_request_plan_from_openclaw', {
    p_task: { description: task.description, type: cfg.task_type ?? task.type ?? 'general' },
    p_constraints: constraints,
    p_related_run_id: ctx.run.id,
  }).catch(() => null);

  const remote = await postToOpenclaw('/api/plan', {
    request_id: audit?.request_id ?? null,
    task: { description: task.description, type: cfg.task_type ?? task.type ?? 'general' },
    constraints,
  });

  if (!remote.ok) {
    return {
      output_data: {
        error: 'openclaw_plan_unavailable',
        status: remote.status,
        detail: (remote.data as Record<string, unknown>)?.error,
      },
      state_patch: { execution_plan: null },
      transition_key: 'failed',
    };
  }

  return {
    output_data: { plan: remote.data, request_id: audit?.request_id },
    state_patch: { execution_plan: remote.data },
    transition_key: 'planned',
  };
};

/**
 * openclaw_sandbox — dry-run a workflow JSON before applying for real.
 */
export const openclawSandbox: NodeHandler = async (ctx) => {
  if (!config.enableOpenclaw || !config.openclawUrl) {
    return {
      output_data: { skipped: 'openclaw_disabled' },
      transition_key: 'skipped',
    };
  }

  const cfg = ctx.node.config;
  const timeoutS = (cfg.timeout_s as number) ?? 120;
  const workflow = (ctx.state.execution_plan ?? ctx.state.last_generation) as Record<string, unknown> | null;
  const inputs = (cfg.inputs as Record<string, unknown>) ?? {};

  if (!workflow || (typeof workflow !== 'object' && typeof workflow !== 'string')) {
    return {
      output_data: { skipped: 'no_workflow_to_sandbox' },
      transition_key: 'skipped',
    };
  }

  // Audit
  const audit = await rpc<{ request_id?: string }>('aisha_dryrun_in_openclaw_sandbox', {
    p_workflow_json: typeof workflow === 'string' ? { raw: workflow } : workflow,
    p_inputs: inputs,
    p_timeout_s: timeoutS,
    p_related_run_id: ctx.run.id,
  }).catch(() => null);

  const remote = await postToOpenclaw(
    '/api/sandbox',
    {
      request_id: audit?.request_id ?? null,
      workflow_json: workflow,
      inputs,
      timeout_s: timeoutS,
    },
    Math.min((timeoutS + 30) * 1000, 600000),
  );

  if (!remote.ok) {
    return {
      output_data: {
        error: 'openclaw_sandbox_unavailable',
        status: remote.status,
        detail: (remote.data as Record<string, unknown>)?.error,
      },
      transition_key: 'failed',
    };
  }

  const data = remote.data as { success?: boolean; warnings?: unknown[]; simulated_effects?: unknown };
  const warningsLen = Array.isArray(data.warnings) ? data.warnings.length : 0;
  return {
    output_data: { ...data, request_id: audit?.request_id },
    state_patch: { sandbox_result: data },
    transition_key:
      data.success && warningsLen === 0 ? 'safe' : warningsLen > 0 ? 'has_warnings' : 'unsafe',
  };
};

/**
 * openclaw_notify — enqueue an outbound notification (no synchronous HTTP).
 * n8n WF_OPENCLAW_NOTIFY dispatches every 30s.
 */
export const openclawNotify: NodeHandler = async (ctx) => {
  if (!config.enableOpenclaw) {
    return {
      output_data: { skipped: 'openclaw_disabled' },
      transition_key: 'skipped',
    };
  }

  const cfg = ctx.node.config;
  const channel = (cfg.channel as string) ?? 'in_app';
  const recipient = (cfg.recipient as string) ?? 'dirigent';
  const template = (cfg.template as string) ?? 'run_event';

  const payload = {
    run_id: ctx.run.id,
    node_id: ctx.node.id,
    template,
    state_summary: {
      last_critic_overall: ctx.state.last_critic_overall ?? null,
      pending_approval: ctx.state.pending_approval ?? null,
      iteration: ctx.iteration,
    },
  };

  try {
    const result = await rpc<{ notification_id: string; status: string }>('aisha_notify_via_openclaw', {
      p_channel: channel,
      p_recipient: recipient,
      p_payload: payload,
      p_template: template,
      p_agent_slug: 'aisha',
      p_related_run_id: ctx.run.id,
      p_story_id: ctx.run.story_id,
    });
    return {
      output_data: { ...result, channel, recipient },
      transition_key: 'notified',
    };
  } catch (err) {
    return {
      output_data: { error: 'notify_enqueue_failed', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
    };
  }
};
