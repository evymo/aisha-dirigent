/**
 * Notify — enqueue a multi-channel notification request.
 *
 * Per the advisory boundary: this daemon DOES NOT dispatch. It writes
 * an outbox row via the `aisha_notify_via_openclaw` RPC (applied by
 * 20260515114000_openclaw_advisory.sql). n8n's WF_OPENCLAW_NOTIFY worker
 * polls the outbox every 30s and performs the actual dispatch via
 * Slack/Telegram/Matrix/Discord/email native nodes.
 *
 * Why this layer exists: callers (services/svc-ai-chat) already call
 * the RPC directly via PostgREST. The daemon path is an alternative for
 * components that don't have PostgREST access but DO have HTTP access
 * to OpenClaw. Both paths land in the same outbox.
 *
 * Audit: row written by the calling RPC itself (service-role JWT).
 *
 * OWASP A10: outbound fetch to PostgREST goes through `ssrf.safeFetch`.
 * The `postgrest` host must be in OPENCLAW_OUTBOUND_HOSTS (config.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { SsrfGuard } from '@aisha/security';
import { config } from './config.js';

interface NotifyInput {
  request_id?: string | null;
  channel: 'telegram' | 'slack' | 'matrix' | 'discord' | 'email' | 'in_app';
  recipient?: string;
  payload: Record<string, unknown>;
  template?: string;
  agent_slug?: string;
  related_run_id?: string;
  story_id?: string;
}

interface NotifyResult {
  request_id: string | null;
  notification_id: string;
  status: 'queued';
  channel: NotifyInput['channel'];
}

interface RpcResponse {
  notification_id?: string;
  id?: string;
  status?: string;
}

export async function enqueueNotification(
  input: NotifyInput,
  log: FastifyBaseLogger,
  ssrf: SsrfGuard,
): Promise<NotifyResult> {
  const req_id = input.request_id ?? null;

  if (!config.postgrestUrl || !config.postgrestServiceJwt) {
    // Without PostgREST access we can't reach the outbox. This is a
    // configuration error — surface as 503 so callers can degrade.
    throw new Error('postgrest_not_configured');
  }

  const url = `${config.postgrestUrl.replace(/\/$/, '')}/rpc/aisha_notify_via_openclaw`;
  const body = {
    p_channel: input.channel,
    p_recipient: input.recipient ?? null,
    p_payload: input.payload,
    p_template: input.template ?? null,
    p_agent_slug: input.agent_slug ?? null,
    p_related_run_id: input.related_run_id ?? null,
    p_story_id: input.story_id ?? null,
  };

  let res: Response;
  try {
    res = await ssrf.safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.postgrestServiceJwt}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.notifyTimeoutMs),
    });
  } catch (err) {
    log.error({ req_id, err: String(err) }, 'notify: postgrest unreachable');
    throw new Error(`postgrest_unreachable: ${String(err).slice(0, 120)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    log.error(
      { req_id, status: res.status, detail: detail.slice(0, 200) },
      'notify: rpc failed',
    );
    throw new Error(`rpc_failed: HTTP ${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as RpcResponse | RpcResponse[] | null;
  const row: RpcResponse = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
  const notificationId = row.notification_id ?? row.id ?? '';

  if (!notificationId) {
    log.error({ req_id, row }, 'notify: rpc returned no notification_id');
    throw new Error('rpc_returned_no_id');
  }

  return {
    request_id: req_id,
    notification_id: notificationId,
    status: 'queued',
    channel: input.channel,
  };
}
