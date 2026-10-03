import { createServiceRpcAdapter, type PostgrestClient } from "../lib/rpcAdapter.js";
import { createUserScopedRpcAdapter } from "../lib/userScopedRpc.js";
import { withAitgGuardOrRefuse, createAitgRunner } from "@aisha/aitg";
import { config } from "../config.js";
import {
  getGuardrailsConfig,
  applyGuardrailsToResponse,
  buildRestrictionPrompt,
  maskPII,
  getGuardrailsTierLabel,
  type ChatAccessLevel,
} from "../lib/guardrails-config.js";

import { corsGuard } from "../lib/analyzeTrackingDocumentGuards.js";
import { preflightResponse, silentCorsDenyResponse, buildCorsHeaders } from "../lib/cors.js";
import { getOpenAiApiKey } from "../lib/openaiKey.js";
import { estimateSpendUsd } from "../lib/spendEstimate.js";
import { resolveDefaultBackend, resolveDefaultModel } from "../lib/defaultModel.js";
import { evaluateChatMessage } from "../lib/messageEvaluation.js";
import { shouldSampleEval } from "../lib/evalSampleRate.js";
import { assertValidLocale, buildLanguageInstruction } from "../lib/recipientLanguage.js";
import { getAllowedOriginsRaw } from "../lib/runtimeConfig.js";
import { createTracer, createNoopTracer, type Tracer } from "../lib/tracer.js";
import { type LlmToolSpec, unifiedChat } from "../lib/llmRouter.js";
import { createToolExecutor } from "../lib/toolExecutor.js";
import { applyRouteToolsAllowlist, isDynamicToolSelectionEnabled } from "../lib/toolSelection.js";
import {
  computeInputBudget,
  isAdaptiveContextBudgetEnabled,
  trimContextBundleLayers,
} from "../lib/contextBudget.js";
import { compactHistoryIfNeeded } from "../lib/contextCompactor.js";
import { getAiRuntimeConfig } from "../lib/aiRuntimeConfig.js";
import { createMemoryManager, type MemoryManager } from "../lib/memoryManager.js";
import { createHippocampus, type Hippocampus, type PersonalityContext } from "../lib/hippocampus.js";
import { createWorkflowEngine, loadWorkflow, DEFAULT_CHAT_WORKFLOW, type WorkflowContext, type RoutePlanHint } from "../lib/workflowEngine.js";
import {
  routeViaAisha,
  enrichWithAishaContext,
  analyzeChatQueryIntent,
  temperatureForTaskCategory,
  buildContextPromptSection,
  detectEscalationSignals,
  shouldAishaRespond,
  buildAishaContentMetadata,
  selectOptimalModel,
  classifyMessageComplexity,
  chooseExecutionStrategy,
  kickOffReflectionWorkflow,
  type RoutePlan,
  type ContextBundle,
  type AishaParticipationResult,
  type AishaContentMetadata,
  type ModelSelectionResult,
} from "../lib/orchestrationBridge.js";
import {
  resolveGovernanceDecision,
  detectDataSensitivity,
  auditResidencyVerdict,
  toRoutePlanHint,
  type GovernanceDecision,
  type EscalationSignal,
} from "../lib/governedOrchestration.js";
import { getExecutionMode } from "@aisha/llm-dispatch";
import { runCriticLoop } from "../lib/criticLoop.js";
import { groundingFromChannel, odpovedZFaktu } from "../lib/groundedAnswer.js";
import { recordExecutionDecision, toExecutionDecision } from "../reflection/decision.js";

const allowedOriginsRaw = getAllowedOriginsRaw();

// OWASP AITG output guard — same runner the public-chat n8n path uses, tagged for
// the authenticated /chat surface. Fail-soft transport (a PostgREST outage never
// breaks a chat turn); the classifier verdict itself is enforced below.
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:chat',
});

// ============================================
// TYPES
// ============================================
interface ChatRequest {
  conversation_id?: string;
  message: string;
  /** Recipient's language as a BCP47-style locale (cs/en/ru/th/fr/de/…). AISHA answers in THIS language regardless of the source language of the knowledge. Not a cs/en allowlist. */
  language?: string;
  debug?: boolean;
  story_id?: string;
  /** Admin-only: override model selection for A/B testing (e.g. "local-llama3.2", "claude-sonnet-4") */
  model_override?: string;
  /**
   * Pohled uživatele (vektor scope z Asku). Jde JEN do RPC faktů kanálu z faktů
   * (`guardrails.grounding`) pod oprávněním uživatele — scope tam ověří
   * `scope_effective`, server ho sám nevykládá.
   */
  scope?: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatAccessResult {
  access_level: ChatAccessLevel;
  can_chat: boolean;
  block_reason: string | null;
}

interface AgentConfig {
  id: string;
  name: string;
  model: string;
  instructions: string;
  temperature: number;
  max_tokens: number;
  routing_category?: string;
  model_settings?: {
    reasoning?: { effort: 'low' | 'medium' | 'high' };
    [key: string]: unknown;
  };
}

interface ChatDebugEvent {
  stage: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
}

// ============================================
// VALIDATION
// ============================================
function validateRequest(body: unknown): ChatRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.message !== 'string' || !obj.message.trim()) {
    throw new Error('Message is required and must be a non-empty string');
  }

  if (obj.conversation_id !== undefined && typeof obj.conversation_id !== 'string') {
    throw new Error('conversation_id must be a string if provided');
  }

  if (obj.language !== undefined) {
    // Universal: any BCP47-style locale — AISHA answers in the RECIPIENT's language, never a
    // cs/en allowlist. Intl-derived validation (no regex) lives in lib/recipientLanguage.
    assertValidLocale(obj.language);
  }

  if (obj.debug !== undefined && typeof obj.debug !== 'boolean') {
    throw new Error('debug must be a boolean if provided');
  }

  if (obj.story_id !== undefined && typeof obj.story_id !== 'string') {
    throw new Error('story_id must be a string if provided');
  }

  if (obj.model_override !== undefined && typeof obj.model_override !== 'string') {
    throw new Error('model_override must be a string if provided');
  }

  if (obj.scope !== undefined && obj.scope !== null && (typeof obj.scope !== 'object' || Array.isArray(obj.scope))) {
    throw new Error('scope must be an object if provided');
  }

  return {
    conversation_id: obj.conversation_id as string | undefined,
    message: obj.message as string,
    language: (obj.language as string) || 'en',
    debug: obj.debug as boolean | undefined,
    story_id: obj.story_id as string | undefined,
    model_override: obj.model_override as string | undefined,
    scope: (obj.scope ?? undefined) as Record<string, unknown> | undefined,
  };
}

async function resolveChatStoryId(
  pgrestUser: PostgrestClient,
  fallbackStoryId?: string,
): Promise<string | null> {
  if (fallbackStoryId && fallbackStoryId.trim().length > 0) {
    return fallbackStoryId.trim();
  }

  const { data, error } = await pgrestUser.rpc('get_chat_context_story_id', {});
  if (error) {
    log.safeWarn('[ai-chat] get_chat_context_story_id failed (non-blocking)', { error: error.message });
    return null;
  }

  if (typeof data === 'string' && data.length > 0) {
    return data;
  }

  return null;
}

// ============================================
// MAIN HANDLER (Web-API style — wrapped by Fastify at bottom)
// ============================================
async function handleChatRequest(req: Request): Promise<Response> {
  // CORS origin validation
  const originFailure = corsGuard({
    origin: req.headers.get('Origin'),
    allowedOriginsRaw,
  });
  if (originFailure) {
    return silentCorsDenyResponse();
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return preflightResponse(req, allowedOriginsRaw);
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  const startTime = Date.now();
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let debugEnabled = false;
  let toolIterationsUsed = 0;
  const debugEvents: ChatDebugEvent[] = [];

  // Tracer starts as noop; replaced with real tracer after auth
  let tracer: Tracer = createNoopTracer();

  const addDebug = (stage: string, message: string, level: ChatDebugEvent['level'] = 'info') => {
    if (!debugEnabled) return;
    debugEvents.push({
      stage,
      message,
      level,
      timestamp: new Date().toISOString(),
    });
  };

  const withDebug = <T extends Record<string, unknown>>(payload: T): T & { debug?: ChatDebugEvent[] } => (
    debugEnabled ? { ...payload, debug: [...debugEvents] } : payload
  );

  try {
    // ----------------------------------------
    // 1. AUTHENTICATE USER
    // ----------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      log.safeError('[ai-chat] No authorization header', undefined);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ----------------------------------------
    // SERVICE-plane RPC client (role=service_role, no `sub` → auth.uid()=NULL).
    // DELIBERATE for the platform/orchestration plane ONLY — each remaining
    // pgrestService call is service-scoped on purpose:
    //   - createTracer / set_ai_run_workflow: ai_runs observability rows are
    //     platform-owned (actor recorded via explicit p_actor_user_id).
    //   - routeViaAisha (route_task): orchestration-plane run registration.
    //   - get_active_channel_config / loadWorkflow: platform catalogs, not
    //     caller-owned data.
    //   - enrichWithAishaContext (compose_context): runs service-side but
    //     enforces per-story RBAC via the explicit p_requester_id=userId param.
    //   - get_model_pricing / fn_admit_clow: pricing + governance admission.
    //   - memoryManager / hippocampus: internal memory & personality stores
    //     keyed by explicit userId.
    //   - save_chat_message_audited (ASSISTANT turn only): the platform writes
    //     the assistant message on behalf of the run — the RPC's service_role
    //     branch exists precisely for this (non-service callers may only save
    //     p_role='user').
    // Anything whose SECURITY DEFINER body gates on auth.uid() must use
    // pgrestUser below instead.
    // ----------------------------------------
    const pgrestService = createServiceRpcAdapter();

    let user: { id: string } | null = null;
    let authError: Error | null = null;
    try {
      const verified = await _verifyToken(authHeader);
      // verifyToken maps the JWT sub onto `.userId` (local VerifiedUser has no
      // `.sub`); userId is the canonical aisha user id — threaded into
      // compose_context's p_requester_id for per-story RBAC, so it MUST be real.
      user = { id: verified.userId };
    } catch (err) {
      authError = err as Error;
    }

    if (authError || !user) {
      log.safeError('[ai-chat] Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    log.safeInfo('[ai-chat] User authenticated', { userId: userId.substring(0, 8) + '...' });

    // ----------------------------------------
    // USER-plane RPC client — every RPC whose SECURITY DEFINER body gates on
    // auth.uid() (conversation create/read, chat access level, user-message
    // save, story resolution, debug staff check) MUST run under the CALLER's
    // identity, not service_role. The verified Keycloak identity is re-minted
    // as a short-lived HS256 PostgREST token (RFC 8693 on-behalf-of — the same
    // mediation the Omni /v1 lane uses via mintMcpUserToken): the raw KC RS256
    // token is not PostgREST-compatible, and the service token has no `sub`,
    // so auth.uid() would be NULL (wrong tenancy + audit attribution).
    // FAIL-LOUD: if minting is impossible (JWT_SECRET unset) this 503s —
    // a user-scoped path never silently degrades to service_role.
    // ----------------------------------------
    let pgrestUser: PostgrestClient;
    try {
      pgrestUser = createUserScopedRpcAdapter(userId, 'chat-user-rpc');
    } catch (mintErr) {
      log.safeError(
        '[ai-chat] user-scoped token minting failed (fail-loud — refusing service_role substitution)',
        mintErr instanceof Error ? mintErr.message : String(mintErr),
      );
      return new Response(JSON.stringify({ error: 'Configuration error', code: 'USER_SCOPE_UNAVAILABLE' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ----------------------------------------
    // 1b. INIT TRACER (non-blocking — degrades if RPC fails)
    // ----------------------------------------
    tracer = await createTracer(pgrestService, {
      kind: 'chat',
      actorUserId: userId,
    });

    // ----------------------------------------
    // 2. VALIDATE REQUEST BODY
    // ----------------------------------------
    let body: ChatRequest;
    try {
      const rawBody = await req.json();
      body = validateRequest(rawBody);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid request';
      log.safeError('[ai-chat] Validation error:', msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const debugRequested = body.debug === true;
    if (debugRequested) {
      const { data: isAdminOrStaff, error: adminCheckError } = await pgrestUser.rpc('is_admin_or_staff', {
        p_user_id: userId,
      });

      if (adminCheckError) {
        log.safeError('[ai-chat] Admin/staff debug check failed', adminCheckError);
        return new Response(JSON.stringify({ error: 'Access check failed' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      debugEnabled = isAdminOrStaff === true;
      if (!debugEnabled) {
        log.safeWarn('[ai-chat] Debug requested by non-admin user');
      }
    }

    addDebug('request.validation', 'Request payload validated');
    if (debugEnabled) {
      addDebug('debug.mode', 'Admin debug mode enabled');
    }

    const language: string = body.language ?? 'en';
    let { message } = body;
    let conversation_id = body.conversation_id;
    const explicitStoryId = body.story_id;

    // ----------------------------------------
    // 3. LOAD LLM API KEYS + BACKEND AVAILABILITY
    // ----------------------------------------
    addDebug('llm.init', 'Loading LLM API keys and checking backend availability');
    const openaiApiKey = (await getOpenAiApiKey(pgrestService)) ?? process.env.OPENAI_API_KEY;
    const googleApiKey = process.env.GOOGLE_AI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const hasLocalLlmBackend = Boolean(
      process.env.DOCKER_MODEL_RUNNER_URL ||
      process.env.OLLAMA_URL ||
      process.env.VLLM_GENERATION_URL
    );

    // Primary check: use BackendRegistry for real health-aware availability
    const { getRegistry } = await import("@aisha/llm-dispatch");
    const registry = getRegistry();
    const hasAnyBackend = await registry.hasAnyAvailableBackend();

    // Fallback: env var presence check (graceful degradation if registry probe fails)
    const hasAnyProvider = hasAnyBackend || !!openaiApiKey || !!googleApiKey || !!anthropicApiKey || hasLocalLlmBackend;
    if (!hasAnyProvider) {
      log.safeError('[ai-chat] No LLM provider configured (cloud or local)', undefined);
      addDebug('llm.init', 'No LLM provider available (registry probed all backends)', 'error');
      return new Response(JSON.stringify(withDebug({ error: 'AI service not configured' })), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log detailed backend diagnostics when debug is enabled
    if (body.debug) {
      const diag = await registry.diagnostics();
      const available = diag.filter((d) => d.available);
      const unavailable = diag.filter((d) => !d.available);
      addDebug(
        'llm.init',
        `Backends: ${available.length} available [${available.map((d) => d.id).join(', ')}], ${unavailable.length} unavailable [${unavailable.map((d) => d.id).join(', ')}]`
      );
    } else {
      addDebug(
        'llm.init',
        `LLM providers loaded (OpenAI: ${!!openaiApiKey}, Google: ${!!googleApiKey}, Anthropic: ${!!anthropicApiKey}, Local: ${hasLocalLlmBackend}, Registry: ${hasAnyBackend})`
      );
    }

    // ----------------------------------------
    // 4. CHECK CHAT ACCESS VIA RPC
    // ----------------------------------------
    addDebug('access.check', 'Checking chat access permissions');
    const { data: accessData, error: accessError } = await pgrestUser.rpc('get_chat_access_level', {
      p_user_id: userId,
    });

    if (accessError) {
      log.safeError('[ai-chat] Access check error:', accessError.message);
      addDebug('access.check', 'Access check RPC failed', 'error');
      return new Response(JSON.stringify(withDebug({ error: 'Access check failed' })), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const access = accessData as ChatAccessResult;
    if (!access.can_chat) {
      log.safeWarn('[ai-chat] User denied access', { block_reason: access.block_reason });
      addDebug('access.check', `Chat access denied (${access.block_reason ?? 'unknown'})`, 'warn');
      return new Response(JSON.stringify(withDebug({
        error: 'Chat access denied',
        block_reason: access.block_reason,
      })), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    addDebug('access.check', `Chat access granted (${access.access_level})`);

    // ----------------------------------------
    // 5. GET GUARDRAILS CONFIG
    // ----------------------------------------
    const guardrails = getGuardrailsConfig(access.access_level as ChatAccessLevel);
    log.safeInfo('[ai-chat] User guardrails tier', { tier: getGuardrailsTierLabel(access.access_level as ChatAccessLevel) });
    addDebug('guardrails', `Using tier ${getGuardrailsTierLabel(access.access_level as ChatAccessLevel)}`);

    // ----------------------------------------
    // 6. INPUT GUARDRAILS: PII MASKING
    // ----------------------------------------
    if (guardrails.piiDetection.block === false) {
      message = maskPII(message);
      addDebug('input.masking', 'PII masking applied to user input');
    }
    log.safeInfo('[ai-chat] Processing message', { conversation_id: conversation_id || 'new' });
    addDebug('conversation.prepare', conversation_id ? 'Using existing conversation' : 'Creating a new conversation');

    // ----------------------------------------
    // 7. GET OR CREATE CONVERSATION VIA RPC
    // ----------------------------------------
    if (!conversation_id) {
      const { data: newConvData, error: convError } = await pgrestUser.rpc('create_chat_conversation_audited', {
        p_title: message.substring(0, 100),
      });

      if (convError) {
        log.safeError('[ai-chat] Error creating conversation:', convError.message);
        addDebug('conversation.create', 'Failed to create conversation', 'error');
        return new Response(JSON.stringify(withDebug({ error: 'Failed to create conversation' })), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      conversation_id = (newConvData as { conversation_id: string }).conversation_id;
      log.safeInfo('[ai-chat] Created new conversation', { conversation_id: conversation_id.substring(0, 8) + '...' });
      addDebug('conversation.create', 'Conversation created');
    }

    // ----------------------------------------
    // 8. FETCH CONVERSATION HISTORY
    // ----------------------------------------
    addDebug('history.fetch', 'Loading conversation history');
    const { data: historyData, error: historyError } = await pgrestUser.rpc('get_chat_messages_audited', {
      p_conversation_id: conversation_id,
    });

    if (historyError) {
      const status = historyError.message?.toLowerCase().includes('access denied') ? 403 : 500;
      log.safeError('[ai-chat] Error fetching history:', historyError.message);
      addDebug('history.fetch', status === 403 ? 'Access denied to conversation history' : 'Failed to load conversation history', 'error');
      return new Response(JSON.stringify(withDebug({ error: status === 403 ? 'Access denied to conversation' : 'Failed to load conversation history' })), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const conversationHistory: Message[] = (Array.isArray(historyData) ? historyData : []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }));
    addDebug('history.fetch', `Loaded ${conversationHistory.length} history messages`);

    // ----------------------------------------
    // 9. SAVE USER MESSAGE VIA RPC
    // ----------------------------------------
    const { error: userMsgError } = await pgrestUser.rpc('save_chat_message_audited', {
      p_content: message,
      p_conversation_id: conversation_id,
      p_role: 'user',
      p_user_id: userId,
    });

    if (userMsgError) {
      log.safeError('[ai-chat] Error saving user message:', userMsgError.message);
      addDebug('message.save.user', 'Failed to persist user message', 'warn');
    } else {
      addDebug('message.save.user', 'User message saved');
    }

    // ----------------------------------------
    // AISHA BRIDGE: Resolve story context for routing/composition.
    // Uses explicit story_id from request when provided, otherwise
    // resolves the best story for the current user via RPC.
    const resolvedStoryId = await resolveChatStoryId(pgrestUser, explicitStoryId);
    addDebug(
      'aisha.story',
      resolvedStoryId ? `Using story context ${resolvedStoryId.substring(0, 8)}...` : 'No story context resolved; context composition may be limited',
      resolvedStoryId ? 'info' : 'warn',
    );

    // AISHA BRIDGE: Route Task (non-blocking observability)
    // ----------------------------------------
    // Register this chat interaction with Aisha's orchestration layer.
    // Creates an ai_run for observability. Degradation-safe — skipped on failure.
    let aishaRoutePlan: RoutePlan | null = null;
    let aishaContextBundle: ContextBundle | null = null;

    // AISHA BRIDGE: Query intent and escalation signals (routing hints)
    const queryIntent = analyzeChatQueryIntent(message);
    addDebug(
      "aisha.query_intent",
      `Intent=${queryIntent.knowledgeIntent}, preferred_backend=${queryIntent.preferredBackend}, should_query_kb=${queryIntent.shouldQueryKb}`,
    );

    const escalationSignals = detectEscalationSignals(message);
    if (escalationSignals.length > 0) {
      addDebug('aisha.escalation', `Escalation signals detected: ${escalationSignals.join(', ')}`);
      log.safeInfo(`[ai-chat] Escalation signals: ${escalationSignals.join(', ')}`);
    }

    const routeRiskProfile: "low" | "medium" | "high" =
      escalationSignals.includes("incident")
      ? "high"
      : escalationSignals.length > 0
        ? "medium"
        : "low";

    try {
      addDebug('aisha.route', 'Registering interaction with Aisha orchestration');
      aishaRoutePlan = await routeViaAisha(pgrestService, {
        taskKind: 'chat',
        riskProfile: routeRiskProfile,
        storyId: resolvedStoryId ?? undefined,
        tech: ['postgrest', 'typescript'],
        constraints: {
          escalation_signals: escalationSignals,
          has_escalation_signals: escalationSignals.length > 0,
          knowledge_intent: queryIntent.knowledgeIntent,
          preferred_backend: queryIntent.preferredBackend,
          routing_reason: queryIntent.reason,
          should_query_kb: queryIntent.shouldQueryKb,
          task_category: queryIntent.taskCategory,
        },
      });
      if (aishaRoutePlan) {
        addDebug('aisha.route', `Aisha route plan created: run_id=${aishaRoutePlan.runId.substring(0, 8)}, agents=${aishaRoutePlan.agents.length}`);
        log.safeInfo(`[ai-chat] Aisha route plan: run_id=${aishaRoutePlan.runId.substring(0, 8)}`);
      }
    } catch {
      addDebug('aisha.route', 'Aisha route registration skipped (non-blocking)', 'warn');
    }

    // ----------------------------------------
    // LOAD CHANNEL CONFIGURATION
    // ----------------------------------------
    // Channel-centric architecture: channel config is the sole source of truth.
    const CHANNEL_SLUG = "ai-chat";
    addDebug('channel.load', `Loading channel config: ${CHANNEL_SLUG}`);
    const { data: channelData, error: channelError } = await pgrestService
      .rpc('get_active_channel_config', { p_channel_slug: CHANNEL_SLUG });

    if (channelError || !channelData || (typeof channelData === 'object' && channelData !== null && 'error' in channelData)) {
      log.safeError('[ai-chat] Error loading channel config:', channelError?.message || (channelData as Record<string, unknown>)?.error);
      addDebug('channel.load', 'Failed to load channel configuration', 'error');
      return new Response(JSON.stringify(withDebug({ error: 'Failed to load agent configurations' })), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channelConfig = typeof channelData === 'string' ? JSON.parse(channelData) : channelData;
    addDebug('channel.load', `Channel loaded: ${channelConfig.slug}, model: ${channelConfig.model}`);

    // ----------------------------------------
    // KANÁL Z FAKTŮ (guardrails.grounding) — model je jen jazyk, čísla hlídá server
    // ----------------------------------------
    // Fáze 4 „AI na CPU" (majitel 2026-09-29): fakta z bloku Asku POD UŽIVATELEM, jedno
    // volání modelu bez nástrojů, paměti, osobnosti a klasifikace (malý model na CPU
    // by jinak zpracovával tisíce tokenů kontextu a volal se dvakrát), hlídač čísel.
    // Popis a důvody: lib/groundedAnswer.ts. Kanál bez deklarace běží po staru níž.
    const grounding = groundingFromChannel(channelConfig.guardrails);
    if (grounding) {
      if (channelConfig.model) {
        throw new Error(`[grounding] kanál ${channelConfig.slug}: model vybírá resolver (rezidence dat) — model v kanálu nech prázdný`);
      }
      addDebug('grounding', `Kanál z faktů: blok ${grounding.factsBlock}, souběh ${grounding.maxConcurrent}`);
      let vysledek: Awaited<ReturnType<typeof odpovedZFaktu>>;
      try {
        vysledek = await odpovedZFaktu(grounding, {
          rpcUser: async (fn, args) => {
            const { data, error } = await pgrestUser.rpc(fn, args);
            return { data, error: error ? { message: error.message } : null };
          },
          llm: async (systemPrompt, otazka) => {
            // Model a provider z řádku resolveru; v režimu local jen on-prem (rezidence).
            const backend = await resolveDefaultBackend('ask.formulace_z_faktu', {
              localOnly: getExecutionMode() === 'local',
              needsTools: false,
            });
            await recordExecutionDecision(
              toExecutionDecision(
                { model: backend.model, provider: backend.provider, resolution_source: 'clow_backend' },
                { runtime: 'direct_llm', reason: `grounding:${grounding.factsBlock}` },
              ),
              tracer.runId,
            );
            const r = await unifiedChat({
              provider: backend.provider,
              model: backend.model,
              systemPrompt,
              messages: [{ role: 'user', content: otazka }],
              temperature: channelConfig.temperature,
              maxTokens: channelConfig.max_tokens,
            });
            return { text: r.text ?? '', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, model: r.model };
          },
        }, {
          question: message,
          scope: body.scope ?? null,
          systemPrompt: (channelConfig.system_prompt || '') + buildLanguageInstruction(language),
        });
      } catch (groundingError) {
        // Nemaskovat: klient (Ask) už ukazuje fakta a chybu označí jako výpadek řetězu.
        const errMsg = groundingError instanceof Error ? groundingError.message : String(groundingError);
        log.safeWarn('[ai-chat] Grounded answer failed', { error: errMsg });
        addDebug('grounding', `Selhalo: ${errMsg}`, 'error');
        await tracer.finish('failed', { error: errMsg, grounding: grounding.factsBlock });
        return new Response(JSON.stringify(withDebug({ error: 'Grounded answer unavailable', code: 'GROUNDED_UNAVAILABLE' })), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      addDebug('grounding', `Verdikt ${vysledek.grounding.verdict} (${vysledek.grounding.reason})${vysledek.grounding.cizi.length ? `, cizí: ${vysledek.grounding.cizi.join(', ')}` : ''}`);

      // Text modelu projde i výstupním strážcem AITG (injekce, toxicita) — fakta z DB ne.
      // Zásah strážce vrací FAKTA, ne odmítnutí: odmítnutí by uživateli vzalo i ověřenou
      // odpověď, která v pořádku je.
      let obsah = vysledek.content;
      let groundingVysledek = vysledek.grounding;
      if (groundingVysledek.verdict === 'model') {
        const strazce = await withAitgGuardOrRefuse(
          { runner: aitgRunner, buildSha: config.buildSha ?? 'dev', triggeredBy: 'self', enabled: ['AITG-APP-01', 'AITG-APP-12'], service: 'svc-ai-chat:chat-grounded' },
          async () => ({ text: obsah }),
          { text: vysledek.factsAnswer },
        );
        if (strazce.violated) {
          obsah = vysledek.factsAnswer;
          groundingVysledek = { ...groundingVysledek, verdict: 'fakta', reason: 'aitg_strazce' };
          log.safeWarn('[ai-chat] AITG output guard violation on grounded answer — facts returned', { tests: Object.keys(strazce.observations).join(', ') });
        }
      }
      obsah = applyGuardrailsToResponse(obsah, guardrails, language);
      const dobaMs = Date.now() - startTime;
      const metadataZFaktu = {
        grounding: groundingVysledek,
        response_time_ms: dobaMs,
        tokens_input: vysledek.usage.inputTokens,
        tokens_output: vysledek.usage.outputTokens,
        run_id: tracer.runId ?? null,
        language,
      };
      // Asistentský tah zapisuje platforma (servisní rovina, p_user_id) — stejně jako níž.
      const { data: ulozeno, error: chybaUlozeni } = await pgrestService.rpc('save_chat_message_audited', {
        p_content: obsah,
        p_content_metadata: metadataZFaktu,
        p_conversation_id: conversation_id,
        p_model_used: vysledek.model,
        p_response_time_ms: dobaMs,
        p_role: 'assistant',
        p_routed_to_agent_id: channelConfig.channel_id ?? null,
        p_routing_category: 'grounded',
        p_tokens_input: vysledek.usage.inputTokens,
        p_tokens_output: vysledek.usage.outputTokens,
        p_user_id: userId,
      });
      if (chybaUlozeni) {
        log.safeError('[ai-chat] Error saving grounded assistant message:', chybaUlozeni.message);
        addDebug('message.save.assistant', `Failed to save assistant message: ${chybaUlozeni.message}`, 'warn');
      }
      await tracer.finish('succeeded', { conversation_id, category: 'grounded', ...metadataZFaktu });
      return new Response(JSON.stringify(withDebug({
        conversation_id,
        message: {
          id: (ulozeno as { id: string } | null)?.id ?? crypto.randomUUID(),
          role: 'assistant',
          content: obsah,
          routing_category: 'grounded',
          created_at: new Date().toISOString(),
        },
        aisha_observing: false,
        metadata: {
          tokens_used: vysledek.usage.inputTokens + vysledek.usage.outputTokens,
          response_time_ms: dobaMs,
          access_level: access.access_level,
          run_id: tracer.runId,
          aisha_model_selected: vysledek.model,
          grounding: metadataZFaktu.grounding,
        },
      })), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Main agent — derived from channel's primary LLM configuration
    const mainAgent: AgentConfig = {
      id: channelConfig.channel_id ?? null,
      name: 'main_agent',
      instructions: channelConfig.system_prompt || '',
      model: channelConfig.model || (await resolveDefaultModel(message)),
      // Dynamic sampling temperature ("s jakou teplotou"): AISHA derives it from the answer mode it
      // detected (KB/document-grounded → low/faithful, small-talk → conversational) when the channel
      // did not pin one. Capability-derived from the intent, not a fixed 0.7.
      temperature: channelConfig.temperature ?? temperatureForTaskCategory(queryIntent.taskCategory),
      max_tokens: channelConfig.max_tokens ?? 3000,
      model_settings: channelConfig.model_settings,
    };

    // ----------------------------------------
    // LOAD TOOLS FROM CHANNEL's allowed_tools (Phase 2 — Tool System)
    // ----------------------------------------
    const toolExecutor = createToolExecutor(
      pgrestService,
      pgrestUser,
      userId,
      tracer,
      {
        accessLevel: access.access_level as ChatAccessLevel,
        // K-36: zákazy agentů trasy platí VŽDY (ne jen s DYNAMIC_TOOL_SELECTION) — executor je
        // nenabídne ani nespustí; a nespustí ani nic, co si kanál nevyžádal.
        deniedTools: aishaRoutePlan?.toolsDenylist ?? [],
      },
    );

    const channelToolNames: string[] = Array.isArray(channelConfig.allowed_tools) ? channelConfig.allowed_tools : [];
    // impl 01 (odysseus): narrow the channel catalog by AISHA's route-plan
    // allowlist (route_task already computes it). Result is always a subset of
    // channel rights; absent/empty/disjoint allowlist keeps today's behavior.
    const effectiveToolNames = applyRouteToolsAllowlist(
      channelToolNames,
      aishaRoutePlan?.toolsAllowlist,
      { enabled: isDynamicToolSelectionEnabled() },
    );
    if (effectiveToolNames.length !== channelToolNames.length) {
      addDebug('tools.select', `Route plan narrowed tools ${channelToolNames.length}→${effectiveToolNames.length}`);
      log.safeInfo('[ai-chat] Route-plan tool narrowing applied', {
        channel_tools: channelToolNames.length,
        effective_tools: effectiveToolNames.length,
      });
    }
    let agentToolSpecs: LlmToolSpec[] = [];
    try {
      const toolDefs = await toolExecutor.loadToolsByNames(effectiveToolNames);
      agentToolSpecs = toolExecutor.toOpenAIToolSpecs(toolDefs);
      if (agentToolSpecs.length > 0) {
        addDebug('tools.load', `Loaded ${agentToolSpecs.length} tools for channel`);
        log.safeInfo('[ai-chat] Loaded tools for channel', { tools: agentToolSpecs.map(t => t.function.name).join(', ') });
      }
    } catch (toolLoadError) {
      // Tool loading is non-blocking — agent works without tools
      const errMsg = toolLoadError instanceof Error ? toolLoadError.message : String(toolLoadError);
      log.safeWarn('[ai-chat] Tool loading failed (non-blocking)', { error: errMsg });
      addDebug('tools.load', `Tool loading failed: ${errMsg}`, 'warn');
    }

    // ----------------------------------------
    // LOAD MEMORY (Phase 4 — Session + Long-term)
    // ----------------------------------------
    let memoryManager: MemoryManager | null = null;
    let memoryContext = '';
    try {
      memoryManager = createMemoryManager(pgrestService, tracer, {
        conversationId: conversation_id,
        userId,
      });

      // Load both memory types in parallel
      const [sessionEntries, userEntries] = await Promise.all([
        memoryManager.loadSessionMemory(),
        memoryManager.loadUserMemory(),
      ]);

      memoryContext = memoryManager.buildMemoryContext();

      if (sessionEntries.length > 0 || userEntries.length > 0) {
        addDebug('memory.load', `Loaded ${sessionEntries.length} session + ${userEntries.length} user memory entries`);
        log.safeInfo(`[ai-chat] Memory loaded: ${sessionEntries.length} session, ${userEntries.length} user entries`);
      }
    } catch (memError) {
      // Memory loading is non-blocking — agent works without memory
      const errMsg = memError instanceof Error ? memError.message : String(memError);
      log.safeWarn('[ai-chat] Memory loading failed (non-blocking)', { error: errMsg });
      addDebug('memory.load', `Memory loading failed: ${errMsg}`, 'warn');
    }

    // ----------------------------------------
    // HIPPOCAMPUS: Personality Vector Space (non-blocking)
    // ----------------------------------------
    // Personality is a PRESET, not an output filter — injected into the system
    // prompt so the LLM naturally thinks and responds in AISHA's character.
    // Degradation-safe: agent works without personality context.
    let personalityPrompt = '';
    let personalityTraitsUsed: string[] = [];
    let hippocampus: Hippocampus | null = null;
    try {
      hippocampus = createHippocampus(pgrestService, tracer, {
        userId,
        conversationId: conversation_id,
      });

      const personalityContext: PersonalityContext = await hippocampus.resolvePersonality();
      personalityPrompt = hippocampus.buildPersonalityPrompt(personalityContext);
      personalityTraitsUsed = personalityContext.traits.map((t) => t.slug ?? t.trait_id);

      if (personalityContext.traits.length > 0) {
        addDebug('hippocampus', `Personality resolved: ${personalityContext.baseCount} base + ${personalityContext.experientialCount} experiential traits`);
        log.safeInfo(`[ai-chat] Hippocampus: ${personalityContext.traits.length} personality traits resolved`);
      }
    } catch (hippoError) {
      const errMsg = hippoError instanceof Error ? hippoError.message : String(hippoError);
      log.safeWarn('[ai-chat] Hippocampus loading failed (non-blocking)', { error: errMsg });
      addDebug('hippocampus', `Personality loading failed: ${errMsg}`, 'warn');
    }

    // ----------------------------------------
    // 10. LOAD WORKFLOW DEFINITION + EXECUTE ENGINE
    // ----------------------------------------
    // Phase 5: Dynamic workflow execution replaces the hardcoded
    // classify → specialist → main_agent → simplicity pipeline.
    // The graph is loaded from ai_workflow_definitions table.
    // Fallback: uses DEFAULT_CHAT_WORKFLOW if no active DB workflow.

    // AISHA BRIDGE: Context enrichment (Phase 0.3 — primary context source)
    // Independently calls compose_context() to build the context bundle.
    // NOT gated on route plan — context enrichment works even without routing.
    // Degradation-safe: falls back to inline prompt assembly on failure.
    if (resolvedStoryId) {
      try {
        // Token optimization: use lightweight context for greetings/smalltalk
        const queryIntent = analyzeChatQueryIntent(message);
        const contextProfile = queryIntent.shouldQueryKb ? 'chat_default' : 'chat_lightweight';
        addDebug('aisha.context', `Composing context via compose_context RPC (${contextProfile}, intent=${queryIntent.knowledgeIntent})`);

        // Single bound retrieval closure — used by both the initial pass and
        // the Step 5 critic loop's re-retrieval. Pinning client + storyId +
        // runId + conversationHistory here means the critic loop receives a
        // pure (profile, query) -> bundle function.
        const callRetrieval = (overrides: { profile: string; query: string }) =>
          enrichWithAishaContext(pgrestService, {
            storyId: resolvedStoryId,
            contextProfile: overrides.profile,
            runId: aishaRoutePlan?.runId ?? undefined,
            // User-initiated chat: enforce per-story RBAC inside compose_context.
            requesterId: userId,
            query: overrides.query,
            conversationHistory: conversationHistory.map((m) => ({ role: m.role, content: m.content })),
          });

        aishaContextBundle = await callRetrieval({ profile: contextProfile, query: message });
        if (aishaContextBundle && aishaContextBundle.tokensUsed > 0) {
          addDebug('aisha.context', `Context composed: ${aishaContextBundle.tokensUsed}/${aishaContextBundle.tokenBudget} tokens, ${Object.keys(aishaContextBundle.layers).length} layers`);
        } else {
          addDebug('aisha.context', 'Context bundle empty or unavailable, using inline fallback');
        }

        // Step 5: Critic loop wraps the initial retrieval. When context_profile
        // has critic_enabled=true (currently only evidence_strict), score the
        // bundle's faithfulness via LLM-as-judge and iteratively re-retrieve
        // with strategy variations until threshold met or iteration cap reached.
        // Disabled profiles fast-path: returns initialBundle untouched + 0 iter.
        // Capability-resolver rag.critic_judge picks the LLM provider; if no
        // backend available, critic loop silently skips (graceful degradation).
        // Terminal iterations propagate faithfulness to ai_runs via the
        // audited RPC (migration 20260519010000), so Step 2 FaithfulnessChip
        // reads it directly.
        try {
          const criticResult = await runCriticLoop({
            runId: tracer.runId ?? '',
            profileSlug: contextProfile,
            query: message,
            initialBundle: aishaContextBundle,
            initialProfile: contextProfile,
            addDebug,
            reretrieve: callRetrieval,
          });
          if (criticResult.iterations > 0) {
            addDebug(
              'aisha.critic',
              `Critic loop: ${criticResult.iterations} iter(s), decision=${criticResult.decision}, faithfulness=${criticResult.finalFaithfulness?.toFixed(3) ?? 'null'}`,
            );
            aishaContextBundle = criticResult.finalBundle;
          }
        } catch (criticErr) {
          addDebug(
            'aisha.critic',
            `Critic loop error (non-blocking): ${criticErr instanceof Error ? criticErr.message : String(criticErr)}`,
            'warn',
          );
        }
      } catch {
        addDebug('aisha.context', 'Context composition failed (non-blocking), using inline fallback', 'warn');
      }
    } else {
      addDebug('aisha.context', 'Skipping compose_context because no story_id was resolved', 'warn');
    }

    const restrictionPrompt = buildRestrictionPrompt(guardrails, language);
    const tierLabel = getGuardrailsTierLabel(access.access_level as ChatAccessLevel);
    // Cross-lingual expression: knowledge is language-agnostic, but the ANSWER must be in the
    // recipient's language. The language NAME is DERIVED from the locale (Intl — no hardcoded
    // cs/en map), so any language works (cs/en/ru/th/fr/de/…), and the model is told to render
    // source-language context naturally + idiomatically in the recipient's language.
    const languageInstruction = buildLanguageInstruction(language);
    const callerContext = `\n\n## CALLER CONTEXT\n- Access tier: ${tierLabel}\n- Access level: ${access.access_level}\n- Language: ${language}`;

    // Phase 0.3: compose_context as primary system prompt source
    // When context bundle has meaningful content, place it BEFORE agent instructions
    // so rules and KB context have higher priority. Fallback: inline assembly.
    //
    // HIPPOCAMPUS: Personality is the FIRST layer — it's a preset that shapes
    // how the LLM thinks and responds. Order: Personality → Context → Instructions
    // Personality is WHO AISHA is. Context is WHAT she knows. Instructions are HOW she works.
    // impl 03 (odysseus): enforce the budget compose_context already reports —
    // memory events + KB chunk tails trim first; ruleset/project_context always
    // survive. Flag-off / within-budget / unknown-budget → identity (parity).
    if (isAdaptiveContextBudgetEnabled() && aishaContextBundle) {
      const bundleTrim = trimContextBundleLayers(aishaContextBundle);
      if (bundleTrim.trimmed) {
        aishaContextBundle = bundleTrim.bundle;
        addDebug('aisha.context', `Bundle budget enforced: ${bundleTrim.actions.join('; ')}`);
        log.safeInfo('[ai-chat] Context bundle trimmed to budget', { actions: bundleTrim.actions });
      }
    }
    const aishaContextSection = buildContextPromptSection(aishaContextBundle);
    const composedContextAvailable = aishaContextBundle !== null && aishaContextBundle.tokensUsed > 0;

    const promptLayers: string[] = [];

    // Layer 0: Personality preset (who AISHA is for this user)
    if (personalityPrompt) {
      promptLayers.push(personalityPrompt);
    }

    // Layer 1: Composed context (rules, KB, story context)
    if (composedContextAvailable) {
      promptLayers.push(aishaContextSection);
    }

    // Layer 2: Agent instructions + caller context
    promptLayers.push(mainAgent.instructions + languageInstruction + callerContext);

    const systemPromptBase = promptLayers.join('\n\n');

    addDebug('workflow.load', 'Loading active workflow definition');
    const { graph: workflowGraph, workflowId, name: workflowName } = await loadWorkflow(pgrestService, 'chat');
    addDebug('workflow.load', `Using workflow '${workflowName}' (${Object.keys(workflowGraph.nodes).length} nodes)${workflowId ? ` [id=${workflowId.substring(0, 8)}]` : ''}`);

    // Link this run to the workflow definition (if from DB)
    if (workflowId) {
      try {
        await pgrestService.rpc('set_ai_run_workflow', {
          p_run_id: tracer.runId,
          p_workflow_definition_id: workflowId,
        });
      } catch {
        // Non-blocking
      }
    }

    const workflowCtx: WorkflowContext = {
      message,
      conversationHistory,
      language,
      systemPromptBase,
      restrictionPrompt,
      memoryContext,
      guardrails: guardrails as unknown as Record<string, unknown>,
      openaiApiKey,
      agentToolSpecs,
      toolExecutor,
      memoryManager,
    };

    let assistantContent: string;
    let category = 'Else';
    let specialistName = 'unknown';
    let provenanceSummary: { decisions: Array<{ decision: string; value: string; source: string; sourceId: string; override: boolean }>; violations: Array<{ decision: string; attempted: string; blocked_by: string; reason: string }> } | undefined;

    // AISHA BRIDGE: Convert route plan to workflow engine hints (Phase 0.4)
    // Degradation-safe — undefined if no route plan available.
    // forcedCategory: when route_task returns high-risk or incident routing,
    // bypass the LLM classify node to save latency and enforce routing.

    // ADAPTIVE MODEL SELECTION: Aisha resolves optimal model from ai_model_registry.
    // Discovers models via daily scan (OpenAI, Anthropic, Google, xAI),
    // evaluates via benchmarks, and selects best model per complexity tier.
    // Falls back to hardcoded defaults when registry is empty.
    const executionMode = getExecutionMode();
    addDebug('execution.mode', `AISHA_EXECUTION_MODE=${executionMode}`);
    log.safeInfo(`[ai-chat] Execution mode: ${executionMode}`);

    // §11 residency gate — classify data sensitivity BEFORE model selection so a
    // confidential verdict can force on-prem residency (clow.cloud_forbidden) before
    // any backend is chosen. The SAME verdict the warm evaluator consults (no fork).
    const dataSensitivity = detectDataSensitivity(
      [
        ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ],
      null,
    );
    addDebug(
      'residency.sensitivity',
      `${dataSensitivity.sensitivity} cloud=${dataSensitivity.canUseCloudApis} tables=[${dataSensitivity.tables.join(',')}]`,
    );
    if (dataSensitivity.sensitivity === 'confidential') {
      log.safeWarn(
        `[ai-chat] confidential data detected (${dataSensitivity.tables.join(',')}) — on-prem residency enforced (no cloud)`,
      );
    }
    // §11 DoD #5: audit the residency verdict (no-op unless confidential).
    auditResidencyVerdict(dataSensitivity, { userId, surface: 'chat' });

    const modelSelection: ModelSelectionResult = await selectOptimalModel(
      message,
      escalationSignals,
      aishaRoutePlan,
      conversationHistory,
      pgrestService,
    );
    // Admin-only model override for A/B evaluation testing
    const effectiveModel = (body.model_override && debugEnabled)
      ? body.model_override
      : modelSelection.model;
    const effectiveReason = (body.model_override && debugEnabled)
      ? `override:${body.model_override}`
      : modelSelection.reason;

    if (body.model_override && debugEnabled) {
      addDebug('aisha.model', `Model OVERRIDE by admin: ${body.model_override} (auto would be ${modelSelection.model}/${modelSelection.complexity})`);
      log.safeInfo(`[ai-chat] Model OVERRIDE: ${body.model_override}`);
    } else {
      addDebug('aisha.model', `Smart model selection: ${modelSelection.model} (${modelSelection.complexity}) — ${modelSelection.reason} [${modelSelection.source}]`);
      log.safeInfo(`[ai-chat] Model auto-selected: ${modelSelection.model} (complexity=${modelSelection.complexity})`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // impl 03 (odysseus): adaptive history budget + compaction.
    // Budget derives from the SELECTED model's registry window (ONE window
    // source — get_adaptive_model_tiers `windows`); unknown window → null
    // budget → today's behavior (impl/09 B-2). Above compact_threshold the
    // old turns are summarized via the governed chat.history_compaction
    // purpose; summarizer failure degrades to a plain oldest-first trim.
    // Admin model_override → parity (its window is not resolved).
    // ────────────────────────────────────────────────────────────────────────
    if (isAdaptiveContextBudgetEnabled() && !(body.model_override && debugEnabled)) {
      try {
        const aiRuntime = await getAiRuntimeConfig(pgrestService);
        const inputBudget = computeInputBudget({
          contextWindow: modelSelection.contextWindow,
          maxOutputTokens: modelSelection.maxOutputTokens ?? mainAgent.max_tokens,
          headroom: aiRuntime.contextBudgetHeadroom,
          hardMax: aiRuntime.contextBudgetHardMax,
        });
        if (inputBudget !== null) {
          const compaction = await compactHistoryIfNeeded({
            history: workflowCtx.conversationHistory,
            budgetTokens: inputBudget,
            cfg: {
              compactThreshold: aiRuntime.compactThreshold,
              compactKeepLastTurns: aiRuntime.compactKeepLastTurns,
              compactSummaryMaxTokens: aiRuntime.compactSummaryMaxTokens,
            },
            summarize: async (head, maxSummaryTokens) => {
              // Governed summarizer: model via aisha_resolve_clow_backend
              // (chat.history_compaction purpose) — nothing hardcoded.
              // ⛔ Provider z řádku resolveru, ne `resolveProvider(model)` z prefixu:
              // souhrnný model bez prefixu (lokální alias, model za gateway) šel k openai.
              const souhrnnyModel = await resolveDefaultBackend('chat.history_compaction', {
                maxCostUsd: 0.01,
                skipDeriveNeeds: true,
              });
              const result = await unifiedChat({
                provider: souhrnnyModel.provider,
                model: souhrnnyModel.model,
                systemPrompt:
                  'Summarize the following earlier conversation turns into a compact factual brief. ' +
                  'Preserve named entities, decisions, open questions and user preferences. No preamble.',
                messages: head.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                maxTokens: maxSummaryTokens,
                temperature: 0.2,
              });
              return result.text ?? '';
            },
          });
          if (compaction.compacted) {
            workflowCtx.conversationHistory = compaction.history;
            addDebug(
              'context.budget',
              `History ${compaction.fallback ? 'trimmed (summary fallback)' : 'compacted'}: ~${compaction.tokensBefore}→~${compaction.tokensAfter} tok (budget ${inputBudget})`,
            );
            log.safeInfo('[ai-chat] History compacted to input budget', {
              tokens_before: compaction.tokensBefore,
              tokens_after: compaction.tokensAfter,
              budget: inputBudget,
              fallback: compaction.fallback,
            });
          }
        }
      } catch (budgetErr) {
        // Budget enforcement is fail-open: it must never take the chat down.
        addDebug('context.budget', `Budget enforcement skipped (non-blocking): ${budgetErr instanceof Error ? budgetErr.message : String(budgetErr)}`, 'warn');
      }
    }

    // Phase B: Unified governance decision replaces ad-hoc RoutePlanHint construction.
    // Combines route plan, escalation signals, compliance requirements, and delivery
    // state into a single auditable decision matrix with provenance tracking.
    const governanceDecision: GovernanceDecision = resolveGovernanceDecision({
      routePlan: aishaRoutePlan,
      routePlanRiskProfile: routeRiskProfile,
      escalationSignals: escalationSignals as EscalationSignal[],
      deliveryState: null, // Phase B.2: wire delivery state from story context
      selectedModel: effectiveModel,
      modelSource: effectiveReason,
      isAdminOverride: Boolean(body.model_override && debugEnabled),
    });

    addDebug('governance.decision', `Risk=${governanceDecision.riskLevel}, compliance=${governanceDecision.requireCompliance}, approval=${governanceDecision.approval.required}, stops=${governanceDecision.stopConditions.filter(s => s.triggered).length}`);
    if (governanceDecision.approval.required) {
      addDebug('governance.approval', `Approval required: ${governanceDecision.approval.reason} [${governanceDecision.approval.source}]`);
    }

    // Convert governance decision to RoutePlanHint for backward compatibility
    // with the existing workflow engine (incremental adoption).
    const routePlanHint: RoutePlanHint | undefined = toRoutePlanHint(governanceDecision) as RoutePlanHint;

    // ────────────────────────────────────────────────────────────────────────
    // §6.1/§6.5 "ONE ENGINE" pre-dispatch gate — the SAME admission + complexity
    // routing the Omni /v1 ingress uses, applied to /chat too so neither surface
    // can bypass it. Runs BEFORE the synchronous engine.execute() below.
    // Both sub-steps FAIL-OPEN: an admission/routing error must never break chat
    // (the post-dispatch provider-error 402 below still backstops real spend).
    // ────────────────────────────────────────────────────────────────────────
    const routingTier = classifyMessageComplexity(message, escalationSignals as string[], conversationHistory);

    // (a) Admission (§6.1 / ledger #14): fn_admit_clow(p_clow, p_context) folds
    //     spend + runtime + capability + risk into one verdict. deny → 402
    //     (pre-dispatch, before any byte); ask → 202 pending approval; allow → proceed.
    //
    // DD-1: price the size-aware estimate from ai_model_registry via get_model_pricing()
    // (the canonical price-rate source) — NOT a synthetic app constant. Best-effort: an
    // unknown/unpriced channel model leaves the rates undefined → estimateSpendUsd returns
    // null → admission defers to the DB catalog/history (fn_authorize_task_spend COALESCE
    // seam), never a hardcoded rate.
    let modelInPriceM: number | undefined;
    let modelOutPriceM: number | undefined;
    try {
      const { data: pricingMap } = await pgrestService.rpc('get_model_pricing', {});
      const p = (pricingMap as Record<string, { input_per_m?: number; output_per_m?: number }> | null)?.[channelConfig.model];
      if (typeof p?.input_per_m === 'number') modelInPriceM = p.input_per_m;
      if (typeof p?.output_per_m === 'number') modelOutPriceM = p.output_per_m;
    } catch {
      /* pricing lookup is best-effort; undefined rates → DB catalog prices the estimate */
    }

    try {
      const { data: admitData } = await pgrestService.rpc('fn_admit_clow', {
        p_clow: {
          purpose: (message || 'chat').slice(0, 200),
          task_kind: 'chat',
          runtime: 'direct_llm',
          capability_tags: [],
          needs_tools: false,
        },
        p_context: {
          story_id: explicitStoryId ?? null,
          session_id: conversation_id ?? null,
          // GAP E + DD-1: size-aware estimate priced from ai_model_registry (null when the
          // model has no registry rate → the DB catalog prices it via the COALESCE seam).
          estimate_usd: estimateSpendUsd(message.length, channelConfig.max_tokens ?? 3000, modelInPriceM, modelOutPriceM),
        },
      });
      const verdict = (admitData as { decision?: string; reason?: string } | null) ?? null;
      if (verdict?.decision === 'deny') {
        addDebug('admission.deny', `fn_admit_clow denied: ${verdict.reason ?? 'admission_denied'}`, 'error');
        return new Response(JSON.stringify(withDebug({ error: 'spend_denied', reason: verdict.reason ?? 'admission_denied' })), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-AISHA-Run-ID': tracer.runId ?? '' },
        });
      }
      if (verdict?.decision === 'ask') {
        addDebug('admission.ask', `fn_admit_clow requires approval: ${verdict.reason ?? 'approval_required'}`);
        return new Response(JSON.stringify(withDebug({ error: 'approval_required', reason: verdict.reason ?? 'approval_required', status: 'pending' })), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-AISHA-Run-ID': tracer.runId ?? '' },
        });
      }
    } catch (admitErr) {
      // GAP D: fail-CLOSED — a governance-gate error must not bypass spend+risk admission.
      // Return a retryable 503 instead of silently dispatching ungoverned.
      log.safeError('[ai-chat] fn_admit_clow admission check failed (fail-closed)', { error: admitErr instanceof Error ? admitErr.message : String(admitErr) });
      return new Response(JSON.stringify(withDebug({ error: 'governance_unavailable', reason: 'admission check failed — refusing to dispatch ungoverned' })), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-AISHA-Run-ID': tracer.runId ?? '' },
      });
    }

    // (a.2) Per-user LLM daily quota (free-tier cost cap). Without this a free member
    //     can run unbounded AI spend — the admission gate above governs per-task risk,
    //     not a per-user daily budget. Consume a PRE-call token+cost estimate from the
    //     caller's daily quota (fn_check_and_consume_llm_quota_audited, called on the
    //     user-scoped client so auth.uid() = the caller). Admin/staff (desk/operators)
    //     are exempt so the "human within 4h" promise can't be throttled. Fail-OPEN on
    //     any RPC/infra error — a quota-system hiccup must not brick chat — but honor an
    //     explicit deny with 429 + reset time (mirrors the reflection-lane budget meter).
    let quotaExemptStaff = false;
    try {
      const { data: staffData } = await pgrestUser.rpc('is_admin_or_staff', { p_user_id: userId });
      quotaExemptStaff = staffData === true;
    } catch {
      /* best-effort: on error treat as non-staff so the quota still applies (safe for cost) */
    }
    if (!quotaExemptStaff) {
      try {
        const estTokens = Math.ceil(message.length / 4) + (channelConfig.max_tokens ?? 3000);
        const estCost = estimateSpendUsd(message.length, channelConfig.max_tokens ?? 3000, modelInPriceM, modelOutPriceM) ?? 0;
        const { data: quotaData, error: quotaErr } = await pgrestUser.rpc('fn_check_and_consume_llm_quota_audited', {
          // Alphabetical param order (RPC convention / alphabetical-params gate).
          p_cost: estCost,
          p_tokens: estTokens,
          p_user_id: userId,
        });
        if (quotaErr) {
          log.safeWarn('[ai-chat] llm quota check errored (fail-open)', { error: quotaErr.message });
        } else {
          const q = (quotaData as { allowed?: boolean; reason?: string; reset_at?: string } | null) ?? null;
          if (q && q.allowed === false) {
            addDebug('quota.deny', `llm quota exceeded: ${q.reason ?? 'quota_exceeded'}`, 'error');
            return new Response(JSON.stringify(withDebug({ error: 'quota_exceeded', reason: q.reason ?? 'quota_exceeded', reset_at: q.reset_at ?? null })), {
              status: 429,
              headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-AISHA-Run-ID': tracer.runId ?? '' },
            });
          }
        }
      } catch (quotaCatchErr) {
        log.safeWarn('[ai-chat] llm quota check threw (fail-open)', { error: quotaCatchErr instanceof Error ? quotaCatchErr.message : String(quotaCatchErr) });
      }
    }

    // (b) Mandatory complexity routing (§6.5): complex/deep_analysis tiers consult
    //     the execution strategy; when a reflection graph is picked, kick off the
    //     async (tier3+) lane → 202 + X-Stream-Poll-URL=/reflect/runs/{id}. Simple/
    //     moderate chat (and any tier where no graph is selected) falls through to
    //     the synchronous engine below UNCHANGED (kickOff returns null → no 202).
    if (routingTier === 'complex' || routingTier === 'deep_analysis') {
      try {
        const strategy = await chooseExecutionStrategy(
          { description: message, type: 'chat', story_id: explicitStoryId ?? null, agent_slug: 'aisha' },
          { session_id: conversation_id ?? null },
        );
        const asyncRunId = await kickOffReflectionWorkflow(strategy, { description: message, agent_slug: 'aisha' }, explicitStoryId ?? null);
        if (asyncRunId) {
          addDebug('routing.async', `tier=${routingTier} → async lane, run=${asyncRunId}`);
          return new Response(JSON.stringify(withDebug({ accepted: true, run_id: asyncRunId, status: 'pending' })), {
            status: 202,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'X-Stream-Poll-URL': `/reflect/runs/${asyncRunId}`,
              'X-AISHA-Run-ID': asyncRunId,
            },
          });
        }
        // No reflection graph selected → fall through to the synchronous engine.
      } catch (routeErr) {
        log.safeWarn('[ai-chat] complexity routing failed (fail-open to sync)', { error: routeErr instanceof Error ? routeErr.message : String(routeErr) });
      }
    }

    try {
      log.safeInfo(`[ai-chat] Executing workflow '${workflowName}' (${Object.keys(workflowGraph.nodes).length} nodes)`);
      addDebug('workflow.exec', `Starting workflow engine execution`);

      const engine = createWorkflowEngine({
        pgrestService,
        tracer,
        agents: [mainAgent],
        runId: tracer.runId,
        addDebug,
        routePlanHint,
      });

      const result = await engine.execute(workflowGraph, workflowCtx);

      assistantContent = result.content;
      category = result.category;
      specialistName = result.specialistUsed;
      totalTokensInput += result.totalTokensInput;
      totalTokensOutput += result.totalTokensOutput;
      toolIterationsUsed = result.toolIterationsUsed;

      log.safeInfo(`[ai-chat] Workflow completed: ${result.nodesExecuted} nodes, category=${category}, specialist=${specialistName}, tools=${toolIterationsUsed}`);
      addDebug('workflow.exec', `Workflow completed: ${result.nodesExecuted} nodes, critic_revised=${result.criticRevised}`);

      // Phase A: Log provenance summary and preflight warnings
      if (result.provenanceSummary) {
        const { decisions: pDecisions, violations: pViolations } = result.provenanceSummary;
        if (pDecisions.length > 0) {
          addDebug('workflow.provenance', `${pDecisions.length} decision(s) recorded, ${pViolations.length} violation(s)`);
        }
        if (pViolations.length > 0) {
          log.safeWarn(`[ai-chat] Decision provenance violations: ${pViolations.map(v => v.decision).join(', ')}`);
        }
      }
      if (result.preflightWarnings && result.preflightWarnings.length > 0) {
        addDebug('workflow.preflight', `${result.preflightWarnings.length} preflight warning(s)`, 'warn');
      }
      provenanceSummary = result.provenanceSummary;

      // Phase 5: Log cost summary
      if (result.costSummary && result.costSummary.totalCalls > 0) {
        const cs = result.costSummary;
        addDebug('workflow.cost', `$${cs.totalCostUsd.toFixed(6)} | ${cs.totalCalls} calls | ${cs.totalInputTokens}in/${cs.totalOutputTokens}out | models: ${cs.byModel.map(m => m.model).join(', ')}`);
      }

      if (!assistantContent) {
        log.safeError('[ai-chat] Workflow returned empty content', undefined);
        addDebug('workflow.exec', 'Workflow returned empty content, using fallback', 'error');
        assistantContent = language === 'cs'
          ? 'Omlouváme se, nepodařilo se vygenerovat odpověď. Zkuste to prosím znovu.'
          : 'Sorry, we could not generate a response. Please try again.';
      }
    } catch (error: unknown) {
      log.safeError('[ai-chat] Workflow execution failed:', error);
      addDebug('workflow.exec', 'Workflow execution failed', 'error');

      // Handle specific LLM API errors (OpenAI APIError has .status, llmRouter wraps others)
      if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as { status: number; message?: string; code?: string };

        if (apiError.status === 429) {
          addDebug('ai.final', 'LLM rate limit hit', 'error');
          return new Response(JSON.stringify(withDebug({
            error: 'Rate limit exceeded. Please try again in a moment.',
            code: 'RATE_LIMIT',
          })), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (apiError.status === 402) {
          addDebug('ai.final', 'LLM credits exhausted', 'error');
          return new Response(JSON.stringify(withDebug({
            error: 'AI service credits exhausted. Please contact support.',
            code: 'CREDITS_EXHAUSTED',
          })), {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (apiError.status === 401) {
          log.safeError('[ai-chat] LLM authentication failed', undefined);
          addDebug('ai.final', 'LLM authentication failed', 'error');
          return new Response(JSON.stringify(withDebug({
            error: 'AI service configuration error.',
            code: 'AI_AUTH_ERROR',
          })), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (apiError.status === 400) {
          log.safeError('[ai-chat] LLM bad request:', apiError.message);
          addDebug('ai.final', `LLM rejected request: ${apiError.message ?? 'bad request'}`, 'error');
          return new Response(JSON.stringify(withDebug({
            error: 'Invalid AI request. Please try rephrasing your message.',
            code: 'AI_BAD_REQUEST',
          })), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (apiError.status === 500 || apiError.status === 502 || apiError.status === 503) {
          addDebug('ai.final', `LLM service unavailable (${apiError.status})`, 'error');
          return new Response(JSON.stringify(withDebug({
            error: 'AI service is temporarily unavailable. Please try again later.',
            code: 'AI_SERVICE_UNAVAILABLE',
          })), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Handle OpenAI timeout errors + llmRouter error strings
      if (error instanceof Error && (error.message?.includes('timeout') || error.message?.includes('API error'))) {
        addDebug('ai.final', 'LLM request timed out or failed', 'error');
        return new Response(JSON.stringify(withDebug({
          error: 'AI response timed out. Please try again.',
          code: 'AI_TIMEOUT',
        })), {
          status: 504,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      throw error;
    }

    // ----------------------------------------
    // 12b. AITG OUTPUT GUARD (OWASP AITG-APP-01 injection bleed-through,
    //      AITG-APP-12 toxic output)
    // ----------------------------------------
    // Same withAitgGuardOrRefuse the public-chat n8n path runs, now covering the
    // authenticated surface too: classify the model output BEFORE it leaves the
    // service, record the verdict in aitg_runs (fail-soft transport), and replace
    // a violating response with a safe refusal. Runs ahead of the tier guardrails
    // below so a refusal is tier-filtered/formatted like any assistant message.
    let aitgBlocked = false;
    const aitgGuarded = await withAitgGuardOrRefuse(
      {
        runner: aitgRunner,
        buildSha: config.buildSha ?? 'dev',
        triggeredBy: 'self',
        enabled: ['AITG-APP-01', 'AITG-APP-12'],
        service: 'svc-ai-chat:chat',
      },
      async () => ({ text: assistantContent }),
      {
        text: language === 'cs'
          ? 'S touto žádostí bohužel nemohu pomoci.'
          : 'I cannot help with that request.',
      },
    );
    if (aitgGuarded.violated) {
      aitgBlocked = true;
      assistantContent = aitgGuarded.result.text;
      const failedTests = Object.keys(aitgGuarded.observations).join(', ');
      addDebug('aitg.guard', `AITG output guard violation (${failedTests}) — response replaced with refusal`, 'warn');
      log.safeWarn('[ai-chat] AITG output guard violation — refusal substituted', { tests: failedTests });
    }

    // ----------------------------------------
    // 13. OUTPUT GUARDRAILS: APPLY RESTRICTIONS
    // ----------------------------------------
    assistantContent = applyGuardrailsToResponse(assistantContent, guardrails, language);
    addDebug('guardrails.output', 'Output guardrails applied');

    const responseTime = Date.now() - startTime;
    log.safeInfo('[ai-chat] Response generated', { tokens: totalTokensInput + totalTokensOutput, timeMs: responseTime });
    addDebug('response.metrics', `Tokens=${totalTokensInput + totalTokensOutput}, time=${responseTime}ms`);

    // ----------------------------------------
    // 14. SAVE ASSISTANT MESSAGE VIA RPC
    // ----------------------------------------
    // Build enriched metadata for Aisha Realtime observation
    const aishaParticipation: AishaParticipationResult = shouldAishaRespond(message, escalationSignals, {
      routePlan: aishaRoutePlan,
      conversationTurnCount: conversationHistory.length,
    });

    const kbChunks = aishaContextBundle?.layers?.kb_retrieval
      ? ((aishaContextBundle.layers.kb_retrieval as Record<string, unknown>)?.chunks ?? []) as Array<Record<string, unknown>>
      : [];
    const ruleChunks = aishaContextBundle?.layers?.ruleset
      ? (((aishaContextBundle.layers.ruleset as Record<string, unknown>)?.rules ?? []) as Array<Record<string, unknown>>)
      : [];

    const contentMetadata: AishaContentMetadata = buildAishaContentMetadata({
      category,
      escalationSignals,
      participation: aishaParticipation,
      modelSelection,
      routePlan: aishaRoutePlan,
      // Step 2 systemic follow-up: persist tracer.runId in content_metadata
      // so chat_messages history surfaces ai_run_id for FaithfulnessChip +
      // CitationPanel (via get_chat_messages_audited migration 20260519000000).
      runId: tracer.runId ?? null,
      language,
      specialistUsed: specialistName,
      toolIterations: toolIterationsUsed,
      responseTimeMs: responseTime,
      tokensInput: totalTokensInput,
      tokensOutput: totalTokensOutput,
      kbChunks: kbChunks.slice(0, 10),
      rules: ruleChunks.slice(0, 20),
      debugEvents: debugEvents.slice(-15).map((e) => ({ stage: e.stage, message: e.message })),
      systemPromptHint: systemPromptBase.substring(0, 500),
    });

    // Hippocampus: attach personality traits used in this turn for observability
    if (personalityTraitsUsed.length > 0) {
      (contentMetadata as Record<string, unknown>).personality_traits_used = personalityTraitsUsed;
    }

    if (aishaParticipation.shouldRespond) {
      addDebug('aisha.metadata', `Aisha participation hint: reason=${aishaParticipation.reason}, proactive=${aishaParticipation.proactive}`);
    }

    // SERVICE-plane on purpose: the ASSISTANT turn is written by the platform on
    // behalf of the run (explicit p_user_id attribution). save_chat_message_audited's
    // service_role branch exists exactly for this — a user-scoped caller may only
    // save p_role='user' (the RPC raises otherwise), so this call cannot move to
    // pgrestUser without changing the RPC contract.
    const { data: assistantMsgData, error: assistantMsgError } = await pgrestService.rpc('save_chat_message_audited', {
      p_content: assistantContent,
      p_content_metadata: contentMetadata,
      p_conversation_id: conversation_id,
      p_model_used: effectiveModel,
      p_response_time_ms: responseTime,
      p_role: 'assistant',
      p_routed_to_agent_id: mainAgent.id,
      p_routing_category: category,
      p_tokens_input: totalTokensInput,
      p_tokens_output: totalTokensOutput,
      p_user_id: userId,
    });

    if (assistantMsgError) {
      log.safeError('[ai-chat] Error saving assistant message:', assistantMsgError.message);
      addDebug('message.save.assistant', `Failed to save assistant message: ${assistantMsgError.message}`, 'warn');
    } else {
      addDebug('message.save.assistant', 'Assistant message saved');
    }

    const messageId = (assistantMsgData as { id: string })?.id ?? crypto.randomUUID();

    // ----------------------------------------
    // 14c. SAVE SESSION MEMORY (topic + category for future turns)
    // ----------------------------------------
    if (memoryManager) {
      try {
        await memoryManager.setSessionKey('last_interaction', {
          category,
          specialist: specialistName,
          message_preview: message.substring(0, 100),
          response_length: assistantContent.length,
          had_tools: toolIterationsUsed > 0,
          timestamp: new Date().toISOString(),
        });
        addDebug('memory.save', 'Session memory updated with interaction context');
      } catch {
        // Non-blocking
        addDebug('memory.save', 'Session memory save skipped', 'warn');
      }
    }

    // ----------------------------------------
    // 14d. HIPPOCAMPUS: Capture behavioral signals (fire-and-forget)
    // ----------------------------------------
    // Per-user behavioral signals for personality evolution.
    // The mirror adapts: these signals feed the daily evolution cron.
    if (hippocampus) {
      // Detect behavioral signals from this interaction
      const signalList: string[] = escalationSignals as string[];
      if (signalList.includes('frustration') || signalList.includes('complaint')) {
        hippocampus.captureSignal('frustration', { message_preview: message.substring(0, 80) }, 0.7);
      }
      if (signalList.includes('gratitude') || /děkuj|díky|thank|super|skvěl/i.test(message)) {
        hippocampus.captureSignal('gratitude', {}, 0.6);
      }
      if (/kurva|prdel|hovno|fuck|shit|damn|sakra|do prdele/i.test(message)) {
        hippocampus.captureSignal('vulgarity', { message_preview: message.substring(0, 80) }, 0.8);
      }
      if (conversationHistory.length >= 6) {
        hippocampus.captureSignal('engagement_burst', { turn_count: conversationHistory.length }, 0.5);
      }
      if (/proč|jak to|vysvětli|explain|why|how/i.test(message)) {
        hippocampus.captureSignal('curiosity', {}, 0.4);
      }
      addDebug('hippocampus.signals', 'Behavioral signals captured (fire-and-forget)');
    }

    // ----------------------------------------
    // 14b. ASYNC EVALUATION (fire-and-forget, VZORKOVANĚ)
    // ----------------------------------------
    // LLM-as-judge nad uloženou odpovědí — v procesu, bez sítě (SELF_IMPROVEMENT_LOOP.md K-17).
    // Dřív HTTP volání na `${AISHA_POSTGREST_URL}/functions/v1/evaluate-ai-response`: ta
    // proměnná v compose svc-ai-chat není, takže URL bylo `undefined/…` a hodnocení nikdy nic
    // neoslovilo. Vzorek řídí přepínač instance CHAT_EVAL_SAMPLE_RATE (rozhodnutí majitele D8);
    // neznámá hodnota = 0 = nehodnotí se nic. Jen skutečně uložená odpověď (jinak by se
    // hodnotilo náhodné UUID). Nikdy neblokuje odpověď uživateli.
    if (assistantMsgData && shouldSampleEval(config.chatEvalSampleRate)) {
      void (async () => {
        const backend = await resolveDefaultBackend('evaluation');
        const outcome = await evaluateChatMessage(messageId, backend);
        if (outcome.kind !== 'ok') {
          log.safeError('[ai-chat] Sampled evaluation did not complete:', outcome.kind);
        }
      })().catch((evalErr) => {
        log.safeError('[ai-chat] Sampled evaluation failed:', evalErr instanceof Error ? evalErr.message : evalErr);
      });
      addDebug('eval.trigger', 'Sampled evaluation started');
    }

    // ----------------------------------------
    // 15. RETURN RESPONSE
    // ----------------------------------------
    addDebug('response.ready', 'Returning response payload');

    // ----------------------------------------
    // 15a. AISHA: Metadata already saved — Realtime does the rest
    // ----------------------------------------
    // Aisha observes chat_messages via Postgres Realtime WebSocket.
    // The enriched content_metadata (saved with assistant message above)
    // contains everything she needs: escalation signals, participation hint,
    // category, KB context, debug events, and system prompt hint.
    // She decides autonomously when to intervene via aisha-callback.
    if (aishaParticipation.shouldRespond) {
      log.safeInfo(`[ai-chat] Aisha participation hint stored: reason=${aishaParticipation.reason}, proactive=${aishaParticipation.proactive}`);
      addDebug('aisha.realtime', `Hint stored in content_metadata — Aisha observing via Realtime`);
    }
    if (escalationSignals.length > 0) {
      addDebug('aisha.escalation', `Escalation signals in metadata: ${escalationSignals.join(', ')}`);
    }

    // Finalize the trace run
    await tracer.finish('succeeded', {
      conversation_id,
      category,
      specialist_used: specialistName,
      access_level: access.access_level,
      response_time_ms: responseTime,
      tools_available: agentToolSpecs.length,
      tool_iterations: toolIterationsUsed,
      workflow_name: workflowName,
      workflow_id: workflowId,
      memory_session_keys: memoryManager ? Object.keys(memoryManager.getSessionSnapshot()).length : 0,
      memory_context_injected: memoryContext.length > 0,
      aisha_run_id: aishaRoutePlan?.runId ?? null,
      aisha_context_tokens: aishaContextBundle?.tokensUsed ?? 0,
      aisha_escalation_signals: escalationSignals,
      aisha_participation_hint: aishaParticipation.shouldRespond,
      provenance_decisions: provenanceSummary?.decisions.length ?? 0,
      provenance_violations: provenanceSummary?.violations.length ?? 0,
      provenance_summary: provenanceSummary ?? null,
      governance_risk_level: governanceDecision.riskLevel,
      governance_compliance_required: governanceDecision.requireCompliance,
      governance_approval_required: governanceDecision.approval.required,
      governance_stop_conditions_triggered: governanceDecision.stopConditions.filter(s => s.triggered).length,
      aitg_blocked: aitgBlocked,
    });

    return new Response(JSON.stringify(withDebug({
      conversation_id,
      message: {
        id: messageId,
        role: 'assistant',
        content: assistantContent,
        routing_category: category,
        created_at: new Date().toISOString(),
      },
      aisha_observing: true,
      metadata: {
        tokens_used: totalTokensInput + totalTokensOutput,
        response_time_ms: responseTime,
        specialist_used: specialistName,
        access_level: access.access_level,
        agent_name: mainAgent.name,
        run_id: tracer.runId,
        tools_available: agentToolSpecs.length,
        tool_iterations: toolIterationsUsed,
        workflow_name: workflowName,
        workflow_id: workflowId,
        aisha_run_id: aishaRoutePlan?.runId ?? null,
        aisha_model_selected: effectiveModel,
        aisha_model_complexity: modelSelection.complexity,
        aisha_model_reason: effectiveReason,
        aisha_participation_hint: aishaParticipation.shouldRespond,
        kb_chunk_slugs: contentMetadata.kb_chunk_slugs ?? [],
        rule_slugs: contentMetadata.rule_slugs ?? [],
        aitg_blocked: aitgBlocked,
      },
    })), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log.safeError('[ai-chat] Unhandled error:', error);
    addDebug('handler', 'Unhandled error in ai-chat', 'error');
    await tracer.finish('failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify(withDebug({
      error: 'An unexpected error occurred',
    })), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ============================================
// FASTIFY ROUTE BINDING
// ============================================
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken as _verifyToken, AuthError as _AuthError } from '../auth.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// Re-export shim so existing calls inside handler resolve
// (archive code uses pgrestService.auth.getUser; we patch it below).
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const webReq = new Request('http://local/chat', {
      method: 'POST',
      headers: {
        Authorization: req.headers.authorization ?? '',
        'Content-Type': 'application/json',
        Origin: typeof req.headers.origin === 'string' ? req.headers.origin : '',
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const webResp = await handleChatRequest(webReq);
    reply.code(webResp.status);
    webResp.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'content-length') reply.header(k, v);
    });
    const text = await webResp.text();
    if (!text) return reply.send();
    try {
      return reply.send(JSON.parse(text));
    } catch {
      return reply.send(text);
    }
  });
}
// Suppress unused-import lint (kept for future inline auth wiring)
void _verifyToken;
void _AuthError;
