/**
 * POST /generate — Canonical one-shot LLM generation through the Aisha router.
 *
 * Replaces every workflow / service that previously called a provider SDK
 * directly. Every generation across the platform flows through here so
 * Aisha (not the operator, not the caller, not the workflow) decides
 * agent + model + risk handling, then unifiedChat dispatches.
 *
 * Decision flow:
 *   1. Caller describes the TASK (task_kind, story_id, risk_profile,
 *      constraints). Optional `slot_hint` lives in constraints — Aisha
 *      MAY weigh it but is not bound by it.
 *   2. route_task RPC consults the dirigent decision tree → returns
 *      primary agent + model + tools + stop_conditions + run_id.
 *      Agent definitions live in agent_catalog; risk-keyed model
 *      overrides live there too. No env var, no slot lookup, no
 *      hard-coded "budget|balanced|maxQuality" branching here.
 *   3. resolveAvailableModel(model) → capability-availability: remaps to a
 *      CONFIGURED backend (OpenAI / Anthropic / Google / vLLM / Ollama / Docker /
 *      Maestro / AISHA LLM Gateway) so generation runs on whichever provider the
 *      platform admin actually wired into BackendRegistry — never throws on a
 *      model whose preferred provider has no key (ZADÁNÍ §2.4).
 *   4. unifiedChat() executes; audit_journal entry via
 *      log_integration_action with run_id link + tags
 *      ['stack','llm','generate', task_kind].
 *   5. Returns { text, provider, model, usage, run_id, mock? }.
 *
 * "Operator" is not special — the operator of any stack instance
 * (us for AS Aisha, Acme for theirs, a law firm for theirs) is
 * a user with access to the story. The Aisha router is platform-level
 * and identical across instances; only agent_catalog content +
 * BackendRegistry configuration vary per deployment.
 *
 * AISHA_LLM_MOCK env (set at the svc level) short-circuits to a
 * deterministic fixture for e2e — useful in CI and local dev.
 *
 * Auth: service_role only (n8n workflows + internal services).
 *       JWT-authenticated callers should go through /chat instead.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import {
  isModelServable,
  resolveAvailableModel,
  resolveProvider,
  unifiedChat,
  type LlmProvider,
} from '../lib/llmRouter.js';
import { journalDispatch } from '../lib/dispatchJournal.js';
import { withAitgGuardOrRefuse, createAitgRunner } from '@aisha/aitg';
import { config } from '../config.js';

// OWASP AITG output guard — classify the generated text (AITG-APP-01 prompt-injection
// bleed-through, AITG-APP-12 toxic output) BEFORE it leaves the service; a violation is
// replaced with a safe refusal. Fail-soft transport (a PostgREST outage never breaks a
// generation — the runner swallows the write error and returns null).
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:generate',
});

const GenerateSchema = z.object({
  /** Task kind — Aisha's decision tree dispatches based on this. */
  task_kind: z.string().min(1),
  /** Risk profile — Aisha escalates model + compliance per `agent_catalog.model_overrides`. */
  risk_profile: z.enum(['low', 'medium', 'high']).optional().default('low'),
  /** Story id — context for routing + audit attribution. */
  story_id: z.string().uuid().optional(),
  /** Optional domain tags — input into routing decision. */
  domain: z.array(z.string()).optional(),
  /** Optional tech tags — input into routing decision. */
  tech: z.array(z.string()).optional(),
  /**
   * Constraints — free-form hints for the dirigent tree. May contain
   * `slot_hint`, `cost_preference`, brief, anything the agent's
   * decision_tree might check. Aisha is NOT obliged to honor these.
   */
  constraints: z.record(z.string(), z.unknown()).optional().default({}),
  /** System prompt forwarded to the resolved model. */
  system: z.string().optional(),
  /** Conversation messages — most one-shot calls send a single user turn. */
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'developer']),
        content: z.string(),
      }),
    )
    .min(1),
  /** Sampling temperature. */
  temperature: z.number().min(0).max(2).optional(),
  /** Max output tokens. */
  max_tokens: z.number().int().positive().max(32_000).optional(),
  /** Force JSON output when the provider supports it. */
  json_mode: z.boolean().optional(),
  /**
   * Pin the model instead of letting `route_task` choose it.
   *
   * Omitted (the default): Aisha routes, and an unservable pick is remapped to a
   * configured backend — the right behaviour for ordinary traffic.
   *
   * Set: the caller is asserting "measure THIS model". `route_task` still runs
   * (run_id, agent, tools_allowlist and the governance/audit trail are unchanged);
   * only the model is overridden. An unservable pin is REJECTED rather than
   * remapped — silently answering from another model would attribute the result
   * to a model that never ran, which is exactly what a conformance probe or a
   * user's explicit "use this model" must never get.
   */
  model: z.string().min(1).optional(),
  /**
   * Why the model was pinned. Recorded on the run so a later reader can tell
   * "Aisha chose it" from "a probe/operator forced it". Required with `model`.
   */
  model_override_reason: z.string().min(1).max(500).optional(),
  /** Audit metadata — `{ job_id, story_id, ... }` — joined into log_integration_action payload. */
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((b) => !b.model || !!b.model_override_reason, {
  message: 'model_override_reason is required when model is pinned',
  path: ['model_override_reason'],
});

type GenerateBody = z.infer<typeof GenerateSchema>;

interface RoutePlanAgent {
  slug: string;
  model: string;
  context_profile?: string;
  step_index: number;
  autonomy_level?: string;
  safety_level?: string;
}

interface RoutePlanResult {
  run_id: string;
  agents: RoutePlanAgent[];
  tools_allowlist?: string[];
  stop_conditions?: Record<string, unknown>;
  routing_method?: 'decision_tree' | 'hardcoded';
}

function mockFixtureFor(body: GenerateBody): { text: string; provider: LlmProvider; model: string } {
  if (body.json_mode || body.task_kind.startsWith('occipitum_') || body.task_kind === 'web_design') {
    return {
      text: JSON.stringify({
        pages: [{ component: '<div data-mock="true">mock canvas — invariants preserved</div>' }],
        styles: [],
        _occipitum_rationale: { mock_mode: true, task_kind: body.task_kind },
      }),
      provider: 'openai',
      model: 'mock-fixture',
    };
  }
  return { text: `[mock] task_kind=${body.task_kind}`, provider: 'openai', model: 'mock-fixture' };
}

export async function generateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const body = parsed.data;

    // Mock path — keep aligned with how routing would have behaved.
    if (process.env.AISHA_LLM_MOCK === '1' || process.env.AISHA_LLM_MOCK === 'true') {
      const mock = mockFixtureFor(body);
      try {
        await rpcService('log_integration_action', {
          p_action_key: 'generate.mock',
          p_integration: 'svc-ai-chat',
          p_payload: {
            task_kind: body.task_kind,
            risk_profile: body.risk_profile,
            ...(body.metadata ?? {}),
          },
          p_tags: ['stack', 'llm', 'generate', 'mock', body.task_kind],
        });
      } catch (auditErr) {
        req.log.warn({ err: (auditErr as Error).message }, 'generate.mock audit failed');
      }
      return reply.send({
        text: mock.text,
        provider: mock.provider,
        model: mock.model,
        // Never claim a pin was honoured here: the mock path answers before any
        // routing or backend dispatch, so `model` is a fixture regardless of what
        // the caller asked for. A probe that pinned a model must see that it did
        // not get one rather than record a verdict against 'mock-fixture'.
        model_source: 'mock',
        usage: { inputTokens: 0, outputTokens: 0 },
        mock: true,
        run_id: null,
      });
    }

    // ── Aisha decides agent + model via route_task ───────────────────────
    let routePlan: RoutePlanResult;
    try {
      routePlan = (await rpcService('route_task', {
        p_constraints: body.constraints ?? {},
        p_domain: body.domain ?? [],
        p_risk_profile: body.risk_profile,
        p_story_id: body.story_id ?? null,
        p_task_kind: body.task_kind,
        p_tech: body.tech ?? [],
      })) as RoutePlanResult;
    } catch (err) {
      return reply.code(502).send({ error: 'route_task_failed', detail: (err as Error).message });
    }

    if (!routePlan?.agents?.length) {
      return reply.code(502).send({ error: 'route_plan_empty', detail: 'route_task returned no agents' });
    }

    const primary = routePlan.agents[0];
    const preferredModel = primary.model;
    if (!preferredModel) {
      return reply.code(502).send({ error: 'route_plan_no_model', detail: `agent ${primary.slug} has no model` });
    }
    // Model axis — two paths, and the difference is deliberate.
    //
    // ROUTED (no body.model): capability-availability (ZADÁNÍ §2.4) remaps the
    // route_task-picked model onto a CONFIGURED backend, so generation runs on
    // whichever provider the instance actually has.
    //
    // PINNED (body.model): the caller asserted a model. Remapping it would answer
    // from a different model while reporting the requested one — for a conformance
    // probe that is a fabricated verdict, and for a user's explicit "use this
    // model" it is a lie. So we check servability and refuse instead.
    //
    // route_task ran either way: run_id, agent, tools_allowlist and the governance
    // admission are identical. Only the model differs, and `model_source` on the
    // response and the audit row records which path produced it.
    let model: string;
    let provider: LlmProvider;
    const modelSource: 'route_task' | 'caller_pinned' = body.model ? 'caller_pinned' : 'route_task';

    if (body.model) {
      if (!isModelServable(body.model)) {
        return reply.code(422).send({
          error: 'model_not_servable',
          detail:
            `No configured backend can serve "${body.model}". A pinned model is never ` +
            `remapped — omit \`model\` to let route_task choose an available one.`,
          requested_model: body.model,
          routed_model: preferredModel,
        });
      }
      model = body.model;
      provider = resolveProvider(body.model);
    } else {
      ({ model, provider } = resolveAvailableModel(preferredModel));
    }

    await journalDispatch({ model, provider, reason: 'generate' });

    try {
      const rawResult = await unifiedChat({
        provider,
        model,
        systemPrompt: body.system,
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        jsonMode: body.json_mode,
      });

      // OWASP AITG output guard: classify the model text before it leaves the
      // service; on violation the caller receives a safe refusal instead of the
      // unsafe output. Other response fields (provider/model/usage) are unchanged.
      const guarded = await withAitgGuardOrRefuse(
        {
          runner: aitgRunner,
          buildSha: config.buildSha ?? 'dev',
          triggeredBy: 'self',
          enabled: ['AITG-APP-01', 'AITG-APP-12'],
          service: 'svc-ai-chat:generate',
        },
        async () => ({ text: rawResult.text }),
        { text: 'I cannot help with that request.' },
      );
      if (guarded.violated) {
        req.log.warn(
          { run_id: routePlan.run_id, tests: Object.keys(guarded.observations) },
          'generate AITG output guard violation — refusal substituted',
        );
      }
      const result = { ...rawResult, text: guarded.result.text };

      try {
        await rpcService('log_integration_action', {
          p_action_key: 'generate.complete',
          p_integration: 'svc-ai-chat',
          p_payload: {
            task_kind: body.task_kind,
            risk_profile: body.risk_profile,
            run_id: routePlan.run_id,
            routing_method: routePlan.routing_method,
            agent_slug: primary.slug,
            provider: result.provider,
            model: result.model,
            // Provenance of the model axis: whether Aisha picked it or a caller
            // forced it, what route_task would have used, and the stated reason.
            // Without this a pinned run is indistinguishable from a routed one
            // after the fact — and "who chose the model" is the whole question
            // when a conformance verdict is later challenged.
            model_source: modelSource,
            routed_model: preferredModel,
            ...(modelSource === 'caller_pinned'
              ? { model_override_reason: body.model_override_reason }
              : {}),
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            ...(body.metadata ?? {}),
          },
          p_tags: [
            'stack',
            'llm',
            'generate',
            body.task_kind,
            ...(modelSource === 'caller_pinned' ? ['model-pinned'] : []),
          ],
        });
      } catch (auditErr) {
        req.log.warn({ err: (auditErr as Error).message }, 'generate.complete audit failed');
      }

      return reply.send({
        text: result.text,
        provider: result.provider,
        model: result.model,
        // Callers that pinned a model can assert they got it; callers that did
        // not can see what Aisha chose. A probe MUST check this before writing
        // a verdict against `model`.
        model_source: modelSource,
        routed_model: preferredModel,
        usage: result.usage,
        run_id: routePlan.run_id,
        agent_slug: primary.slug,
        routing_method: routePlan.routing_method,
      });
    } catch (err) {
      const error = err as Error;
      try {
        await rpcService('log_integration_action', {
          p_action_key: 'generate.fail',
          p_integration: 'svc-ai-chat',
          p_payload: {
            task_kind: body.task_kind,
            risk_profile: body.risk_profile,
            run_id: routePlan.run_id,
            agent_slug: primary.slug,
            provider,
            model,
            error: error.message,
            ...(body.metadata ?? {}),
          },
          p_tags: ['stack', 'llm', 'generate', 'fail', body.task_kind],
        });
      } catch {
        // primary error wins
      }
      return reply.code(502).send({ error: 'upstream_failed', detail: error.message, run_id: routePlan.run_id });
    }
  });
}
