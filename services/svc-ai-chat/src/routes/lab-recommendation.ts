/**
 * POST /lab-recommendation — AI-assisted lab test panel recommendation.
 *
 * Client contract: the web hook `useLabTestRecommendations` invokes the
 * 'ai-lab-recommendation' function with an `AiLabRecommendationRequest` body and
 * validates the reply with `AiLabRecommendationResponseSchema` (both defined in
 * web `src/schemas/labTestSchemas.ts`). The Zod schemas below MIRROR that contract
 * — kept in-service because a Fastify microservice cannot import the web app's
 * source tree. If the web contract changes, update both sides.
 *
 * Flow:
 *   1. verifyToken — user JWT (this is a per-user surface, NOT service_role).
 *   2. Validate the body against the mirrored request schema.
 *   3. route_task → resolveAvailableModel → unifiedChat (the canonical Aisha LLM
 *      path, identical to /generate) with JSON output mode.
 *   4. EVERY LLM call in this repo runs through the AITG output guard
 *      (AITG-APP-01 injection bleed-through, AITG-APP-12 toxic output). A guard
 *      violation fails LOUD (502) — never a fabricated recommendation.
 *   5. Parse + validate the model output into the response schema. Identity
 *      fields (user_id, story_id, generated_at) are stamped SERVER-SIDE from the
 *      authenticated principal — never trusted from model output (AITG-APP-04).
 *   6. On any model/parse/validation failure return a clean 5xx (fail loud). We
 *      do NOT synthesise a hardcoded fallback recommendation — a wrong lab panel
 *      is a clinical hazard, so the caller must see the failure.
 *
 * CLINICAL CAVEAT: the prompt and the notion of an LLM proposing diagnostic lab
 * panels require product + clinical review before this is relied upon in care.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { withAitgGuard, createAitgRunner } from '@aisha/aitg';
import { verifyToken, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { resolveAvailableModel, unifiedChat } from '../lib/llmRouter.js';
import { journalDispatch } from '../lib/dispatchJournal.js';

// ── AITG runner (same wiring as /chat + /public-chat) ────────────────────────
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:lab-recommendation',
});

// ── Contract enums (mirror web src/schemas/labTestSchemas.ts) ─────────────────
const SampleTypeSchema = z.enum(['blood', 'urine', 'stool', 'saliva']);
const TestPrioritySchema = z.enum(['required', 'recommended', 'conditional', 'optional']);
const PanelTimingSchema = z.enum(['pre_program', 'month_3', 'month_6', 'month_12', 'on_indication']);
const RtnProductSchema = z.enum(['retisin', 'lyastin', 'floristen', 'silexil']);

// ── Request contract (AiLabRecommendationRequestSchema) ───────────────────────
// `user_id` is OPTIONAL here: the authenticated JWT is the authoritative source
// of the principal (AITG-APP-04). Any client-supplied user_id is ignored for the
// response identity.
const RequestSchema = z.object({
  story_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  products: z.array(RtnProductSchema),
  anamnesis: z.string().optional(),
  existing_conditions: z.array(z.string()).optional(),
  recent_lab_results: z
    .array(z.object({ code: z.string(), value: z.string(), date: z.string() }))
    .optional(),
  exclude_tests: z.array(z.string()).optional(),
  timing: PanelTimingSchema.optional(),
  // Any BCP47 locale (cs/en/de/fr/ru/th/…), not a cs/en allowlist; 'en' is the
  // terminal failover when the caller supplies none.
  language: z
    .string()
    .min(2)
    .refine((v) => {
      try {
        Intl.getCanonicalLocales(v);
        return true;
      } catch {
        return false;
      }
    }, 'language must be a BCP47-style locale code')
    .default('en'),
});
type RequestBody = z.infer<typeof RequestSchema>;

// ── Response contract (LabTestRecommendationResponseSchema) ───────────────────
const LabTestRecommendationSchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  priority: TestPrioritySchema,
  reason: z.string(),
  price: z.number().positive(),
  sample_type: SampleTypeSchema,
  requires_fasting: z.boolean(),
});

const PanelRecommendationSchema = z.object({
  panel_id: z.string(),
  panel_name: z.string(),
  panel_description: z.string(),
  timing: PanelTimingSchema,
  is_mandatory: z.boolean(),
  tests: z.array(LabTestRecommendationSchema),
  total_price: z.number(),
  reason: z.string(),
});

const RecommendationSchema = z.object({
  story_id: z.string().uuid(),
  user_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  products: z.array(RtnProductSchema),
  conditions: z.array(z.string()),
  panels: z.array(PanelRecommendationSchema),
  total_tests_count: z.number().int().nonnegative(),
  total_estimated_price: z.number().nonnegative(),
  requires_fasting: z.boolean(),
  sample_types_required: z.array(SampleTypeSchema),
  ai_notes: z.string().optional(),
});

// The model is asked to produce ONLY the clinical content; identity + totals are
// stamped/validated server-side. This is the slice we parse out of model output.
const ModelOutputSchema = z.object({
  panels: z.array(PanelRecommendationSchema),
  conditions: z.array(z.string()),
  requires_fasting: z.boolean(),
  sample_types_required: z.array(SampleTypeSchema),
  ai_notes: z.string().optional(),
});

interface RoutePlanResult {
  run_id: string;
  agents: Array<{ slug: string; model: string }>;
}

function buildSystemPrompt(language: string): string {
  return [
    'You are a clinical laboratory-test advisor for a supplementation program.',
    'Given a patient context, propose lab-test PANELS to monitor safety and efficacy.',
    `Answer in language "${language}".`,
    'Return ONLY a single JSON object, no prose, with this exact shape:',
    '{',
    '  "conditions": string[],',
    '  "requires_fasting": boolean,',
    '  "sample_types_required": ("blood"|"urine"|"stool"|"saliva")[],',
    '  "ai_notes": string,',
    '  "panels": [{',
    '    "panel_id": string, "panel_name": string, "panel_description": string,',
    '    "timing": "pre_program"|"month_3"|"month_6"|"month_12"|"on_indication",',
    '    "is_mandatory": boolean, "total_price": number, "reason": string,',
    '    "tests": [{',
    '      "code": string, "name": string, "category": string,',
    '      "priority": "required"|"recommended"|"conditional"|"optional",',
    '      "reason": string, "price": number (>0),',
    '      "sample_type": "blood"|"urine"|"stool"|"saliva", "requires_fasting": boolean',
    '    }]',
    '  }]',
    '}',
    'Every price MUST be a positive number. Do not invent identity fields.',
  ].join('\n');
}

function buildUserPrompt(body: RequestBody): string {
  const parts = [`Products: ${body.products.join(', ') || '(none)'}`];
  if (body.anamnesis) parts.push(`Anamnesis: ${body.anamnesis}`);
  if (body.existing_conditions?.length) parts.push(`Existing conditions: ${body.existing_conditions.join(', ')}`);
  if (body.recent_lab_results?.length) {
    parts.push(
      `Recent lab results: ${body.recent_lab_results.map((r) => `${r.code}=${r.value} (${r.date})`).join('; ')}`,
    );
  }
  if (body.exclude_tests?.length) parts.push(`Exclude tests (codes): ${body.exclude_tests.join(', ')}`);
  if (body.timing) parts.push(`Program timing focus: ${body.timing}`);
  return parts.join('\n');
}

export async function labRecommendationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/lab-recommendation', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1. Auth — user JWT.
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    // 2. Validate the request body against the mirrored contract.
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const body = parsed.data;

    // 3. Aisha routes the task → model, then unifiedChat dispatches (canonical path).
    let routePlan: RoutePlanResult;
    try {
      routePlan = (await rpcService('route_task', {
        p_constraints: {},
        p_domain: ['health', 'lab'],
        p_risk_profile: 'high',
        p_story_id: body.story_id,
        p_task_kind: 'lab_recommendation',
        p_tech: [],
      })) as RoutePlanResult;
    } catch (err) {
      return reply.code(502).send({ error: 'route_task_failed', detail: (err as Error).message });
    }
    const preferredModel = routePlan?.agents?.[0]?.model;
    if (!preferredModel) {
      return reply.code(502).send({ error: 'route_plan_empty' });
    }
    const { model, provider } = resolveAvailableModel(preferredModel);

    // Journal the dispatch BEFORE calling unifiedChat (I1 gate: every LLM dispatch
    // must have a matching audit_journal entry).
    await journalDispatch({ model, provider, reason: 'lab_recommendation' });

    // 4. LLM call wrapped in the AITG output guard (mandatory for every LLM call).
    let modelText: string;
    let guardViolated = false;
    try {
      const guarded = await withAitgGuard(
        {
          runner: aitgRunner,
          buildSha: config.buildSha ?? 'dev',
          triggeredBy: 'self',
          enabled: ['AITG-APP-01', 'AITG-APP-12'],
          service: 'svc-ai-chat:lab-recommendation',
        },
        async () => {
          const result = await unifiedChat({
            provider,
            model,
            systemPrompt: buildSystemPrompt(body.language),
            messages: [{ role: 'user', content: buildUserPrompt(body) }],
            jsonMode: true,
            temperature: 0,
          });
          return { text: result.text };
        },
      );
      modelText = guarded.result.text;
      guardViolated = guarded.violated;
    } catch (err) {
      return reply.code(502).send({ error: 'model_generation_failed', detail: (err as Error).message });
    }

    // Fail LOUD on an AITG violation — never leak, never fabricate a panel.
    if (guardViolated) {
      return reply.code(502).send({ error: 'aitg_guard_violation' });
    }

    // 5. Parse + validate model output. No hardcoded fallback on failure.
    let modelOut: z.infer<typeof ModelOutputSchema>;
    try {
      modelOut = ModelOutputSchema.parse(JSON.parse(modelText));
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'lab-recommendation model output failed schema validation');
      return reply.code(502).send({ error: 'model_output_invalid' });
    }

    // Stamp authoritative identity + derive totals server-side, then re-validate
    // the assembled response against the full contract.
    const totalTests = modelOut.panels.reduce((n, p) => n + p.tests.length, 0);
    const totalPrice = modelOut.panels.reduce((sum, p) => sum + p.total_price, 0);
    const recommendationCandidate = {
      story_id: body.story_id,
      user_id: user.userId,
      generated_at: new Date().toISOString(),
      products: body.products,
      conditions: modelOut.conditions,
      panels: modelOut.panels,
      total_tests_count: totalTests,
      total_estimated_price: totalPrice,
      requires_fasting: modelOut.requires_fasting,
      sample_types_required: modelOut.sample_types_required,
      ...(modelOut.ai_notes ? { ai_notes: modelOut.ai_notes } : {}),
    };
    const validated = RecommendationSchema.safeParse(recommendationCandidate);
    if (!validated.success) {
      req.log.warn({ issues: validated.error.issues }, 'lab-recommendation assembled response failed contract validation');
      return reply.code(502).send({ error: 'recommendation_invalid' });
    }

    return reply.send({ success: true, recommendation: validated.data });
  });
}
