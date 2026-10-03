/**
 * POST /story-consult — AI consultation with story context.
 *
 * Brain-wired orchestrace přes svc-ai-chat:
 *  1. compose_context (governance/psyche/kb_retrieval/project) přes orchestrationBridge.
 *  2. Hippocampus personality (base DNA + per-user evolved traits).
 *  3. Tao principles applied jako governance constraints (warmth floor, no-punitivity).
 *  4. LLM call přes unifiedChat — pro action="chat" se model přepíná na
 *     `maestro-story-{storyId}` (Alquist Insight dialog management = multi-turn USP).
 *  5. Post-turn: fn_capture_personality_signal (frustration/gratitude/curiosity) +
 *     decision metadata do session.
 *
 * Frontend NIKDY nesmí volat Maestro přímo (to by obešlo Tao/Psyche/Hippocampus).
 *
 * Actions: chat, recap, translate, recommend, analyze.
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, isAdminOrStaff, AuthError, type VerifiedUser } from '../auth.js';
import { rpcService, rpcUser } from '../postgrest.js';
import { unifiedChat, resolveAvailableModel, type UnifiedChatResult } from '../lib/llmRouter.js';
import { resolveDefaultModel } from '../lib/defaultModel.js';
import { journalDispatch } from '../lib/dispatchJournal.js';
import { buildLanguageInstruction } from '../lib/recipientLanguage.js';
import { withAitgGuardOrRefuse, createAitgRunner } from '@aisha/aitg';
import { config } from '../config.js';

// OWASP AITG output guard — classify the assistant text (AITG-APP-01 injection
// bleed-through, AITG-APP-12 toxic output) BEFORE it is persisted / returned; a
// violation is replaced with a safe refusal. Fail-soft transport (the runner
// swallows the write error and returns null — never breaks the turn).
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:story-consult',
});
import { createServiceRpcAdapter } from '../lib/rpcAdapter.js';
import { createNoopTracer } from '../lib/tracer.js';
import { createHippocampus } from '../lib/hippocampus.js';
import {
  enrichWithAishaContext,
  buildContextPromptSection,
  detectEscalationSignals,
} from '../lib/orchestrationBridge.js';

type ConsultAction = 'chat' | 'recap' | 'translate' | 'recommend' | 'analyze';

interface StoryConsultBody {
  story_id: string;
  action: ConsultAction;
  message?: string;
  target_language?: string;
  include_health_data?: boolean;
  conversation_id?: string;
  language?: string;
  /** Admin-only: override model selection (e.g. "claude-sonnet-4", "gpt-4o"). */
  model_override?: string;
  /** Admin-only: bypass Maestro pro debug (vrací se na default channel model). */
  bypass_maestro?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ACTIONS: ConsultAction[] = ['chat', 'recap', 'translate', 'recommend', 'analyze'];

/** Detect gratitude / curiosity signals in user message (frustration už dělá detectEscalationSignals). */
function detectExtraSignals(text: string): { gratitude: boolean; curiosity: boolean } {
  const t = text.toLowerCase();
  const gratitude = /\b(thanks|thank you|díky|děkuj|super|perfect|skvěl)\b/.test(t);
  const curiosity = /\b(why|how|what if|jak to|proč|co kdyby)\b/.test(t) || (t.match(/\?/g)?.length ?? 0) >= 2;
  return { gratitude, curiosity };
}

export async function storyConsultRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: StoryConsultBody }>('/story-consult', async (req, reply) => {
    const startTime = Date.now();

    let user: VerifiedUser;
    let jwt: string;
    try {
      user = await verifyToken(req.headers.authorization);
      jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    // verifyToken maps the JWT sub onto `.userId` (local VerifiedUser has no
    // `.sub`); userId is the canonical aisha user id — threaded into
    // compose_context's p_requester_id for per-story RBAC, so it MUST be real.
    const userId = user.userId;
    const body = req.body;

    // Validate
    if (!body?.story_id || !UUID_RE.test(body.story_id)) {
      return reply.code(400).send({ error: 'story_id must be a valid UUID' });
    }
    if (!body.action || !VALID_ACTIONS.includes(body.action)) {
      return reply.code(400).send({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }
    if (body.action === 'chat' && !body.message) {
      return reply.code(400).send({ error: 'message is required for chat action' });
    }

    const language = body.language ?? 'en';
    const adminStaff = isAdminOrStaff(user);

    // Access check: admin/staff, partner, or qualified member
    if (!adminStaff) {
      const accessCheck = await rpcUser<{ access_level: string; can_chat: boolean }>(
        'get_chat_access_level', { p_user_id: userId }, jwt,
      );
      if (!accessCheck?.can_chat) {
        return reply.code(403).send({ error: 'AI consultation requires qualified access' });
      }
    }

    // Get story context
    const context = await rpcUser<{
      story_id: string;
      has_consent: boolean;
      timeline_summary: Array<{ type: string; date: string; preview: string | null }>;
      study_info: { name: string; status: string } | null;
      recent_checkins: Array<{ date: string; pain_level: number | null; mood_level: number | null }>;
    }>('get_story_context_for_ai_audited', { p_story_id: body.story_id }, jwt);

    if (!context) {
      return reply.code(404).send({ error: 'Story not found' });
    }
    if (!context.has_consent) {
      return reply.code(403).send({ error: 'Consent required' });
    }

    // Get/create conversation thread
    const threadData = await rpcService<{ conversation_id: string }>('edge_story_ai', {
      p_action: 'get_or_create_story_conversation',
      p_payload: { story_id: body.story_id, user_id: userId, title: `Story consultation ${body.story_id.substring(0, 8)}` },
    });

    const conversationId = threadData?.conversation_id;
    if (!conversationId) {
      return reply.code(500).send({ error: 'Failed to resolve story thread' });
    }

    // Fetch history
    const historyData = await rpcUser<Array<{ role: string; content: string }>>(
      'get_chat_messages_audited', { p_conversation_id: conversationId }, jwt,
    );
    const history = (historyData ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // ────────────────────────────────────────────────────────────────────
    // BRAIN WIRING — Tao + Psyche + Hippocampus + compose_context (Ragnarok hybrid)
    // ────────────────────────────────────────────────────────────────────

    const aishaRpcService = createServiceRpcAdapter();
    const tracer = createNoopTracer();
    const hippocampus = createHippocampus(aishaRpcService, tracer, {
      userId,
      conversationId,
    });

    // 1) compose_context — vrací bundle s vrstvami: governance_context (Tao),
    //    psyche_context, kb_retrieval (pgvector + Ragnarok hybrid), project_context, ruleset.
    const contextBundle = await enrichWithAishaContext(aishaRpcService, {
      storyId: body.story_id,
      contextProfile: 'chat_lightweight',
      // User-initiated story consult: enforce per-story RBAC inside compose_context.
      requesterId: userId,
      query: body.action === 'chat' ? body.message : undefined,
      conversationHistory: history.slice(-6),
    });

    const taoPrinciples = (contextBundle?.layers?.governance_context as { tao_principles?: unknown[] } | undefined)
      ?.tao_principles ?? [];

    // 2) Hippocampus — base traits (Psyche DNA) + per-user evolved traits
    const personality = await hippocampus.resolvePersonality();
    const personalityPrompt = hippocampus.buildPersonalityPrompt(personality);

    // 3) Detect escalation signals (frustration / compliance / incident / highValue)
    const userMessage = body.action === 'chat' ? body.message ?? '' : '';
    const escalationSignals = userMessage ? detectEscalationSignals(userMessage) : [];

    // ────────────────────────────────────────────────────────────────────
    // Build context string + enhanced system prompt
    // ────────────────────────────────────────────────────────────────────

    let contextStr = `## Story Context\n**Story ID:** ${context.story_id}\n`;
    if (context.study_info) contextStr += `**Study:** ${context.study_info.name} (${context.study_info.status})\n`;
    const timeline = context.timeline_summary ?? [];
    if (timeline.length > 0) {
      contextStr += `\n### Timeline (${timeline.length} entries)\n`;
      for (const e of timeline.slice(0, 15)) {
        contextStr += `- [${e.date}] **${e.type}**: ${(e.preview ?? '').substring(0, 200)}\n`;
      }
    }

    // Build prompt
    const userPrompt = body.action === 'chat' ? body.message! :
      body.action === 'recap' ? `${contextStr}\n\nProveď rekapitulaci.` :
      body.action === 'translate' ? `Přelož do jazyka: ${body.target_language}\n\n${timeline.slice(0, 10).map(e => e.preview).filter(Boolean).join('\n\n---\n\n')}` :
      body.action === 'recommend' ? `${contextStr}\n\nNavrhni kroky.` :
      `${contextStr}\n\nProveď analýzu.`;

    // Save user message
    await rpcUser('save_chat_message_audited', {
      p_content: body.action === 'chat' ? body.message! : `[story_action:${body.action}]`,
      p_conversation_id: conversationId,
      p_role: 'user',
      p_routing_category: `story_${body.action}`,
    }, jwt).catch(() => {});

    // Load channel config (default model + system prompt)
    const channelConfig = await rpcService<{
      model: string; system_prompt: string; temperature: number; max_tokens: number;
    }>('get_active_channel_config', { p_channel_slug: 'ai-story-consult' });

    // ────────────────────────────────────────────────────────────────────
    // Model selection — Maestro pro multi-turn 'chat' (Alquist Insight USP)
    // ────────────────────────────────────────────────────────────────────
    //
    // Maestro je dialog management vrstva (Alexa Prize multi-turn coherence USP).
    // Plně funkční přes aisha-kronos-shim (soft adapter Maestro→AISHA RPC +
    // Ragnarok). Default zapnutý pro action='chat' pokud Insight stack běží.
    //
    // Opt-out: body.bypass_maestro=true vypne Maestra pro debug, body.model_override
    // přepíše na konkrétní cloud model. INSIGHT_MAESTRO_PROVIDER=disabled env
    // globálně vypne (např. když shim není nasazený).
    //
    // Default flow pro non-chat actions (recap/translate/recommend/analyze):
    // cloud LLM s brain wiringem (compose_context + Hippocampus + governance) —
    // single-turn deterministika nepotřebuje Maestro session.
    //
    // I bez Maestra orchestrationBridge provádí Ragnarok hybrid retrieval s
    // per-story `kb_ids` filterem (graceful degradation pokud shim není živý).

    const maestroProviderDisabled =
      process.env.INSIGHT_MAESTRO_PROVIDER === 'disabled' ||
      process.env.INSIGHT_MAESTRO_PROVIDER === 'false';

    const useMaestro =
      body.action === 'chat' &&
      !body.bypass_maestro &&
      !maestroProviderDisabled &&
      Boolean(process.env.MAESTRO_URL && process.env.MAESTRO_API_KEY);

    const projectId = `story-${body.story_id}`;
    // No channel pin → AISHA resolves the model live over the serviceable pool (no
    // hardcoded 'gpt-4o'); the ?? guards the RPC so a pinned channel pays nothing. Also
    // serves as the degradation fallback model if maestro fails below.
    const fallbackModel = channelConfig?.model ?? (await resolveDefaultModel('story_consult'));

    let model: string;
    if (body.model_override && adminStaff) {
      model = body.model_override;
    } else if (useMaestro) {
      model = `maestro-${projectId}`;
    } else {
      model = fallbackModel;
    }

    // Compose final system prompt: Personality (Psyche+Hippocampus) + Channel base
    // + Tao governance markers + Story context + compose_context bundle.
    const aishaContextSection = contextBundle ? buildContextPromptSection(contextBundle) : '';
    const taoNote = taoPrinciples.length > 0
      ? `\n\n## Governance (Tao)\n${taoPrinciples.length} core principles applied. Always honor warmth floor, never punitive responses, transform vulgarity rather than reject.`
      : '';

    const enhancedSystemPrompt = [
      personalityPrompt,
      channelConfig?.system_prompt ?? '',
      // Answer in the recipient's language — Intl-derived, works for any locale
      // (cs/en/de/fr/ru/th/…), not a cs/en binary that collapses to English.
      buildLanguageInstruction(language),
      taoNote,
      aishaContextSection,
    ].filter((s) => s && s.trim().length > 0).join('\n\n');

    // ────────────────────────────────────────────────────────────────────
    // LLM call (Maestro pro chat, cloud pro ostatní actions)
    // ────────────────────────────────────────────────────────────────────

    let result: UnifiedChatResult;
    // Consolidated onto the canonical lib/llmRouter.ts (camel) — registry +
    // fallback + circuit-breaker + Maestro provider parity (lib/providers/maestro.ts).
    // journalDispatch uses the SAME resolveProvider (router-consolidation §7/§20 P0 #1).
    // Capability-availability dynamic selection (ZADÁNÍ §2.4 / "uses what it has"):
    // remap the chosen model (maestro / override / channel default) to a CONFIGURED
    // backend so the turn runs on whichever provider the instance has. Canonical
    // idiom — reflection/decision.ts:196. (Runtime-failure fallback below is a
    // separate, complementary layer.)
    const { model: dispatchModel, provider: dispatchProvider } = resolveAvailableModel(model);
    await journalDispatch({ model: dispatchModel, provider: dispatchProvider, reason: 'story-consult' });
    try {
      result = await unifiedChat({
        provider: dispatchProvider,
        model: dispatchModel,
        messages: [
          ...history.slice(-20),
          { role: 'developer' as const, content: `## STORY CONTEXT\n${contextStr}` },
          { role: 'user' as const, content: userPrompt },
        ],
        systemPrompt: enhancedSystemPrompt,
        temperature: body.action === 'translate' ? 0.3 : (channelConfig?.temperature ?? 0.7),
        maxTokens: channelConfig?.max_tokens ?? 3000,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Maestro failure → fallback na cloud LLM přes orchestrationBridge brain wiring.
      // Důvody fallbacku: Kronos shim nedostupný, vLLM container down, OPENAI key
      // missing, network partition v mesh. Fail-safe garantuje uživateli funkční
      // odpověď i když Insight stack částečně down.
      if (useMaestro) {
        req.log.warn(
          { err: errMsg, fallbackModel, originalModel: model },
          'Maestro provider failed, fallback na cloud LLM (degradation-safe)',
        );
        try {
          const { model: fbModel, provider: fbProvider } = resolveAvailableModel(fallbackModel);
          await journalDispatch({ model: fbModel, provider: fbProvider, reason: 'story-consult.fallback' });
          result = await unifiedChat({
            provider: fbProvider,
            model: fbModel,
            messages: [
              ...history.slice(-20),
              { role: 'developer' as const, content: `## STORY CONTEXT\n${contextStr}` },
              { role: 'user' as const, content: userPrompt },
            ],
            systemPrompt: enhancedSystemPrompt,
            temperature: channelConfig?.temperature ?? 0.7,
            maxTokens: channelConfig?.max_tokens ?? 3000,
          });
        } catch (fallbackErr) {
          req.log.error(
            { err: fallbackErr, originalErr: errMsg },
            'Both Maestro a fallback cloud LLM zfailily',
          );
          return reply.code(503).send({
            error: 'AI service unavailable',
            details: errMsg,
            fallback_attempted: true,
          });
        }
      } else {
        req.log.error({ err: errMsg, model }, 'Cloud LLM call zfailil bez Maestro fallback option');
        return reply.code(503).send({ error: 'AI service unavailable', details: errMsg });
      }
    }

    // OWASP AITG output guard — classify the assistant text before it is persisted
    // and returned; on violation replace it with a safe refusal (the saved message,
    // the `response` field, and the metadata all reflect the guarded text).
    const aitgGuarded = await withAitgGuardOrRefuse(
      {
        runner: aitgRunner,
        buildSha: config.buildSha ?? 'dev',
        triggeredBy: 'self',
        enabled: ['AITG-APP-01', 'AITG-APP-12'],
        service: 'svc-ai-chat:story-consult',
      },
      async () => ({ text: result.text }),
      {
        text: language === 'cs'
          ? 'S touto žádostí bohužel nemohu pomoci.'
          : 'I cannot help with that request.',
      },
    );
    if (aitgGuarded.violated) {
      result = { ...result, text: aitgGuarded.result.text };
      req.log.warn(
        { tests: Object.keys(aitgGuarded.observations) },
        'story-consult AITG output guard violation — refusal substituted',
      );
    }

    const responseTime = Date.now() - startTime;

    // ────────────────────────────────────────────────────────────────────
    // POST-TURN: personality signal capture (fire-and-forget) — Hippocampus evolution
    // ────────────────────────────────────────────────────────────────────

    if (userMessage && body.action === 'chat') {
      const extra = detectExtraSignals(userMessage);
      if (escalationSignals.includes('frustration')) {
        hippocampus.captureSignal('frustration', { story_id: body.story_id }, 0.7);
      }
      if (extra.gratitude) {
        hippocampus.captureSignal('gratitude', { story_id: body.story_id }, 0.5);
      }
      if (extra.curiosity) {
        hippocampus.captureSignal('curiosity', { story_id: body.story_id }, 0.4);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Save assistant message + session metadata
    // ────────────────────────────────────────────────────────────────────

    const personalityTraitsUsed = personality.traits.slice(0, 8).map((t) => t.slug ?? t.title);
    const usedMaestro = useMaestro && result.model.toLowerCase().startsWith('maestro');

    const savedMsg = await rpcService<{ id: string }>('save_chat_message_audited', {
      p_content: result.text,
      p_conversation_id: conversationId,
      p_model_used: result.model,
      p_response_time_ms: responseTime,
      p_role: 'assistant',
      p_routing_category: body.action === 'chat' ? 'Else' : `story_${body.action}`,
      p_tokens_input: result.usage.inputTokens,
      p_tokens_output: result.usage.outputTokens,
      p_user_id: userId,
    });

    // Save session
    await rpcService('edge_story_ai', {
      p_action: 'insert_session',
      p_payload: {
        story_id: body.story_id,
        user_id: userId,
        session_type: body.action === 'chat' ? 'consultation' : body.action,
        conversation_id: conversationId,
        tokens_used: result.usage.inputTokens + result.usage.outputTokens,
        response_time_ms: responseTime,
        summary: `Story consult: ${body.action}, ${result.usage.inputTokens + result.usage.outputTokens} tokens, model=${result.model}`,
      },
    }).catch(() => {});

    return reply.send({
      conversation_id: conversationId,
      message: {
        id: savedMsg?.id ?? null,
        role: 'assistant',
        content: result.text,
        routing_category: body.action === 'chat' ? 'Else' : `story_${body.action}`,
        created_at: new Date().toISOString(),
      },
      response: result.text,
      action: body.action,
      tokens_used: result.usage.inputTokens + result.usage.outputTokens,
      metadata: {
        response_time_ms: responseTime,
        model: result.model,
        provider: usedMaestro ? 'maestro' : undefined,
        personality_traits_used: personalityTraitsUsed,
        governance_tao_applied: taoPrinciples.length,
        kb_retrieval_chunks:
          (contextBundle?.layers?.kb_retrieval as { chunks?: unknown[] } | undefined)?.chunks?.length ?? 0,
        escalation_signals: escalationSignals,
        used_maestro_dialog: usedMaestro,
      },
    });
  });
}
