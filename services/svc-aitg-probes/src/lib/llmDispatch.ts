/**
 * Probe-side LLM dispatcher.
 *
 * Probes never call OpenAI / Anthropic / Gemini directly — they always go
 * through `svc-ai-chat` so the production router / cost ledger / Langfuse
 * trace path is shared between real traffic and the AITG suite. This keeps
 * the probes faithful to production behaviour and gives ops a single
 * dashboard.
 *
 * The dispatcher wraps the outbound call in @aisha/security's SSRF guard
 * — `aiChatUrl` is config-derived but we route through `safeFetch` anyway,
 * because the discovery gate requires it of any service that makes
 * non-internal-config outbound calls.
 */

import { createSsrfGuard, parseHostAllowlist } from '@aisha/security';
import { config } from '../config.js';

const guard = createSsrfGuard({
  service: 'svc-aitg-probes',
  hostAllowlist: parseHostAllowlist(
    `${new URL(config.aiChatUrl).hostname},${config.ssrfHostAllowlist}`,
  ),
  allowedSchemes: ['https:', 'http:'],
  allowInternalNetworks: true,
});

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** `ai_runs` id from /generate — the provenance anchor for the probe's evidence. */
  runId?: string;
  /** Which model actually answered. NOT necessarily the one requested — check it. */
  model?: string;
}

/**
 * Dispatch a probe turn through svc-ai-chat's SERVICE plane.
 *
 * `/chat` is the USER plane: it authenticates with createJwtVerifier (Keycloak
 * RS256, `sub` required), so the service-role token every probe carries can
 * never verify there — this used to 401 unconditionally. `/generate` is the
 * service-plane twin, guarded by verifyServiceRole against the same
 * POSTGREST_SERVICE_TOKEN, and it already wraps output in withAitgGuardOrRefuse.
 *
 * The probe PINS its model: a conformance verdict is about a specific model, so
 * letting route_task substitute one would attribute the finding to a model that
 * never ran. /generate rejects an unservable pin (422) instead of remapping, and
 * reports `model_source` so we can refuse to record a verdict when the pin was
 * not honoured (the AISHA_LLM_MOCK path is the live case — it answers with a
 * fixture before any routing happens).
 */
export async function dispatchProbeChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await guard.safeFetch(`${config.aiChatUrl}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiChatToken}`,
      'X-Aitg-Probe': 'true',
    },
    body: JSON.stringify({
      task_kind: 'chat',
      risk_profile: 'low',
      model: req.model,
      model_override_reason: 'AITG conformance probe — verdict is bound to this exact model',
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userMessage }],
      temperature: req.temperature ?? 0.1,
      max_tokens: req.maxTokens ?? 400,
      metadata: { aitg_probe: true },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`AITG_LLM_DISPATCH_FAILED:${res.status}`);
  }
  const body = (await res.json()) as {
    text: string;
    model?: string;
    model_source?: 'route_task' | 'caller_pinned' | 'mock';
    usage?: { inputTokens: number; outputTokens: number };
    run_id?: string;
  };

  // Fail rather than measure the wrong subject. Recording a verdict against a
  // model that did not answer is worse than recording nothing — it produces a
  // conformance claim no one can reproduce.
  if (body.model_source && body.model_source !== 'caller_pinned') {
    throw new Error(
      `AITG_MODEL_PIN_NOT_HONOURED:${body.model_source}:requested=${req.model}:answered=${body.model ?? 'unknown'}`,
    );
  }

  return {
    text: body.text,
    model: body.model,
    runId: body.run_id,
    // /generate reports OTel-style token names; the probe surface keeps the
    // OpenAI-style ones its callers already read.
    usage: body.usage
      ? { prompt_tokens: body.usage.inputTokens, completion_tokens: body.usage.outputTokens }
      : undefined,
  };
}
