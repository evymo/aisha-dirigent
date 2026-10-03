/**
 * Gateway admin routes — absorbed edge functions that run inside the gateway.
 * All require admin/staff auth via KC JWT except keycloak-role-sync (service-role).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, verifyServiceRole } from '@aisha/security';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { translateAuthorizationForPostgrest } from '../auth/postgrest-jwt.js';
import { kcAdminBase, kcAdminConfigured, kcAdminToken } from '../auth/kc-admin.js';
import { guardedFetch } from '../lib/guarded-fetch.js';

const POSTGREST = config.postgrestUrl;

/** PostgREST RPC call with service-role token. */
async function rpcService<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(process.env.POSTGREST_SERVICE_TOKEN ?? '')}` },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

/** PostgREST RPC call forwarding user JWT. */
async function rpcUser<T = unknown>(fn: string, params: Record<string, unknown>, jwt: string): Promise<T | null> {
  const translated = await translateAuthorizationForPostgrest(`Bearer ${jwt}`);
  if (!translated.ok) return null;

  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json', 'Authorization': translated.authorization },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

// ── n8n workflow map ──
const N8N_WORKFLOW_MAP: Record<string, string> = {
  'billing-sync': '/webhook/billing-sync',
  'compliance-agent': '/webhook/compliance-agent',
  'compliance-reroute': '/webhook/compliance-reroute',
  'delivery-agent': '/webhook/delivery-agent',
  'dirigent-agent': '/webhook/dirigent-agent',
  'knowledge-agent': '/webhook/knowledge-agent',
  'model-router': '/webhook/model-router',
  'nightly-audit': '/webhook/nightly-audit',
  'notification-dispatch': '/webhook/notification-dispatch',
  'pipeline-executor': '/webhook/pipeline-executor',
  'pr-compliance-gate': '/webhook/pr-compliance-gate',
  'story-audit': '/webhook/story-audit',
};

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // ── Mobile App Version ──
  app.get('/mobile-app-version', async (req: FastifyRequest, reply: FastifyReply) => {
    const platform = ((req.headers['x-platform'] as string) ?? 'ios').toLowerCase();
    const appVersion = (req.headers['x-app-version'] as string) ?? '0.0.0';
    const targetPlatform = platform === 'android' ? 'android' : 'ios';

    const data = await rpcService<{ row?: Record<string, unknown> }>('edge_app_versions', {
      p_action: 'get_platform', p_payload: { platform: targetPlatform },
    });

    const cfg = data?.row ?? { min_version: '1.0.0', latest_version: '1.0.0', store_url: '', maintenance_enabled: false, features: {} };
    const compareVersions = (v1: string, v2: string): number => {
      const p1 = (v1 as string).split('.').map(Number);
      const p2 = (v2 as string).split('.').map(Number);
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        if ((p1[i] ?? 0) > (p2[i] ?? 0)) return 1;
        if ((p1[i] ?? 0) < (p2[i] ?? 0)) return -1;
      }
      return 0;
    };

    const updateRequired = compareVersions(appVersion, cfg.min_version as string) < 0;
    const updateRecommended = compareVersions(appVersion, cfg.latest_version as string) < 0;

    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send({
      build: { deployedAt: new Date().toISOString(), version: 'DYNAMIC' },
      features: (cfg.features as Record<string, unknown>) ?? {},
      maintenance: { enabled: cfg.maintenance_enabled, message: (cfg as Record<string, unknown>).maintenance_message, estimatedEnd: (cfg as Record<string, unknown>).maintenance_end },
      status: 'ok',
      timestamp: new Date().toISOString(),
      update: { recommended: updateRecommended, required: updateRequired, message: updateRequired ? 'Prosím aktualizujte aplikaci.' : updateRecommended ? 'Je dostupná nová verze.' : null },
      version: { current: appVersion, latest: cfg.latest_version, minimum: cfg.min_version, platform, storeUrl: cfg.store_url },
    });
  });

  // ── n8n Trigger ──
  app.post<{ Body: { workflow?: string; payload?: Record<string, unknown> } }>('/n8n-trigger', async (req, reply) => {
    const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!jwt) return reply.code(401).send({ error: 'Unauthorized' });
    const roleCheck = await rpcUser<boolean>('is_admin_or_staff', {}, jwt);
    if (!roleCheck) return reply.code(403).send({ error: 'Admin/staff required' });

    const { workflow, payload = {} } = req.body ?? {};
    if (!workflow) return reply.code(400).send({ error: "Missing 'workflow'" });

    const n8nBase = process.env.N8N_WEBHOOK_URL;
    if (!n8nBase) return reply.code(500).send({ error: 'n8n not configured' });

    const webhookPath = N8N_WORKFLOW_MAP[workflow] ?? `/webhook/${workflow}`;
    const targetUrl = `${n8nBase.replace(/\/$/, '')}${webhookPath}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Trigger-Source': 'aisha-gateway' };
    const n8nApiKey = process.env.N8N_API_KEY;
    if (n8nApiKey) headers['X-N8N-API-KEY'] = n8nApiKey;

    try {
      const resp = await fetch(targetUrl, {
        body: JSON.stringify({ ...payload, _trigger: { source: 'aisha-gateway', timestamp: new Date().toISOString(), workflow } }),
        headers,
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
      });

      const data = await resp.json().catch(() => resp.text().catch(() => '(empty)'));
      return reply.code(resp.status < 400 ? 200 : 502).send({ n8n_response: data, n8n_status: resp.status, ok: resp.status < 400, webhook_path: webhookPath, workflow });
    } catch {
      return reply.code(502).send({ error: 'n8n unreachable' });
    }
  });

  // ── Keycloak Role Sync ──
  app.post<{ Body: { user_id?: string; role?: string; action?: 'add' | 'remove' } }>('/kc-role-sync', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization, (process.env.POSTGREST_SERVICE_TOKEN ?? ''));
    } catch (err) {
      const statusCode = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(statusCode).send({ error: 'Service-role required' });
    }

    const { user_id, role, action } = req.body ?? {};
    if (!user_id || !role || !action) return reply.code(400).send({ error: 'user_id, role, action required' });

    // Tahle cesta byla MRTVÁ: `KC_ADMIN_TOKEN` není v žádném compose souboru,
    // takže /kc-role-sync v nasazení vždycky skončil na 500 „not configured".
    // A i kdyby proměnná byla, statický admin token KC razí na ~60 s — byl by
    // skoro pořád prošlý. Servisní účet z auth/kc-admin.ts je táž cesta, jakou
    // používá /users/invite: jeden způsob, jak se gateway dostane ke KC admin API.
    if (!kcAdminConfigured()) {
      return reply.code(503).send({
        error: 'KC admin service account not configured (KC_ADMIN_CLIENT_SECRET)',
      });
    }
    const adminToken = await kcAdminToken();
    if (!adminToken) return reply.code(502).send({ error: 'KC admin token could not be minted' });

    const kcBase = kcAdminBase();

    // Get KC user by searching with Evymo user_id (stored as attribute)
    const searchResp = await guardedFetch(`${kcBase}/users?q=aisha_user_id:${user_id}&max=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!searchResp.ok) return reply.code(502).send({ error: 'KC user search failed' });
    const users = await searchResp.json() as Array<{ id: string }>;
    if (users.length === 0) return reply.code(404).send({ error: 'KC user not found' });

    const kcUserId = users[0].id;

    // Get role ID
    const rolesResp = await guardedFetch(`${kcBase}/roles/${role}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!rolesResp.ok) return reply.code(404).send({ error: `Role ${role} not found in KC` });
    const roleData = await rolesResp.json() as { id: string; name: string };

    // Assign/remove role
    const method = action === 'add' ? 'POST' : 'DELETE';
    const resp = await guardedFetch(`${kcBase}/users/${kcUserId}/role-mappings/realm`, {
      body: JSON.stringify([{ id: roleData.id, name: roleData.name }]),
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      method,
      signal: AbortSignal.timeout(10_000),
    });

    return reply.send({ action, ok: resp.ok, role, user_id });
  });

  // ── Verify App Integrity ──
  app.get('/verify-integrity', async (_req, reply) => {
    return reply.send({ challenge: randomBytes(32).toString('base64url') });
  });

  app.post<{ Body: { attestation_token?: string; platform?: string; token?: string; token_type?: string } }>('/verify-integrity', async (req, reply) => {
    const body = req.body ?? {};
    const attestation_token = body.attestation_token ?? body.token;
    const { platform } = body;
    if (!attestation_token) return reply.code(400).send({ error: 'attestation_token required' });

    if (platform === 'android') {
      const playIntegrityKey = process.env.PLAY_INTEGRITY_API_KEY;
      if (!playIntegrityKey) return reply.code(500).send({ error: 'Play Integrity not configured' });
      try {
        const resp = await fetch(`https://playintegrity.googleapis.com/v1/${process.env.PLAY_INTEGRITY_PACKAGE_NAME}:decodeIntegrityToken?key=${playIntegrityKey}`, {
          body: JSON.stringify({ integrity_token: attestation_token }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        });
        const data = await resp.json() as Record<string, unknown>;
        return reply.send({ platform: 'android', valid: resp.ok, verified: resp.ok, verdict: data });
      } catch {
        return reply.code(502).send({ error: 'Play Integrity check failed' });
      }
    }

    // iOS App Attest
    const appAttestKeyId = process.env.APPLE_APP_ATTEST_KEY_ID;
    if (!appAttestKeyId) return reply.code(500).send({ error: 'App Attest not configured' });
    // App Attest verification is complex (CBOR decode, Apple root cert check)
    // For now, delegate to PostgREST RPC that handles the crypto
    const result = await rpcService<{ valid: boolean }>('verify_app_attestation', {
      p_attestation_token: attestation_token,
      p_platform: platform ?? 'ios',
    });
    const valid = result?.valid ?? false;
    return reply.send({ platform: platform ?? 'ios', valid, verified: valid });
  });

  // ── Database Dump (admin-only) ──
  app.post('/database-dump', async (req: FastifyRequest, reply: FastifyReply) => {
    const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!jwt) return reply.code(401).send({ error: 'Unauthorized' });
    const roleCheck = await rpcUser<boolean>('is_admin_or_staff', {}, jwt);
    if (!roleCheck) return reply.code(403).send({ error: 'Admin required' });

    const result = await rpcService<{ dump_id: string; status: string }>('edge_database_dump', { p_action: 'create' });
    return reply.send(result ?? { error: 'Dump failed' });
  });

  // ── Sentry Monitor (admin-only) ──
  app.post<{ Body: { action?: 'list_issues' | 'analyze_issue'; issue_id?: string } }>('/sentry-monitor', async (req: FastifyRequest, reply: FastifyReply) => {
    const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!jwt) return reply.code(401).send({ error: 'Unauthorized' });
    const roleCheck = await rpcUser<boolean>('is_admin_or_staff', {}, jwt);
    if (!roleCheck) return reply.code(403).send({ error: 'Admin required' });

    const body = req.body as { action?: 'list_issues' | 'analyze_issue'; issue_id?: string } | null;
    const { action = 'list_issues', issue_id } = body ?? {};
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG ?? 'evymo';
    const sentryProject = process.env.SENTRY_PROJECT ?? 'aisha-web';
    if (!sentryToken) return reply.code(500).send({ error: 'Sentry not configured' });

    if (action === 'analyze_issue') {
      if (!issue_id) return reply.code(400).send({ error: 'issue_id required' });
      const detailResp = await fetch(`https://sentry.io/api/0/issues/${encodeURIComponent(issue_id)}/`, {
        headers: { Authorization: `Bearer ${sentryToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!detailResp.ok) return reply.code(502).send({ error: 'Sentry issue detail failed' });
      const issue = await detailResp.json() as Record<string, unknown>;
      const title = typeof issue.title === 'string' ? issue.title : issue_id;
      const culprit = typeof issue.culprit === 'string' ? issue.culprit : null;
      const severity = typeof issue.level === 'string' ? issue.level : 'unknown';
      const routed = await rpcService<Record<string, unknown>>('route_ai_task', {
        p_task_kind: 'incident',
        p_prompt: `Analyze Sentry issue ${issue_id}: ${title}${culprit ? ` (${culprit})` : ''}`,
        p_metadata: {
          source: 'sentry-monitor',
          issue_id,
          title,
          culprit,
          severity,
          permalink: typeof issue.permalink === 'string' ? issue.permalink : null,
        },
      });
      const agents = Array.isArray(routed?.agents) ? routed.agents.join(', ') : 'incident pipeline';
      return reply.send({
        analysis: `Incident analysis queued for ${agents}.`,
        severity,
        suggested_fix: null,
      });
    }

    if (action !== 'list_issues') return reply.code(400).send({ error: 'Unknown Sentry action' });

    const resp = await fetch(`https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?query=is:unresolved&limit=25`, {
      headers: { Authorization: `Bearer ${sentryToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return reply.code(502).send({ error: 'Sentry API failed' });
    const issues = await resp.json() as Array<{ id: string; title: string; count: string; lastSeen: string }>;
    return reply.send({ count: issues.length, issues: issues.map((i) => ({ count: i.count, id: i.id, lastSeen: i.lastSeen, title: i.title })) });
  });

  // ── Vulnerability Aggregator (admin-only) ──
  app.post<{ Body: { action?: 'scan' | 'resolve'; vulnerability_id?: string } }>('/vulnerability-aggregator', async (req, reply) => {
    const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!jwt) return reply.code(401).send({ error: 'Unauthorized' });
    const roleCheck = await rpcUser<boolean>('is_admin_or_staff', {}, jwt);
    if (!roleCheck) return reply.code(403).send({ error: 'Admin required' });

    const { action, vulnerability_id } = req.body ?? {};
    if (action === 'resolve' && vulnerability_id) {
      const result = await rpcService<{ resolved: boolean }>('resolve_vulnerability', { p_vulnerability_id: vulnerability_id });
      return reply.send(result ?? { resolved: false });
    }

    const result = await rpcService<unknown>('get_vulnerability_scan_results', {});
    return reply.send(result ?? { vulnerabilities: [] });
  });
};
