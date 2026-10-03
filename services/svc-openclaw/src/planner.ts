/**
 * Planner — produces a structured execution plan via AISHA's llm-gateway.
 *
 * NOT a new AI feature — wires to the existing llm-gateway HTTP API.
 * Returns the plan as-structured JSON; callers (services/svc-ai-chat
 * reflection) decide what to do with it. Audit row was already written
 * by the calling RPC `aisha_request_plan_from_openclaw` before this
 * daemon was invoked.
 *
 * Degradation: if llm-gateway is unreachable OR not configured, returns
 * a deterministic minimal plan (`steps: [{action: "manual_review"}]`).
 * Reflection graphs handle this branch gracefully.
 *
 * OWASP A10: outbound fetch goes through `ssrf.safeFetch`. The
 * llm-gateway host must be in OPENCLAW_OUTBOUND_HOSTS (config.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { SsrfGuard } from '@aisha/security';
import { config } from './config.js';

interface PlanInput {
  request_id?: string | null;
  task: { description: string; type: string };
  constraints?: Record<string, unknown>;
}

interface PlanStep {
  step: number;
  action: string;
  inputs?: Record<string, unknown>;
  rationale?: string;
}

interface PlanResult {
  request_id: string | null;
  plan: { steps: PlanStep[]; estimated_total_ms?: number };
  source: 'llm_gateway' | 'fallback';
  warnings?: string[];
}

const PLANNER_SYSTEM_PROMPT = `You are AISHA's advisory planner. Given a TASK
DESCRIPTION + CONSTRAINTS, output a single JSON object with exactly this
schema and nothing else:
{
  "steps": [
    {"step": 1, "action": "<short_verb_phrase>", "inputs": {<optional_jsonb>}, "rationale": "<one_sentence>"}
  ],
  "estimated_total_ms": <integer_milliseconds_or_null>
}
Constraints to obey:
- 1-7 steps per plan. Never more than 7.
- "action" MUST be a short kebab-cased verb phrase (e.g. "fetch-source",
  "summarize-content", "notify-author").
- Inputs are advisory; the executor (AISHA n8n / reflection orchestrator)
  resolves concrete values.
- If the task is impossible, ambiguous, or requires human review, return
  a single step with action="manual_review" and rationale explaining why.
- Output ONLY the JSON object. No prose, no markdown fences.`;

function manualReviewPlan(req_id: string | null, reason: string, warning: string): PlanResult {
  return {
    request_id: req_id,
    plan: {
      steps: [
        {
          step: 1,
          action: 'manual_review',
          rationale: reason,
        },
      ],
    },
    source: 'fallback',
    warnings: [warning],
  };
}

export async function planExecution(
  input: PlanInput,
  log: FastifyBaseLogger,
  ssrf: SsrfGuard,
): Promise<PlanResult> {
  const req_id = input.request_id ?? null;

  if (!config.llmGatewayUrl || !config.llmGatewayKey) {
    log.warn({ req_id }, 'planner: llm-gateway not configured, emitting manual_review fallback');
    return manualReviewPlan(
      req_id,
      'OpenClaw planner has no llm-gateway configured; route to a human.',
      'llm_gateway_not_configured',
    );
  }

  const userPrompt = JSON.stringify({
    task: input.task,
    constraints: input.constraints ?? {},
  });

  const url = `${config.llmGatewayUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model: config.plannerModel,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  };

  let res: Response;
  try {
    res = await ssrf.safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmGatewayKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.plannerTimeoutMs),
    });
  } catch (err) {
    log.error({ req_id, err: String(err) }, 'planner: llm-gateway unreachable');
    return manualReviewPlan(
      req_id,
      `llm-gateway unreachable: ${String(err).slice(0, 120)}`,
      'llm_gateway_unreachable',
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    log.error(
      { req_id, status: res.status, detail: detail.slice(0, 200) },
      'planner: llm-gateway error',
    );
    return manualReviewPlan(
      req_id,
      `llm-gateway returned HTTP ${res.status}`,
      `llm_gateway_http_${res.status}`,
    );
  }

  const parsed = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[] }
    | null;
  const content = parsed?.choices?.[0]?.message?.content ?? '';

  // Extract the plan JSON from the LLM response. Even with response_format
  // json_object we defensively strip a stray markdown fence.
  let plan: { steps?: PlanStep[]; estimated_total_ms?: number } = {};
  try {
    const stripped = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    plan = JSON.parse(stripped);
  } catch (err) {
    log.warn({ req_id, err: String(err) }, 'planner: LLM returned unparseable JSON');
    return manualReviewPlan(req_id, 'Planner LLM returned unparseable JSON', 'llm_response_unparseable');
  }

  // Defensive normalization — hard cap at 7 steps regardless of LLM
  // creativity.
  const steps = Array.isArray(plan.steps) ? plan.steps.slice(0, 7) : [];
  if (steps.length === 0) {
    return manualReviewPlan(req_id, 'Planner produced empty step list', 'llm_empty_plan');
  }

  const normalized: PlanStep[] = steps.map((s, i) => ({
    step: i + 1,
    action: String(s.action ?? 'manual_review'),
    inputs:
      typeof s.inputs === 'object' && s.inputs !== null
        ? (s.inputs as Record<string, unknown>)
        : undefined,
    rationale: typeof s.rationale === 'string' ? s.rationale : undefined,
  }));

  return {
    request_id: req_id,
    plan: {
      steps: normalized,
      estimated_total_ms:
        typeof plan.estimated_total_ms === 'number' ? plan.estimated_total_ms : undefined,
    },
    source: 'llm_gateway',
  };
}
