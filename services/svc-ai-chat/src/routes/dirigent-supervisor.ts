/**
 * POST /dirigent/dispatch — Claude Code agent hook relay (Vrstva 2).
 *
 * Flow (per n8n/workflows/README-dirigent-supervisor.md):
 *   1. Claude Code agent fires a hook event (.claude/hooks/aisha-supervisor-relay.sh)
 *   2. Relay hook POSTs here with user JWT (Bearer)
 *   3. We call dirigent_dispatch_event RPC (service_role) → maps event to
 *      playbook key + ensures moderation_sessions row + appends to
 *      hook_event_log ring buffer
 *   4. We call dirigent_drain_nudges RPC (service_role) → atomic SELECT +
 *      mark-consumed of backend-queued advisories scoped to the story
 *   5. We POST to the mapped n8n webhook with the full payload (SSRF-safe)
 *   6. We compose the final response: drained nudges + n8n advisory →
 *      `additionalContext` for the agent
 *
 * Fail-open contract:
 *   - No N8N webhook configured / fetch fails → return drained nudges only
 *   - Drain RPC fails → return n8n advisory only (or empty)
 *   - Both fail → return 200 {} so the relay exits silently and the agent
 *     proceeds; Vrstva 1 local hooks remain the safety net
 *
 * Auth: user JWT via verifyToken. The RPC calls use the service-role
 * postgrest client (rpcService) because dirigent_dispatch_event +
 * dirigent_drain_nudges both check `get_jwt_role() = 'service_role'`.
 *
 * Audit: every dispatch is logged via log_integration_action (no PII —
 * only event name, session_id, playbook, status).
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, AuthError, type VerifiedUser } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

const VALID_EVENTS = new Set([
  'session_start',
  'prompt_submit',
  'pre_tool',
  'post_tool',
  'stop',
]);

const N8N_TIMEOUT_MS = 4_000; // hook total budget 8s; reserve 4s for relay + RPCs

interface LiveSessionContext {
  session_id?: string | null;
  story_id?: string | null;
  user_id?: string | null;   // relay-provided, validated against JWT below
  source?: string | null;    // reporting surface, e.g. 'claude-code' (from relay binding config)
  agent_run_id?: string | null; // set by AISHA-spawned runs → links the live session to its agent_runs row
  branch?: string | null;
  phase?: string | null;
  phase_detail?: string | null;
  tool_name?: string | null;
  file_path?: string | null;
  // Sub-agent label for Agent tool events — server-side accumulation into
  // agent_live_sessions.subagents happens in fn_log_agent_session_event.
  agent_label?: string | null;
}

interface DispatchBody {
  event: string;
  story_id?: string | null;
  session_id?: string | null;
  // NOTE: no `user_id` field — we use the verified JWT's `sub` claim
  // (trusted) instead of accepting it from the relay body (untrusted).
  // This closes AITG-APP-04 input leakage: routes that mention user_id
  // and only use rpcService leak via untrusted body input.
  conversation_id?: string | null;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  user_prompt?: string;
  transcript_excerpt?: string;
  expertise_level?: string;
  tech_stack?: string[];
  summary?: string;
  // live_session: enriched context added by aisha-supervisor-relay.mjs and
  // aisha-workflow-snapshot.mjs for claude_code_live_sessions monitoring.
  live_session?: LiveSessionContext | null;
}

interface DispatchResult {
  session_id: string;
  playbook: string;
  priority: number;
  event_logged: boolean;
}

interface DrainedNudge {
  id: string;
  event_origin: string;
  severity: 'info' | 'warn' | 'goal-correction';
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface PlaybookResponse {
  advisory?: string;
  decision?: 'allow' | 'block' | 'ask';
  reason?: string;
}

interface SupervisorResponse {
  additionalContext?: string;
  decision?: 'allow' | 'block' | 'ask';
  reason?: string;
}

/**
 * Compose the additionalContext text from drained nudges and the n8n
 * playbook response. Each segment is separated by a blank line.
 */
function composeAdditionalContext(
  nudges: DrainedNudge[],
  playbookResp: PlaybookResponse | null,
): string {
  const parts: string[] = [];
  for (const nudge of nudges) {
    const tag = nudge.severity === 'goal-correction' ? '⚠️ ' : '';
    parts.push(`${tag}[${nudge.event_origin}] ${nudge.message}`);
  }
  if (playbookResp?.advisory) {
    parts.push(playbookResp.advisory);
  }
  return parts.join('\n\n').trim();
}

export async function dirigentSupervisorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: DispatchBody }>('/dirigent/dispatch', async (req, reply) => {
    // 1. Auth — user JWT required. Cold-start parity: no token = 200 {}.
    let user: VerifiedUser;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        // Relay hook treats this as cold-start: no advisory, no block.
        return reply.code(200).send({});
      }
      throw err;
    }

    const body = req.body;
    if (!body || typeof body.event !== 'string' || !VALID_EVENTS.has(body.event)) {
      return reply.code(400).send({
        error: 'invalid_event',
        valid: Array.from(VALID_EVENTS),
      });
    }

    // 1b. Story ownership — the relay body carries story_id but is user-controlled.
    // Every RPC below runs as service_role (RLS-bypassing), so a foreign story_id
    // would let a user attribute session events / drain another tenant's nudges
    // (cross-tenant). Validate against the TRUSTED JWT sub. A confirmed-foreign
    // story is an attack → 403; if the check can't confirm (RPC error), fail
    // CLOSED by dropping story_id so unverified stories never reach the RPCs
    // (supervision degrades to session-only, but leaks nothing).
    if (body.story_id) {
      let owns: boolean | null = null;
      try {
        owns = await rpcService<boolean>('is_story_participant', {
          p_story_id: body.story_id,
          p_user_id: user.userId,
        });
      } catch {
        owns = null;
      }
      if (owns === false) {
        return reply.code(403).send({ error: 'story_forbidden' });
      }
      if (owns !== true) {
        body.story_id = null;
      }
    }

    // 2a. Live session monitoring — fire-and-forget, never blocks dispatch.
    // Upserts agent_live_sessions + logs the event into ai_trace_events via
    // the session's ide_session ai_run (fn_log_agent_session_event).
    // user_id from JWT sub (trusted), NOT from live_session.user_id (untrusted relay body).
    if (body.session_id && body.live_session) {
      const ls = body.live_session;
      void writeLiveSession({
        session_id: body.session_id,
        story_id: body.story_id ?? null,
        user_id: user.userId,           // JWT sub — overrides any relay-provided value
        source: ls.source ?? 'claude-code',
        agent_run_id: ls.agent_run_id ?? null,
        branch: ls.branch ?? null,
        phase: ls.phase ?? (body.event === 'stop' ? 'stopped' : 'idle'),
        phase_detail: ls.phase_detail ?? null,
        tool_name: ls.tool_name ?? null,
        file_path: ls.file_path ?? null,
        agent_label: ls.agent_label ?? null,
        event: body.event,
      });
    }

    // 2b. dirigent_dispatch_event — ensures session, returns playbook key
    let dispatchResult: DispatchResult | null = null;
    try {
      dispatchResult = await rpcService<DispatchResult>('dirigent_dispatch_event', {
        p_event_name: body.event,
        p_payload: {
          conversation_id: body.conversation_id ?? null,
          expertise_level: body.expertise_level ?? null,
          session_id: body.session_id ?? null,
          story_id: body.story_id ?? null,
          summary: body.summary ?? null,
          tech_stack: body.tech_stack ?? [],
          tool_input: body.tool_input ?? {},
          tool_output: body.tool_output ?? null,
          // Trusted user_id from verified JWT (sub claim, exposed as
          // VerifiedUser.userId), NOT from request body.
          // AITG-APP-04: never accept user identity from untrusted input.
          user_id: user.userId,
        },
      });
    } catch {
      // RPC failed — degrade gracefully
      dispatchResult = null;
    }

    if (!dispatchResult || !dispatchResult.playbook) {
      // No playbook mapping → no n8n call, just return any drained nudges
      // if the story_id is known.
      const fallbackNudges = body.story_id
        ? await drainNudges(body.story_id, body.conversation_id ?? null)
        : [];
      const ctx = composeAdditionalContext(fallbackNudges, null);
      return reply
        .code(200)
        .send(ctx ? { additionalContext: ctx } : ({} as SupervisorResponse));
    }

    // 3. Drain backend-queued nudges atomically
    const nudges = await drainNudges(
      body.story_id ?? null,
      body.conversation_id ?? null,
    );

    // 4. Forward to n8n playbook (fail-open if no webhook URL or fetch fails)
    let playbookResp: PlaybookResponse | null = null;
    if (config.n8nBaseUrl) {
      playbookResp = await callPlaybook(dispatchResult.playbook, {
        event: body.event,
        story_id: body.story_id ?? null,
        session_id: dispatchResult.session_id,
        tool_input: body.tool_input,
        tool_output: body.tool_output,
        user_prompt: body.user_prompt,
        transcript_excerpt: body.transcript_excerpt,
      });
    }

    // 5. Audit (no PII; payload structure only) — best-effort, never blocks reply
    try {
      await rpcService('log_integration_action', {
        p_action_key: 'dirigent.dispatch',
        p_integration: 'svc-ai-chat:dirigent-supervisor',
        p_payload: {
          event: body.event,
          playbook: dispatchResult.playbook,
          session_id: dispatchResult.session_id,
          nudges_drained: nudges.length,
          playbook_response: !!playbookResp,
          story_id: body.story_id ?? null,
        },
      });
    } catch {
      // Audit best-effort; never reject the dispatch on logging failure
    }

    // 6. Compose final response. Only goal_evaluator may forward decision != allow.
    const ctx = composeAdditionalContext(nudges, playbookResp);
    const response: SupervisorResponse = {};
    if (ctx) response.additionalContext = ctx;
    if (
      dispatchResult.playbook === 'goal_evaluator' &&
      playbookResp?.decision &&
      playbookResp.decision !== 'allow'
    ) {
      response.decision = playbookResp.decision;
      if (playbookResp.reason) response.reason = playbookResp.reason;
    }
    return reply.code(200).send(response);
  });
}

/**
 * Write live session monitoring data — upsert agent_live_sessions (which
 * lazily creates the per-session ide_session ai_run) and then log the event
 * into ai_trace_events via fn_log_agent_session_event. Sequential on purpose:
 * the event log resolves the session's ai_run_id created by the upsert.
 * Fire-and-forget: caller uses `void` on this promise; failures are swallowed.
 */
async function writeLiveSession(args: {
  session_id: string;
  story_id: string | null;
  user_id: string | null;
  source: string;
  agent_run_id: string | null;
  branch: string | null;
  phase: string;
  phase_detail: string | null;
  tool_name: string | null;
  file_path: string | null;
  agent_label: string | null;
  event: string;
}): Promise<void> {
  try {
    await rpcService<string>('fn_upsert_agent_live_session', {
      p_agent_run_id: args.agent_run_id,
      p_branch: args.branch,
      p_last_file: args.file_path,
      p_last_tool: args.tool_name,
      p_phase: args.phase,
      p_phase_detail: args.phase_detail,
      p_session_id: args.session_id,
      p_source: args.source,
      p_story_id: args.story_id,
      p_user_id: args.user_id,
    });

    // Tool events feed the universal telemetry signal. session_start/stop
    // lifecycle is captured by the ai_run row itself (started_at/finished_at),
    // so only tool activity emits a trace event.
    if (args.event === 'pre_tool' || args.event === 'post_tool') {
      await rpcService<string>('fn_log_agent_session_event', {
        p_event_kind: 'tool_use',
        p_file_path: args.file_path,
        p_payload: {
          phase: args.event === 'pre_tool' ? 'pre' : 'post',
          ...(args.agent_label ? { label: args.agent_label } : {}),
        },
        p_session_id: args.session_id,
        p_tool_name: args.tool_name,
      });
    }
  } catch {
    // Live monitoring is observational — never surface errors to the agent.
  }
}

/**
 * Atomically drain unconsumed dirigent_nudges scoped to the story (and
 * optionally the conversation). Fail-open: any RPC error → empty array.
 */
async function drainNudges(
  storyId: string | null,
  conversationId: string | null,
): Promise<DrainedNudge[]> {
  if (!storyId) return [];
  try {
    const result = await rpcService<DrainedNudge[] | null>('dirigent_drain_nudges', {
      p_conversation_id: conversationId,
      p_limit: 10,
      p_story_id: storyId,
    });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Forward the dispatch payload to the mapped n8n playbook webhook.
 * Uses SSRF guard from @aisha/security to reject internal/loopback targets.
 * Timeout 4s — n8n SHOULD respond <3s per README contract.
 */
async function callPlaybook(
  playbookKey: string,
  payload: Record<string, unknown>,
): Promise<PlaybookResponse | null> {
  const webhookUrl = `${config.n8nBaseUrl.replace(/\/$/, '')}/webhook/dirigent/${playbookKey}`;
  try {
    const { createSsrfGuard, parseHostAllowlist } = await import('@aisha/security');
    const guard = createSsrfGuard({
      service: 'svc-ai-chat',
      hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
      allowedSchemes: ['https:', 'http:'],
      allowInternalNetworks: true,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.n8nApiKey) headers['X-N8N-API-Key'] = config.n8nApiKey;
    const resp = await guard.safeFetch(webhookUrl, {
      body: JSON.stringify(payload),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as PlaybookResponse;
    // Validate the contract: advisory + optional decision + optional reason
    if (typeof json !== 'object' || json === null) return null;
    const out: PlaybookResponse = {};
    if (typeof json.advisory === 'string') out.advisory = json.advisory;
    if (json.decision === 'allow' || json.decision === 'block' || json.decision === 'ask') {
      out.decision = json.decision;
    }
    if (typeof json.reason === 'string') out.reason = json.reason;
    return out;
  } catch {
    // Network error, SSRF rejection, timeout, parse error — all fail-open
    return null;
  }
}
