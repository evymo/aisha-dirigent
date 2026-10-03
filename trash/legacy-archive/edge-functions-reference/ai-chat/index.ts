import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve, createClient } from "../_shared/deps.ts";
import {
  getGuardrailsConfig,
  applyGuardrailsToResponse,
  buildRestrictionPrompt,
  maskPII,
  getGuardrailsTierLabel,
  type ChatAccessLevel,
} from "../_shared/guardrails-config.ts";

import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { preflightResponse, silentCorsDenyResponse, buildCorsHeaders } from "../_shared/cors.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";
import { getDefaultModel } from "../_shared/defaultModel.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import { createTracer, createNoopTracer, type Tracer } from "../_shared/tracer.ts";
import { type LlmToolSpec } from "../_shared/llmRouter.ts";
import { createToolExecutor } from "../_shared/toolExecutor.ts";
import { createMemoryManager, type MemoryManager } from "../_shared/memoryManager.ts";
import { createHippocampus, type Hippocampus, type PersonalityContext } from "../_shared/hippocampus.ts";
import { createWorkflowEngine, loadWorkflow, DEFAULT_CHAT_WORKFLOW, type WorkflowContext, type RoutePlanHint } from "../_shared/workflowEngine.ts";
import {
  routeViaAisha,
  enrichWithAishaContext,
  analyzeChatQueryIntent,
  buildContextPromptSection,
  detectEscalationSignals,
  shouldAishaRespond,
  buildAishaContentMetadata,
  selectOptimalModel,
  type RoutePlan,
  type ContextBundle,
  type AishaParticipationResult,
  type AishaContentMetadata,
  type ModelSelectionResult,
} from "../_shared/orchestrationBridge.ts";
import {
  resolveGovernanceDecision,
  toRoutePlanHint,
  type GovernanceDecision,
  type EscalationSignal,
} from "../_shared/governedOrchestration.ts";
import { getExecutionMode } from "../_shared/executionMode.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

// ============================================
// TYPES
// ============================================
interface ChatRequest {
  conversation_id?: string;
  message: string;
  language?: 'cs' | 'en';
  debug?: boolean;
  story_id?: string;
  /** Admin-only: override model selection for A/B testing (e.g. "local-llama3.2", "claude-sonnet-4") */
  model_override?: string;
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

  if (obj.language !== undefined && !['cs', 'en'].includes(obj.language as string)) {
    throw new Error('language must be "cs" or "en"');
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

  return {
    conversation_id: obj.conversation_id as string | undefined,
    message: obj.message as string,
    language: (obj.language as 'cs' | 'en') || 'cs',
    debug: obj.debug as boolean | undefined,
    story_id: obj.story_id as string | undefined,
    model_override: obj.model_override as string | undefined,
  };
}

async function resolveChatStoryId(
  supabaseUser: ReturnType<typeof createClient>,
  fallbackStoryId?: string,
): Promise<string | null> {
  if (fallbackStoryId && fallbackStoryId.trim().length > 0) {
    return fallbackStoryId.trim();
  }

  const { data, error } = await supabaseUser.rpc('get_chat_context_story_id', {});
  if (error) {
    console.warn('[ai-chat] get_chat_context_story_id failed (non-blocking):', error.message);
    return null;
  }

  if (typeof data === 'string' && data.length > 0) {
    return data;
  }

  return null;
}

// ============================================
// MAIN HANDLER
// ============================================
serve(async (req) => {
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
      console.error('[ai-chat] No authorization header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseAnonKey) {
      console.error('[ai-chat] Missing SUPABASE_ANON_KEY');
      return new Response(JSON.stringify({ error: 'Configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseService.auth.getUser(token);

    if (authError || !user) {
      console.error('[ai-chat] Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    console.log('[ai-chat] User authenticated:', userId.substring(0, 8) + '...');

    // ----------------------------------------
    // 1b. INIT TRACER (non-blocking — degrades if RPC fails)
    // ----------------------------------------
    tracer = await createTracer(supabaseService, {
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
      console.error('[ai-chat] Validation error:', msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const debugRequested = body.debug === true;
    if (debugRequested) {
      const { data: isAdminOrStaff, error: adminCheckError } = await supabaseUser.rpc('is_admin_or_staff', {
        p_user_id: userId,
      });

      if (adminCheckError) {
        console.error('[ai-chat] Admin/staff debug check failed');
        return new Response(JSON.stringify({ error: 'Access check failed' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      debugEnabled = isAdminOrStaff === true;
      if (!debugEnabled) {
        console.warn('[ai-chat] Debug requested by non-admin user');
      }
    }

    addDebug('request.validation', 'Request payload validated');
    if (debugEnabled) {
      addDebug('debug.mode', 'Admin debug mode enabled');
    }

    const { language } = body;
    let { message } = body;
    let conversation_id = body.conversation_id;
    const explicitStoryId = body.story_id;

    // ----------------------------------------
    // 3. LOAD LLM API KEYS + BACKEND AVAILABILITY
    // ----------------------------------------
    addDebug('llm.init', 'Loading LLM API keys and checking backend availability');
    const openaiApiKey = (await getOpenAiApiKey(supabaseService)) ?? Deno.env.get('OPENAI_API_KEY');
    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const hasLocalLlmBackend = Boolean(
      Deno.env.get('DOCKER_MODEL_RUNNER_URL') ||
      Deno.env.get('OLLAMA_URL') ||
      Deno.env.get('VLLM_GENERATION_URL')
    );

    // Primary check: use BackendRegistry for real health-aware availability
    const { getRegistry } = await import("../_shared/backendRegistry.ts");
    const registry = getRegistry();
    const hasAnyBackend = await registry.hasAnyAvailableBackend();

    // Fallback: env var presence check (graceful degradation if registry probe fails)
    const hasAnyProvider = hasAnyBackend || !!openaiApiKey || !!googleApiKey || !!anthropicApiKey || hasLocalLlmBackend;
    if (!hasAnyProvider) {
      console.error('[ai-chat] No LLM provider configured (cloud or local)');
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
    const { data: accessData, error: accessError } = await supabaseUser.rpc('get_chat_access_level', {
      p_user_id: userId,
    });

    if (accessError) {
      console.error('[ai-chat] Access check error:', accessError.message);
      addDebug('access.check', 'Access check RPC failed', 'error');
      return new Response(JSON.stringify(withDebug({ error: 'Access check failed' })), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const access = accessData as ChatAccessResult;
    if (!access.can_chat) {
      console.warn('[ai-chat] User denied access:', access.block_reason);
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
    console.log('[ai-chat] User guardrails tier:', getGuardrailsTierLabel(access.access_level as ChatAccessLevel));
    addDebug('guardrails', `Using tier ${getGuardrailsTierLabel(access.access_level as ChatAccessLevel)}`);

    // ----------------------------------------
    // 6. INPUT GUARDRAILS: PII MASKING
    // ----------------------------------------
    if (guardrails.piiDetection.block === false) {
      message = maskPII(message);
      addDebug('input.masking', 'PII masking applied to user input');
    }
    console.log('[ai-chat] Processing message, conversation_id:', conversation_id || 'new');
    addDebug('conversation.prepare', conversation_id ? 'Using existing conversation' : 'Creating a new conversation');

    // ----------------------------------------
    // 7. GET OR CREATE CONVERSATION VIA RPC
    // ----------------------------------------
    if (!conversation_id) {
      const { data: newConvData, error: convError } = await supabaseUser.rpc('create_chat_conversation_audited', {
        p_title: message.substring(0, 100),
      });

      if (convError) {
        console.error('[ai-chat] Error creating conversation:', convError.message);
        addDebug('conversation.create', 'Failed to create conversation', 'error');
        return new Response(JSON.stringify(withDebug({ error: 'Failed to create conversation' })), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      conversation_id = (newConvData as { conversation_id: string }).conversation_id;
      console.log('[ai-chat] Created new conversation:', conversation_id.substring(0, 8) + '...');
      addDebug('conversation.create', 'Conversation created');
    }

    // ----------------------------------------
    // 8. FETCH CONVERSATION HISTORY
    // ----------------------------------------
    addDebug('history.fetch', 'Loading conversation history');
    const { data: historyData, error: historyError } = await supabaseUser.rpc('get_chat_messages_audited', {
      p_conversation_id: conversation_id,
    });

    if (historyError) {
      const status = historyError.message?.toLowerCase().includes('access denied') ? 403 : 500;
      console.error('[ai-chat] Error fetching history:', historyError.message);
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
    const { error: userMsgError } = await supabaseUser.rpc('save_chat_message_audited', {
      p_content: message,
      p_conversation_id: conversation_id,
      p_role: 'user',
      p_user_id: userId,
    });

    if (userMsgError) {
      console.error('[ai-chat] Error saving user message:', userMsgError.message);
      addDebug('message.save.user', 'Failed to persist user message', 'warn');
    } else {
      addDebug('message.save.user', 'User message saved');
    }

    // ----------------------------------------
    // AISHA BRIDGE: Resolve story context for routing/composition.
    // Uses explicit story_id from request when provided, otherwise
    // resolves the best story for the current user via RPC.
    const resolvedStoryId = await resolveChatStoryId(supabaseUser, explicitStoryId);
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
      console.log(`[ai-chat] Escalation signals: ${escalationSignals.join(', ')}`);
    }

    const routeRiskProfile: "low" | "medium" | "high" =
      escalationSignals.includes("incident")
      ? "high"
      : escalationSignals.length > 0
        ? "medium"
        : "low";

    try {
      addDebug('aisha.route', 'Registering interaction with Aisha orchestration');
      aishaRoutePlan = await routeViaAisha(supabaseService, {
        taskKind: 'chat',
        riskProfile: routeRiskProfile,
        storyId: resolvedStoryId ?? undefined,
        tech: ['supabase', 'typescript'],
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
        console.log(`[ai-chat] Aisha route plan: run_id=${aishaRoutePlan.runId.substring(0, 8)}`);
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
    const { data: channelData, error: channelError } = await supabaseService
      .rpc('get_active_channel_config', { p_channel_slug: CHANNEL_SLUG });

    if (channelError || !channelData || (typeof channelData === 'object' && channelData !== null && 'error' in channelData)) {
      console.error('[ai-chat] Error loading channel config:', channelError?.message || (channelData as Record<string, unknown>)?.error);
      addDebug('channel.load', 'Failed to load channel configuration', 'error');
      return new Response(JSON.stringify(withDebug({ error: 'Failed to load agent configurations' })), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channelConfig = typeof channelData === 'string' ? JSON.parse(channelData) : channelData;
    addDebug('channel.load', `Channel loaded: ${channelConfig.slug}, model: ${channelConfig.model}`);

    // Main agent — derived from channel's primary LLM configuration
    const mainAgent: AgentConfig = {
      id: channelConfig.channel_id ?? null,
      name: 'main_agent',
      instructions: channelConfig.system_prompt || '',
      model: channelConfig.model || getDefaultModel(),
      temperature: channelConfig.temperature ?? 0.7,
      max_tokens: channelConfig.max_tokens ?? 3000,
      model_settings: channelConfig.model_settings,
    };

    // ----------------------------------------
    // LOAD TOOLS FROM CHANNEL's allowed_tools (Phase 2 — Tool System)
    // ----------------------------------------
    const toolExecutor = createToolExecutor(
      supabaseService,
      supabaseUser,
      userId,
      tracer,
      { accessLevel: access.access_level as ChatAccessLevel },
    );

    const channelToolNames: string[] = Array.isArray(channelConfig.allowed_tools) ? channelConfig.allowed_tools : [];
    let agentToolSpecs: LlmToolSpec[] = [];
    try {
      const toolDefs = await toolExecutor.loadToolsByNames(channelToolNames);
      agentToolSpecs = toolExecutor.toOpenAIToolSpecs(toolDefs);
      if (agentToolSpecs.length > 0) {
        addDebug('tools.load', `Loaded ${agentToolSpecs.length} tools for channel`);
        console.log('[ai-chat] Loaded tools for channel:', agentToolSpecs.map(t => t.function.name).join(', '));
      }
    } catch (toolLoadError) {
      // Tool loading is non-blocking — agent works without tools
      const errMsg = toolLoadError instanceof Error ? toolLoadError.message : String(toolLoadError);
      console.warn('[ai-chat] Tool loading failed (non-blocking):', errMsg);
      addDebug('tools.load', `Tool loading failed: ${errMsg}`, 'warn');
    }

    // ----------------------------------------
    // LOAD MEMORY (Phase 4 — Session + Long-term)
    // ----------------------------------------
    let memoryManager: MemoryManager | null = null;
    let memoryContext = '';
    try {
      memoryManager = createMemoryManager(supabaseService, tracer, {
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
        console.log(`[ai-chat] Memory loaded: ${sessionEntries.length} session, ${userEntries.length} user entries`);
      }
    } catch (memError) {
      // Memory loading is non-blocking — agent works without memory
      const errMsg = memError instanceof Error ? memError.message : String(memError);
      console.warn('[ai-chat] Memory loading failed (non-blocking):', errMsg);
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
      hippocampus = createHippocampus(supabaseService, tracer, {
        userId,
        conversationId: conversation_id,
      });

      const personalityContext: PersonalityContext = await hippocampus.resolvePersonality();
      personalityPrompt = hippocampus.buildPersonalityPrompt(personalityContext);
      personalityTraitsUsed = personalityContext.traits.map((t) => t.slug ?? t.trait_id);

      if (personalityContext.traits.length > 0) {
        addDebug('hippocampus', `Personality resolved: ${personalityContext.baseCount} base + ${personalityContext.experientialCount} experiential traits`);
        console.log(`[ai-chat] Hippocampus: ${personalityContext.traits.length} personality traits resolved`);
      }
    } catch (hippoError) {
      const errMsg = hippoError instanceof Error ? hippoError.message : String(hippoError);
      console.warn('[ai-chat] Hippocampus loading failed (non-blocking):', errMsg);
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
        aishaContextBundle = await enrichWithAishaContext(supabaseService, {
          storyId: resolvedStoryId,
          contextProfile,
          runId: aishaRoutePlan?.runId ?? undefined,
          query: message,
          conversationHistory: conversationHistory.map((m) => ({ role: m.role, content: m.content })),
        });
        if (aishaContextBundle && aishaContextBundle.tokensUsed > 0) {
          addDebug('aisha.context', `Context composed: ${aishaContextBundle.tokensUsed}/${aishaContextBundle.tokenBudget} tokens, ${Object.keys(aishaContextBundle.layers).length} layers`);
        } else {
          addDebug('aisha.context', 'Context bundle empty or unavailable, using inline fallback');
        }
      } catch {
        addDebug('aisha.context', 'Context composition failed (non-blocking), using inline fallback', 'warn');
      }
    } else {
      addDebug('aisha.context', 'Skipping compose_context because no story_id was resolved', 'warn');
    }

    const restrictionPrompt = buildRestrictionPrompt(guardrails, language);
    const tierLabel = getGuardrailsTierLabel(access.access_level as ChatAccessLevel);
    const languageInstruction = language === 'cs'
      ? '\n\nOdpovídej vždy v češtině.'
      : '\n\nAlways respond in English.';
    const callerContext = `\n\n## CALLER CONTEXT\n- Access tier: ${tierLabel}\n- Access level: ${access.access_level}\n- Language: ${language}`;

    // Phase 0.3: compose_context as primary system prompt source
    // When context bundle has meaningful content, place it BEFORE agent instructions
    // so rules and KB context have higher priority. Fallback: inline assembly.
    //
    // HIPPOCAMPUS: Personality is the FIRST layer — it's a preset that shapes
    // how the LLM thinks and responds. Order: Personality → Context → Instructions
    // Personality is WHO AISHA is. Context is WHAT she knows. Instructions are HOW she works.
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
    const { graph: workflowGraph, workflowId, name: workflowName } = await loadWorkflow(supabaseService, 'chat');
    addDebug('workflow.load', `Using workflow '${workflowName}' (${Object.keys(workflowGraph.nodes).length} nodes)${workflowId ? ` [id=${workflowId.substring(0, 8)}]` : ''}`);

    // Link this run to the workflow definition (if from DB)
    if (workflowId) {
      try {
        await supabaseService.rpc('set_ai_run_workflow', {
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
    console.log(`[ai-chat] Execution mode: ${executionMode}`);

    const modelSelection: ModelSelectionResult = await selectOptimalModel(
      message,
      escalationSignals,
      aishaRoutePlan,
      conversationHistory,
      supabaseService,
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
      console.log(`[ai-chat] Model OVERRIDE: ${body.model_override}`);
    } else {
      addDebug('aisha.model', `Smart model selection: ${modelSelection.model} (${modelSelection.complexity}) — ${modelSelection.reason} [${modelSelection.source}]`);
      console.log(`[ai-chat] Model auto-selected: ${modelSelection.model} (complexity=${modelSelection.complexity})`);
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

    try {
      console.log(`[ai-chat] Executing workflow '${workflowName}' (${Object.keys(workflowGraph.nodes).length} nodes)`);
      addDebug('workflow.exec', `Starting workflow engine execution`);

      const engine = createWorkflowEngine({
        supabaseService,
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

      console.log(`[ai-chat] Workflow completed: ${result.nodesExecuted} nodes, category=${category}, specialist=${specialistName}, tools=${toolIterationsUsed}`);
      addDebug('workflow.exec', `Workflow completed: ${result.nodesExecuted} nodes, critic_revised=${result.criticRevised}`);

      // Phase A: Log provenance summary and preflight warnings
      if (result.provenanceSummary) {
        const { decisions: pDecisions, violations: pViolations } = result.provenanceSummary;
        if (pDecisions.length > 0) {
          addDebug('workflow.provenance', `${pDecisions.length} decision(s) recorded, ${pViolations.length} violation(s)`);
        }
        if (pViolations.length > 0) {
          console.warn(`[ai-chat] Decision provenance violations: ${pViolations.map(v => v.decision).join(', ')}`);
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
        console.error('[ai-chat] Workflow returned empty content');
        addDebug('workflow.exec', 'Workflow returned empty content, using fallback', 'error');
        assistantContent = language === 'cs'
          ? 'Omlouváme se, nepodařilo se vygenerovat odpověď. Zkuste to prosím znovu.'
          : 'Sorry, we could not generate a response. Please try again.';
      }
    } catch (error: unknown) {
      console.error('[ai-chat] Workflow execution failed:', error);
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
          console.error('[ai-chat] LLM authentication failed');
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
          console.error('[ai-chat] LLM bad request:', apiError.message);
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
    // 13. OUTPUT GUARDRAILS: APPLY RESTRICTIONS
    // ----------------------------------------
    assistantContent = applyGuardrailsToResponse(assistantContent, guardrails, language);
    addDebug('guardrails.output', 'Output guardrails applied');

    const responseTime = Date.now() - startTime;
    console.log('[ai-chat] Response generated, tokens:', totalTokensInput + totalTokensOutput, 'time:', responseTime + 'ms');
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

    const { data: assistantMsgData, error: assistantMsgError } = await supabaseService.rpc('save_chat_message_audited', {
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
      console.error('[ai-chat] Error saving assistant message:', assistantMsgError.message);
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
      if (escalationSignals.includes('frustration') || escalationSignals.includes('complaint')) {
        hippocampus.captureSignal('frustration', { message_preview: message.substring(0, 80) }, 0.7);
      }
      if (escalationSignals.includes('gratitude') || /děkuj|díky|thank|super|skvěl/i.test(message)) {
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
    // 14b. ASYNC EVALUATION (fire-and-forget)
    // ----------------------------------------
    // Non-blocking: trigger LLM-as-judge evaluation for quality tracking.
    // Failures are silently logged — never blocks the user response.
    try {
      const evalUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/evaluate-ai-response`;
      const evalServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      // Fire and forget — do NOT await
      fetch(evalUrl, {
          signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${evalServiceKey}`,
        },
        body: JSON.stringify({ message_id: messageId }),
      }).catch((evalErr) => {
        console.error('[ai-chat] Async eval trigger failed:', evalErr instanceof Error ? evalErr.message : evalErr);
      });
      addDebug('eval.trigger', 'Async evaluation triggered');
    } catch {
      // Never block response for eval failures
      addDebug('eval.trigger', 'Eval trigger skipped', 'warn');
    }

    // ----------------------------------------
    // 15. RETURN RESPONSE
    // ----------------------------------------
    addDebug('response.ready', 'Returning response payload');

    // ----------------------------------------
    // 15a. AISHA: Metadata already saved — Realtime does the rest
    // ----------------------------------------
    // Aisha observes chat_messages via Supabase Realtime WebSocket.
    // The enriched content_metadata (saved with assistant message above)
    // contains everything she needs: escalation signals, participation hint,
    // category, KB context, debug events, and system prompt hint.
    // She decides autonomously when to intervene via aisha-callback.
    if (aishaParticipation.shouldRespond) {
      console.log(`[ai-chat] Aisha participation hint stored: reason=${aishaParticipation.reason}, proactive=${aishaParticipation.proactive}`);
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
      },
    })), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ai-chat] Unhandled error:', error);
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
});
