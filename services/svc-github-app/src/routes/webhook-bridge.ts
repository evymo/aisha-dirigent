import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { rpcService } from '../postgrest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookPayload {
  action?: string;
  installation?: {
    id: number;
    account: { login: string; type: string };
    permissions?: Record<string, string>;
    repository_selection?: string;
  };
  repositories_added?: Array<{ id: number; full_name: string; private: boolean; default_branch?: string }>;
  repositories_removed?: Array<{ id: number; full_name: string }>;
  repository?: { full_name: string; default_branch?: string };
  sender?: { login: string };
}

interface EnrichmentContext {
  story_id: string | null;
  partner_id: string | null;
  installation_id: number | null;
}

// ---------------------------------------------------------------------------
// Signature verification (HMAC-SHA256, timing-safe)
// ---------------------------------------------------------------------------

function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

  if (expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Installation lifecycle handlers
// ---------------------------------------------------------------------------

async function handleInstallationCreated(body: WebhookPayload): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  try {
    await rpcService('upsert_github_app_installation', {
      p_account_login: inst.account.login,
      p_account_type: inst.account.type,
      p_installation_id: inst.id,
      p_permissions: inst.permissions ?? {},
      p_repository_selection: inst.repository_selection ?? 'selected',
    });
  } catch {
    // non-critical
  }

  if (body.repositories_added?.length) {
    await syncRepositories(inst.id, body.repositories_added, []);
  }

  await rpcService('write_audit_journal', {
    p_action_type: 'integration',
    p_area: 'system',
    p_details: { installation_id: inst.id, account_login: inst.account.login, account_type: inst.account.type },
    p_entity_type: 'github_app',
    p_severity: 'info',
    p_summary: 'GITHUB_APP_INSTALLED',
    p_user_id: null,
  });
}

async function handleInstallationRemoved(body: WebhookPayload, isSuspend: boolean): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  try {
    await rpcService('set_github_app_installation_suspended', {
      p_installation_id: inst.id,
      p_suspended: true,
    });
  } catch {
    // non-critical
  }

  await rpcService('write_audit_journal', {
    p_action_type: 'integration',
    p_area: 'system',
    p_details: { installation_id: inst.id, account_login: inst.account.login },
    p_entity_type: 'github_app',
    p_severity: 'warning',
    p_summary: isSuspend ? 'GITHUB_APP_SUSPENDED' : 'GITHUB_APP_UNINSTALLED',
    p_user_id: null,
  });
}

async function handleInstallationUnsuspend(body: WebhookPayload): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  try {
    await rpcService('set_github_app_installation_suspended', {
      p_installation_id: inst.id,
      p_suspended: false,
    });
  } catch {
    // non-critical
  }
}

async function syncRepositories(
  installationId: number,
  added: Array<{ id: number; full_name: string; private: boolean; default_branch?: string }>,
  removed: Array<{ id: number; full_name: string }>,
): Promise<void> {
  if (added.length > 0) {
    const rows = added.map((repo) => ({
      installation_id: installationId,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      is_private: repo.private ?? true,
      default_branch: repo.default_branch ?? 'main',
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    try {
      await rpcService('upsert_github_app_repositories', { p_rows: rows });
    } catch {
      // non-critical
    }
  }

  if (removed.length > 0) {
    const repoIds = removed.map((r) => r.id);
    try {
      await rpcService('deactivate_github_app_repositories', {
        p_installation_id: installationId,
        p_repo_ids: repoIds,
      });
    } catch {
      // non-critical
    }
  }
}

// ---------------------------------------------------------------------------
// Event routing → n8n
// ---------------------------------------------------------------------------

function resolveWebhookPath(event: string, action: string | undefined): string | null {
  switch (event) {
    case 'pull_request':
      if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
        return '/webhook/pr-compliance-gate';
      }
      return null;
    case 'push':
      return '/webhook/push-deploy';
    case 'issues':
    case 'issue_comment':
      return '/webhook/issue-handler';
    case 'check_suite':
    case 'check_run':
      return '/webhook/check-status';
    case 'workflow_run':
      return '/webhook/workflow-status';
    default:
      return '/webhook/github-catchall';
  }
}

// ---------------------------------------------------------------------------
// Context enrichment
// ---------------------------------------------------------------------------

async function enrichContext(body: WebhookPayload): Promise<EnrichmentContext> {
  const installationId = body.installation?.id ?? null;
  const repoFullName = body.repository?.full_name;

  if (!repoFullName) {
    return { story_id: null, partner_id: null, installation_id: installationId };
  }

  try {
    const data = await rpcService<{ story_id?: string; partner_id?: string; installation_id?: number }>(
      'resolve_story_from_repo',
      { p_repo_full_name: repoFullName },
    );
    return {
      story_id: data?.story_id ?? null,
      partner_id: data?.partner_id ?? null,
      installation_id: data?.installation_id ?? installationId,
    };
  } catch {
    return { story_id: null, partner_id: null, installation_id: installationId };
  }
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

async function recordEvent(
  delivery: string,
  eventType: string,
  context: EnrichmentContext,
  webhookPath: string | null,
): Promise<{ event_id: string; is_duplicate: boolean } | null> {
  try {
    return await rpcService<{ event_id: string; is_duplicate: boolean }>('record_integration_event', {
      p_event_source: 'github_webhook',
      p_event_type: eventType,
      p_external_id: delivery,
      p_installation_id: context.installation_id,
      p_partner_id: context.partner_id,
      p_routed_to: webhookPath,
      p_story_id: context.story_id,
    });
  } catch {
    return null;
  }
}

async function completeEvent(
  eventId: string,
  status: 'completed' | 'failed',
  n8nExecutionId?: string,
  errorJson?: Record<string, unknown>,
): Promise<void> {
  try {
    await rpcService('complete_integration_event', {
      p_error_json: errorJson ? JSON.stringify(errorJson) : null,
      p_event_id: eventId,
      p_n8n_execution_id: n8nExecutionId ?? null,
      p_status: status,
    });
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function webhookBridgeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook', { config: { rawBody: true } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const n8nBaseUrl = config.n8nWebhookUrl;
    if (!n8nBaseUrl) {
      req.log.error('N8N_WEBHOOK_URL not configured');
      return reply.code(500).send({ error: 'Server misconfiguration' });
    }

    const event = (req.headers['x-github-event'] as string) ?? 'unknown';
    const delivery = (req.headers['x-github-delivery'] as string) ?? crypto.randomUUID();
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Signature verification
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    if (config.githubWebhookSecret) {
      if (!verifyGitHubSignature(rawBody, signature, config.githubWebhookSecret)) {
        req.log.warn({ delivery, event }, 'Invalid webhook signature');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    const body = req.body as WebhookPayload;
    const action = body.action;
    const eventType = action ? `${event}.${action}` : event;

    // Installation lifecycle — DB only, no n8n
    if (event === 'installation') {
      switch (action) {
        case 'created':
          await handleInstallationCreated(body);
          return reply.send({ ok: true, event: eventType, delivery, handled: 'installation_created' });
        case 'deleted':
          await handleInstallationRemoved(body, false);
          return reply.send({ ok: true, event: eventType, delivery, handled: 'installation_deleted' });
        case 'suspend':
          await handleInstallationRemoved(body, true);
          return reply.send({ ok: true, event: eventType, delivery, handled: 'installation_suspended' });
        case 'unsuspend':
          await handleInstallationUnsuspend(body);
          return reply.send({ ok: true, event: eventType, delivery, handled: 'installation_unsuspended' });
      }
    }

    if (event === 'installation_repositories') {
      const installationId = body.installation?.id;
      if (installationId) {
        await syncRepositories(installationId, body.repositories_added ?? [], body.repositories_removed ?? []);
      }
      return reply.send({ ok: true, event: eventType, delivery, handled: 'repos_synced' });
    }

    // Standard event routing
    const webhookPath = resolveWebhookPath(event, action);
    if (!webhookPath) {
      return reply.send({ ok: true, ignored: true, event: eventType });
    }

    const context = await enrichContext(body);
    const eventRecord = await recordEvent(delivery, eventType, context, webhookPath);

    if (eventRecord?.is_duplicate) {
      return reply.send({ ok: true, duplicate: true, event: eventType, delivery });
    }

    // Forward to n8n
    const targetUrl = `${n8nBaseUrl.replace(/\/$/, '')}${webhookPath}`;
    req.log.info({ event: eventType, delivery, targetUrl }, 'Forwarding to n8n');

    try {
      const enrichedPayload = JSON.stringify({
        ...body,
        _aisha: {
          delivery,
          event_type: eventType,
          story_id: context.story_id,
          partner_id: context.partner_id,
          installation_id: context.installation_id,
          event_id: eventRecord?.event_id ?? null,
        },
      });

      const n8nRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': delivery,
          'X-Forwarded-By': 'aisha-webhook-bridge',
        },
        body: enrichedPayload,
        signal: AbortSignal.timeout(30_000),
      });

      const n8nStatus = n8nRes.status;
      let n8nBody: string;
      try {
        n8nBody = await n8nRes.text();
      } catch {
        n8nBody = '(empty)';
      }

      let executionId: string | undefined;
      try {
        const parsed = JSON.parse(n8nBody) as Record<string, unknown>;
        executionId = (parsed.executionId as string) ?? undefined;
      } catch {
        // not JSON
      }

      if (n8nStatus >= 400) {
        req.log.error({ n8nStatus, n8nBody: n8nBody.substring(0, 200) }, 'n8n returned error');
        if (eventRecord?.event_id) {
          await completeEvent(eventRecord.event_id, 'failed', executionId, {
            message: `n8n returned ${n8nStatus}`,
            n8n_status: n8nStatus,
          });
        }
      } else if (eventRecord?.event_id) {
        await completeEvent(eventRecord.event_id, 'completed', executionId);
      }

      return reply.code(n8nStatus < 400 ? 200 : 502).send({
        ok: n8nStatus < 400,
        event: eventType,
        delivery,
        n8n_status: n8nStatus,
        webhook_path: webhookPath,
        story_id: context.story_id,
        event_id: eventRecord?.event_id ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err, delivery }, 'Failed to reach n8n');

      if (eventRecord?.event_id) {
        await completeEvent(eventRecord.event_id, 'failed', undefined, { message: `n8n unreachable: ${message}` });
      }

      return reply.code(502).send({ error: `n8n unreachable: ${message}` });
    }
  });
}
