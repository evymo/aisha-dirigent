/**
 * AITG-APP-04 — Input Leakage / session boundary.
 *
 * User A's prompts MUST NOT surface in user B's context. Static enforcement:
 *   - All chat / orchestration / story-consult routes that take `user_id`
 *     or `session_id` MUST propagate that scope into rpcUserClaims / rpcUser
 *     calls (verified by signature match).
 *   - No route that accepts a body containing `user_id` may use rpcService
 *     (service-role) to fetch user-scoped data.
 *
 * Heuristic file scan: routes under services/*\/src/routes/ that mention
 * user_id MUST also use rpcUser*, not bare rpcService.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isTrackedService } from '../lib/tracked-services';

const ROOT = process.cwd();
const SERVICES_DIR = resolve(ROOT, 'services');

function walkRoutes(): string[] {
  const out: string[] = [];
  if (!existsSync(SERVICES_DIR)) return out;
  for (const svc of readdirSync(SERVICES_DIR)) {
    // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
    if (!isTrackedService(svc)) continue;
    const routesDir = join(SERVICES_DIR, svc, 'src', 'routes');
    if (!existsSync(routesDir)) continue;
    for (const f of readdirSync(routesDir)) {
      if (f.endsWith('.ts')) out.push(join(routesDir, f));
    }
  }
  return out;
}

/**
 * Routes that are service-role-by-design — they use `user_id` as a
 * parameter handed to a SECURITY DEFINER RPC, but the route itself is
 * an internal service-to-service or webhook receiver. Each entry was
 * reviewed manually; new additions need ticket reference.
 */
const BASELINE = new Set<string>([
  // Webhook receivers (external system → service, no user-supplied user_id)
  'services/svc-stripe/src/routes/webhook.ts',
  'services/svc-github-app/src/routes/webhook-bridge.ts',
  'services/svc-github-app/src/routes/repo-ops.ts',
  'services/svc-matrix/src/routes/webhook.ts',
  'services/svc-matrix/src/routes/token-exchange.ts',
  // Internal proxies / streamers
  'services/gateway/src/routes/realtime.ts',
  'services/gateway/src/routes/storage.ts',
  'services/gateway/src/routes/functions.ts',
  'services/gateway/src/routes/rest.ts',
  // Service-to-service callbacks (user_id is a SECURITY DEFINER arg, not user-supplied)
  'services/svc-agent-runner/src/routes/runs.ts',
  'services/svc-ai-chat/src/routes/callback.ts',
  'services/svc-ai-chat/src/routes/models.ts',
  // Omni PAT auth: omniAuth validates a Bearer mcp_ PAT via validate_mcp_token — a
  // SECURITY DEFINER RPC keyed on the token_hash (sha256), NOT a user-supplied
  // user_id. The user_id is an OUTPUT of token validation (req.user.sub provenance,
  // §8/§16), never an input used to fetch cross-user data; there is no user JWT yet
  // at PAT-validation time so rpcUser is N/A. Session-safe by construction → no APP-04
  // leak (the token scope, not a body user_id, binds the request).
  'services/svc-ai-chat/src/routes/omniAuth.ts',
  // Omni reflection-poll authz: GET /reflect/runs/:id authorizes a PAT caller via
  // fn_user_can_read_run(p_user_id, p_run_id) — a SECURITY DEFINER authz CHECK that returns
  // a boolean, NOT a user-scoped data fetch. p_user_id is the OUTPUT of authenticateOmni-
  // Identity (the validated PAT's user, §16 provenance), never a body value; scoped PATs use
  // a token-scope match with no user_id at all. Service-role-by-design, same posture as
  // omniAuth — no APP-04 leak.
  'services/svc-ai-chat/src/routes/reflect.ts',
  // Omni /v1 turn: user_id is the validated PAT's user (an OUTPUT of authenticateOmni,
  // §16 provenance), NEVER a request-body value. The bare rpcService calls are dispatch
  // resolution (derive_clow_needs / aisha_resolve_clow_backend — capability + model
  // ranking, not a user-scoped data fetch). USER-scoped access (MCP tools) is mediated
  // via a MINTED short-lived user-scoped token (RFC 8693, mcpToolProxy → mintMcpUserToken),
  // so the tool runs under the user's RLS downstream rather than a service-role data fetch.
  // Same session-safe posture as omniAuth.ts/reflect.ts — no APP-04 leak.
  'services/svc-ai-chat/src/routes/v1-chat.ts',
  // Admin model-benchmark trigger: admin/staff-gated; p_user_id comes from the verified
  // JWT (user.userId) and is used ONLY for log_audit_event provenance — never to fetch
  // user-scoped data. All RPCs are service-role by design (same posture as models.ts).
  'services/svc-ai-chat/src/routes/benchmark.ts',
  // Dirigent supervisor relay: user_id comes from verified JWT's `sub` claim
  // (trusted), NEVER from request body — see the route's DispatchBody type
  // which explicitly omits `user_id`. Backend RPCs are service-role only by
  // design (dirigent_dispatch_event + dirigent_drain_nudges both check
  // get_jwt_role() = 'service_role'); user_id is only passed as RPC argument
  // for moderation_sessions provenance, not for auth scope. Closes APP-04.
  'services/svc-ai-chat/src/routes/dirigent-supervisor.ts',
  'services/svc-aisha-kronos-shim/src/routes/sessions.ts',
  'services/svc-blockchain/src/routes/claim-reward.ts',
  'services/svc-blockchain/src/routes/governance-vote.ts',
  'services/svc-blockchain/src/routes/ledger-sync.ts',
  'services/svc-blockchain/src/routes/record-audit.ts',
  'services/svc-communications/src/routes/sms-otp.ts',
  'services/svc-fio-bank/src/routes/sync.ts',
  'services/svc-homeassistant/src/routes/sync.ts',
  'services/svc-livekit/src/routes/token.ts',
  // Notification senders + Packeta create + plugin broker/execute use user_id
  // as a SECURITY DEFINER argument; verified manually that the value comes
  // from the authenticated session (JWT) or from a service-role caller
  // (e.g. n8n workflow), never from a user-supplied free-form body.
  'services/svc-packeta/src/routes/create-packet.ts',
  'services/svc-plugin-system/src/routes/broker.ts',
  'services/svc-plugin-system/src/routes/execute.ts',
  'services/svc-push/src/routes/campaigns.ts',
  'services/svc-push/src/routes/questionnaire-reminders.ts',
  'services/svc-push/src/routes/reminder-notifications.ts',
  'services/svc-push/src/routes/send-push.ts',
  // Route-contract backends (2026-07-10). Same posture as the entries above —
  // user_id is JWT-derived (or a service-role caller), used only as a SECURITY
  // DEFINER argument / audit provenance, NEVER a user-supplied body value that
  // fetches another user's data. Verified per route:
  //   - refund.ts: isAdminOrStaff-gated; p_user_id = the admin's own JWT `sub` (audit only).
  //   - send-push-notification.ts: service-role/admin broadcast; user_id(s) are RECIPIENTS.
  //   - packeta-api.ts: JWT-derived p_user_id (identical posture to create-packet.ts).
  //   - lab-recommendation.ts: any client-supplied user_id is ignored; principal stamped from JWT.
  'services/svc-stripe/src/routes/refund.ts',
  'services/svc-push/src/routes/send-push-notification.ts',
  'services/svc-packeta/src/routes/packeta-api.ts',
  'services/svc-ai-chat/src/routes/lab-recommendation.ts',
]);

describe('AITG-APP-04: session boundary — user-scoped routes use rpcUser*', () => {
  const files = walkRoutes();

  test('positive: every route mentioning user_id imports rpcUser variant or service-role guard', () => {
    const violators: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      if (BASELINE.has(rel)) continue;
      const src = readFileSync(f, 'utf8');
      // Heuristic: file references user_id AND issues a PostgREST call
      const mentionsUserId = /\bp_user_id\b|\buser_id\b/.test(src);
      const callsRpc = /rpcService|rpcUser/.test(src);
      if (!mentionsUserId || !callsRpc) continue;
      // If it uses rpcService EXCLUSIVELY (no rpcUser variants), that's the leak path.
      const onlyServiceRpc = /rpcService/.test(src) && !/rpcUser(?:Claims)?/.test(src);
      if (onlyServiceRpc) violators.push(rel);
    }
    expect(
      violators,
      `Routes that handle user_id but only use service-role RPC (potential APP-04 input leakage):\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('negative: detector chamber catches a synthetic leak', () => {
    // Synthetic content: route mentions p_user_id but only rpcService → must be detected
    const syntheticBad = `
      import { rpcService } from '../postgrest.js';
      app.post('/leaky', async (req) => {
        const body = req.body as { p_user_id: string };
        return rpcService('get_user_data', { p_user_id: body.p_user_id });
      });
    `;
    const mentionsUserId = /\bp_user_id\b|\buser_id\b/.test(syntheticBad);
    const onlyServiceRpc = /rpcService/.test(syntheticBad) && !/rpcUser/.test(syntheticBad);
    expect(mentionsUserId && onlyServiceRpc).toBe(true);
  });

  test('positive: detector ignores routes that use rpcUserClaims', () => {
    const goodSample = `
      import { rpcUserClaims } from '../postgrest.js';
      app.post('/ok', async (req) => {
        return rpcUserClaims('get_my_data', { p_user_id: req.user.id }, req.user.claims);
      });
    `;
    const onlyServiceRpc = /rpcService/.test(goodSample) && !/rpcUser/.test(goodSample);
    expect(onlyServiceRpc).toBe(false);
  });
});
