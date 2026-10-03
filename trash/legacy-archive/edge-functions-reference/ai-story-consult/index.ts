import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve, createClient } from "../_shared/deps.ts";
import OpenAI from "npm:openai";

import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { createTracer, type Tracer } from "../_shared/tracer.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import {
  getGuardrailsConfig,
  applyGuardrailsToResponse,
  buildRestrictionPrompt,
  getGuardrailsTierLabel,
  maskPII,
  type ChatAccessLevel,
} from "../_shared/guardrails-config.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import { getDefaultModel } from "../_shared/defaultModel.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

/** Structured error response following AISHA error contract: { error_code, message, error } */
function errorResponse(
  req: Request,
  errorCode: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return jsonResponse(req, {
    error_code: errorCode,
    message,
    error: message, // backward compat for legacy clients
    ...extra,
  }, status);
}

// ============================================
// TYPES
// ============================================
type ConsultAction = "chat" | "recap" | "translate" | "recommend" | "analyze";
type ActorMode = "member" | "partner" | "admin_staff";

interface StoryConsultRequest {
  story_id: string;
  action: ConsultAction;
  message?: string;
  target_language?: string;
  entry_ids?: string[];
  include_health_data?: boolean;
  conversation_id?: string;
  language?: "cs" | "en";
}

interface StoryContext {
  story_id: string;
  study_id: string | null;
  has_consent: boolean;
  timeline_summary: Array<{
    type: string;
    date: string;
    preview: string | null;
  }> | null;
  study_info: {
    name: string;
    status: string;
  } | null;
  recent_checkins?: Array<{
    date: string;
    type: string;
    pain_level: number | null;
    energy_level: number | null;
    mood_level: number | null;
  }> | null;
  shared_documents_count?: number;
}

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatAccessResult {
  access_level?: string;
  has_completed_questionnaire?: boolean;
}

interface AgentConfig {
  id: string | null;
  name: string;
  instructions: string;
  model: string;
  temperature: number;
  max_tokens: number;
  routing_category?: string;
  model_settings?: {
    reasoning?: { effort: "low" | "medium" | "high" };
    [key: string]: unknown;
  };
}

interface PartnerAccessRow {
  access_level: string;
}

// ============================================
// HELPERS
// ============================================
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns true for models supporting the reasoning parameter (o1, o3, o4 families) */
function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4|gpt-5)/.test(model);
}

function buildModelParams(agent: AgentConfig): Record<string, unknown> {
  if (isReasoningModel(agent.model)) {
    return agent.model_settings?.reasoning
      ? { reasoning: agent.model_settings.reasoning }
      : {};
  }
  return { temperature: agent.temperature };
}

function mapActorLevelToGuardrails(actorMode: ActorMode, actorAccessLevel: string): ChatAccessLevel {
  if (actorMode === "admin_staff") {
    return "partner_premium";
  }

  if (actorMode === "partner") {
    if (actorAccessLevel === "premium") return "partner_premium";
    if (actorAccessLevel === "certified") return "partner_certified";
    return "partner";
  }

  switch (actorAccessLevel) {
    case "premium":
    case "certified":
    case "qualified":
    case "active":
    case "enrolled":
    case "basic":
      return actorAccessLevel;
    case "pending_approval":
    case "needs_questionnaire":
      // Transitional states — grant basic-tier guardrails, not qualified.
      return "basic";
    default:
      return "basic";
  }
}

function buildStoryContextString(
  context: StoryContext,
  timelineEntries: StoryContext["timeline_summary"],
  includeHealthData: boolean,
  recentCheckins: NonNullable<StoryContext["recent_checkins"]>,
): string {
  let contextString = "## Kontext případu\n\n";
  contextString += `**Story ID:** ${context.story_id}\n`;
  if (context.study_info) {
    contextString += `**Studie:** ${context.study_info.name} (${context.study_info.status})\n`;
  }
  if (typeof context.shared_documents_count === "number") {
    contextString += `**Sdílené dokumenty:** ${context.shared_documents_count}\n`;
  }
  contextString += "**Pacient:** (identita nezahrnuta)\n";

  const timeline = timelineEntries ?? [];
  if (timeline.length > 0) {
    contextString += `\n### Timeline (posledních ${timeline.length} záznamů)\n\n`;
    for (const entry of timeline.slice(0, 15)) {
      const date = new Date(entry.date).toLocaleDateString("cs-CZ");
      contextString += `- [${date}] **${entry.type}**: ${entry.preview?.substring(0, 200) || "(bez obsahu)"}\n`;
    }
  }

  if (includeHealthData && recentCheckins.length > 0) {
    const painValues = recentCheckins
      .map((checkin) => checkin.pain_level)
      .filter((value): value is number => typeof value === "number");
    const moodValues = recentCheckins
      .map((checkin) => checkin.mood_level)
      .filter((value): value is number => typeof value === "number");

    const avgPain = painValues.length > 0
      ? painValues.reduce((sum, value) => sum + value, 0) / painValues.length
      : null;
    const avgMood = moodValues.length > 0
      ? moodValues.reduce((sum, value) => sum + value, 0) / moodValues.length
      : null;

    contextString += "\n### Zdravotní souhrn\n";
    contextString += `- Check-inů: ${recentCheckins.length}\n`;
    if (avgPain !== null) {
      contextString += `- Průměrná bolest: ${avgPain.toFixed(1)}/10\n`;
    }
    if (avgMood !== null) {
      contextString += `- Průměrná nálada: ${avgMood.toFixed(1)}/10\n`;
    }
  }

  return contextString;
}

function buildActionPrompt(
  action: ConsultAction,
  contextString: string,
  message: string | undefined,
  targetLanguage: string | undefined,
  timelineEntries: StoryContext["timeline_summary"],
): { threadUserMessage: string; modelUserPrompt: string; taskPrompt: string } {
  const taskPrompts: Record<ConsultAction, string> = {
    chat: `Máš navíc roli: Odborná zdravotní konzultantka pro partnery v systému Longevity Club.
Máš přístup ke kontextu případu.
Odpovídej profesionálně, stručně a věcně.
PRAVIDLA:
- Vždy zohledni kontext případu
- Nikdy nedoporučuj léky bez konzultace s lékařem`,
    recap: `Vytvoř stručnou rekapitulaci případu (story) na základě poskytnutého kontextu.
Struktura:
1. Shrnutí případu
2. Časová osa (klíčové body)
3. Aktuální stav
4. Doporučení
Buď stručný, ale kompletní.`,
    translate: "Přelož následující text do požadovaného jazyka. Zachovej formátování a odbornou terminologii.",
    recommend: "Na základě kontextu a historie navrhni další kroky (okamžité, krátkodobé, dlouhodobé). Piš konkrétně.",
    analyze: "Analyzuj zdravotní trendy, vzorce, anomálie a korelace z dostupných dat.",
  };

  switch (action) {
    case "chat": {
      const clean = (message ?? "").trim();
      return {
        threadUserMessage: clean,
        modelUserPrompt: clean,
        taskPrompt: taskPrompts.chat,
      };
    }
    case "recap":
      return {
        threadUserMessage: "[story_action:recap]",
        modelUserPrompt: `${contextString}\n\nProveď rekapitulaci.`,
        taskPrompt: taskPrompts.recap,
      };
    case "translate": {
      const entriesToTranslate = (timelineEntries ?? [])
        .slice(0, 10)
        .map((entry) => entry.preview)
        .filter((preview): preview is string => typeof preview === "string" && preview.length > 0)
        .join("\n\n---\n\n");

      return {
        threadUserMessage: `[story_action:translate:${targetLanguage ?? "en"}]`,
        modelUserPrompt: `Přelož do jazyka: ${targetLanguage}\n\n${entriesToTranslate}`,
        taskPrompt: taskPrompts.translate,
      };
    }
    case "recommend":
      return {
        threadUserMessage: "[story_action:recommend]",
        modelUserPrompt: `${contextString}\n\nNavrhni kroky.`,
        taskPrompt: taskPrompts.recommend,
      };
    case "analyze":
      return {
        threadUserMessage: "[story_action:analyze]",
        modelUserPrompt: `${contextString}\n\nProveď analýzu.`,
        taskPrompt: taskPrompts.analyze,
      };
    default:
      return {
        threadUserMessage: "[story_action:chat]",
        modelUserPrompt: message ?? "",
        taskPrompt: taskPrompts.chat,
      };
  }
}

// ============================================
// VALIDATION
// ============================================
function validateRequest(body: unknown): StoryConsultRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.story_id !== "string" || !obj.story_id) {
    throw new Error("story_id is required");
  }

  const validActions: ConsultAction[] = ["chat", "recap", "translate", "recommend", "analyze"];
  if (!validActions.includes(obj.action as ConsultAction)) {
    throw new Error("action must be one of: chat, recap, translate, recommend, analyze");
  }

  if (obj.action === "chat" && (!obj.message || typeof obj.message !== "string")) {
    throw new Error("message is required for chat action");
  }

  if (obj.action === "translate" && (!obj.target_language || typeof obj.target_language !== "string")) {
    throw new Error("target_language is required for translate action");
  }

  if (
    obj.conversation_id !== undefined &&
    (typeof obj.conversation_id !== "string" || !UUID_REGEX.test(obj.conversation_id))
  ) {
    throw new Error("conversation_id must be a valid UUID");
  }

  if (obj.language !== undefined && !["cs", "en"].includes(obj.language as string)) {
    throw new Error('language must be "cs" or "en"');
  }

  return {
    story_id: obj.story_id as string,
    action: obj.action as ConsultAction,
    message: obj.message as string | undefined,
    target_language: obj.target_language as string | undefined,
    entry_ids: Array.isArray(obj.entry_ids) ? obj.entry_ids : undefined,
    include_health_data: obj.include_health_data === true,
    conversation_id: obj.conversation_id as string | undefined,
    language: (obj.language as "cs" | "en") || "cs",
  };
}

// ============================================
// MAIN HANDLER
// ============================================
serve(async (req) => {
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });

  if (originFailure) {
    return silentCorsDenyResponse();
  }

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  if (req.method !== "POST") {
    return errorResponse(req, "method_not_allowed", "Method not allowed", 405);
  }

  const startTime = Date.now();

  try {
    // ----------------------------------------
    // 1. AUTHENTICATE USER + INIT CLIENTS
    // ----------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[ai-story-consult] No authorization header");
      return errorResponse(req, "unauthorized", "Unauthorized", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseAnonKey) {
      console.error("[ai-story-consult] Missing SUPABASE_ANON_KEY");
      return errorResponse(req, "server_error", "Configuration error", 500);
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseService.auth.getUser(token);

    if (authError || !user) {
      console.error("[ai-story-consult] Auth error");
      return errorResponse(req, "token_expired", "Unauthorized", 401);
    }

    const userId = user.id;
    console.log("[ai-story-consult] User authenticated:", userId.substring(0, 8) + "...");

    // ----------------------------------------
    // 1b. INIT TRACER (non-blocking — degrades if RPC fails)
    // ----------------------------------------
    let tracer: Tracer | null = null;
    try {
      tracer = await createTracer(supabaseService, {
        kind: "chat",
        actorUserId: userId,
      });
    } catch {
      console.warn("[ai-story-consult] Tracer init failed, continuing without tracing");
    }

    // ----------------------------------------
    // 2. LOAD OPENAI API KEY & INIT CLIENT
    // ----------------------------------------
    const openaiApiKey = (await getOpenAiApiKey(supabaseService)) ?? Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      console.error("[ai-story-consult] OpenAI API key not configured");
      return errorResponse(req, "service_unavailable", "AI service not configured", 503);
    }

    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    // ----------------------------------------
    // 3. VALIDATE REQUEST
    // ----------------------------------------
    let body: StoryConsultRequest;
    try {
      const rawBody = await req.json();
      body = validateRequest(rawBody);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid request";
      console.error("[ai-story-consult] Validation error:", msg);
      return errorResponse(req, "bad_request", msg, 400);
    }

    const {
      story_id,
      action,
      message,
      target_language,
      include_health_data,
      conversation_id: requestedConversationId,
      language,
    } = body;
    console.log("[ai-story-consult] Action:", action, "Story:", story_id.substring(0, 8) + "...");

    // ----------------------------------------
    // 4. CHECK ACCESS LEVEL (ADMIN/STAFF, CERTIFIED PARTNER, QUALIFIED MEMBER)
    // ----------------------------------------
    let actorAccessLevel = "member";
    let actorMode: ActorMode = "member";
    let hasAccess = false;

    const { data: isAdminOrStaff, error: adminCheckError } = await supabaseUser.rpc(
      "is_admin_or_staff",
      { p_user_id: userId },
    );

    if (adminCheckError) {
      console.error("[ai-story-consult] Admin/staff check failed");
      return errorResponse(req, "server_error", "Access check failed", 500);
    }

    if (isAdminOrStaff === true) {
      actorMode = "admin_staff";
      actorAccessLevel = "admin_staff";
      hasAccess = true;
    }

    if (!hasAccess) {
      const { data: partnerRows, error: partnerError } = await supabaseUser.rpc(
        "get_partner_access_for_edge",
        { p_user_id: userId },
      );

      if (!partnerError && Array.isArray(partnerRows) && partnerRows.length > 0) {
        const partnerData = partnerRows[0] as PartnerAccessRow;
        if (["certified", "premium"].includes(partnerData.access_level)) {
          actorMode = "partner";
          actorAccessLevel = partnerData.access_level;
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      const { data: chatAccessData, error: chatAccessError } = await supabaseUser.rpc(
        "get_chat_access_level",
        { p_user_id: userId },
      );

      if (chatAccessError) {
        console.error("[ai-story-consult] Member access check failed");
        return errorResponse(req, "server_error", "Access check failed", 500);
      }

      const chatAccess = (chatAccessData ?? {}) as ChatAccessResult;
      const isQualifiedMember =
        chatAccess.has_completed_questionnaire === true ||
        (typeof chatAccess.access_level === "string" &&
          ["qualified", "certified", "premium"].includes(chatAccess.access_level));

      if (isQualifiedMember) {
        actorMode = "member";
        actorAccessLevel = chatAccess.access_level ?? "qualified";
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return errorResponse(
        req,
        "forbidden",
        "AI consultation is available for qualified members, certified partners, admin and staff",
        403,
      );
    }

    const mappedGuardrailsLevel = mapActorLevelToGuardrails(actorMode, actorAccessLevel);
    const baseGuardrails = getGuardrailsConfig(mappedGuardrailsLevel);
    const guardrails = {
      ...baseGuardrails,
      contentRestrictions: {
        ...baseGuardrails.contentRestrictions,
        // Story consult always needs user context because the entire
        // purpose of this endpoint is case-level AI consultation.
        // Access control is enforced by:
        //   1. Admin/partner/qualified member check above (step 4)
        //   2. get_story_context_for_ai_audited RPC enforces story-level access
        //   3. Consent validation below (step 5 — context.has_consent)
        // This override is intentional and safe.
        allowUserContext: true,
      },
    };
    console.log(
      "[ai-story-consult] Access granted mode:",
      actorMode,
      "level:",
      actorAccessLevel,
      "guardrails:",
      getGuardrailsTierLabel(mappedGuardrailsLevel),
    );

    // ----------------------------------------
    // 5. GET STORY CONTEXT VIA RPC
    // ----------------------------------------
    const { data: contextData, error: contextError } = await supabaseUser.rpc(
      "get_story_context_for_ai_audited",
      { p_story_id: story_id },
    );

    if (contextError) {
      console.error("[ai-story-consult] Context fetch error:", contextError.message);
      return errorResponse(req, "server_error", "Failed to fetch story context", 500);
    }

    const context = contextData as StoryContext;
    const timelineEntries = context.timeline_summary ?? [];
    const recentCheckins = context.recent_checkins ?? [];
    console.log("[ai-story-consult] Context loaded, entries:", timelineEntries.length);

    if (!context.has_consent) {
      return errorResponse(req, "consent_required", "Consent required", 403);
    }

    // ----------------------------------------
    // 6. RESOLVE STORY CHAT THREAD (ONE THREAD PER STORY+USER)
    // ----------------------------------------
    const { data: threadData, error: threadError } = await supabaseService.rpc("edge_story_ai", {
      p_action: "get_or_create_story_conversation",
      p_payload: {
        story_id,
        user_id: userId,
        title: `Story consultation ${story_id.substring(0, 8)}`,
      },
    });

    if (threadError) {
      console.error("[ai-story-consult] Failed to resolve story conversation:", threadError.message);
      return errorResponse(req, "server_error", "Failed to resolve story thread", 500);
    }

    const conversationId = (threadData as { conversation_id?: string } | null)?.conversation_id;
    if (!conversationId) {
      console.error("[ai-story-consult] edge_story_ai returned no conversation_id");
      return errorResponse(req, "server_error", "Failed to resolve story thread", 500);
    }

    if (requestedConversationId && requestedConversationId !== conversationId) {
      console.warn("[ai-story-consult] Ignoring non-canonical conversation_id from request");
    }

    // ----------------------------------------
    // 7. FETCH CONVERSATION HISTORY
    // ----------------------------------------
    const { data: historyData, error: historyError } = await supabaseUser.rpc(
      "get_chat_messages_audited",
      { p_conversation_id: conversationId },
    );

    if (historyError) {
      console.error("[ai-story-consult] Failed to load thread history:", historyError.message);
      return errorResponse(req, "server_error", "Failed to load story thread history", 500);
    }

    const conversationHistory: ChatHistoryMessage[] = (Array.isArray(historyData) ? historyData : [])
      .filter((msg) => msg?.role === "user" || msg?.role === "assistant")
      .map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: String(msg.content ?? ""),
      }));

    // ----------------------------------------
    // 8. LOAD CHANNEL CONFIGURATION
    // ----------------------------------------
    // Channel-centric architecture: channel config is the sole source of truth.
    // Pipeline agents (classify, main_agent, simplicity) are derived from channel config.
    // Optional pipeline overrides live in model_settings.pipeline JSONB.
    // Optional specialist agents live in routing_rules.specialists JSONB array.
    const CHANNEL_SLUG = "ai-story-consult";
    const { data: channelData, error: channelError } = await supabaseService
      .rpc('get_active_channel_config', { p_channel_slug: CHANNEL_SLUG });

    if (channelError || !channelData || (typeof channelData === 'object' && channelData !== null && 'error' in channelData)) {
      console.error("[ai-story-consult] Error loading channel config:", channelError?.message || (channelData as Record<string, unknown>)?.error);
      return errorResponse(req, "server_error", "Failed to load agent configuration", 500);
    }

    const channelConfig = typeof channelData === 'string' ? JSON.parse(channelData) : channelData;
    const pipelineOverrides = (channelConfig.model_settings?.pipeline ?? {}) as Record<string, Record<string, unknown> | false>;

    // Main agent — uses channel's primary LLM configuration
    const mainAgent: AgentConfig = {
      id: channelConfig.channel_id ?? null,
      name: "main_agent",
      instructions: channelConfig.system_prompt || "",
      model: channelConfig.model || getDefaultModel(),
      temperature: channelConfig.temperature ?? 0.7,
      max_tokens: channelConfig.max_tokens ?? 3000,
      model_settings: channelConfig.model_settings,
    };

    // Classify agent — lightweight intent classifier (optional, from pipeline overrides)
    const classifyAgent: AgentConfig | undefined = pipelineOverrides.classify
      ? {
          id: null,
          name: "classify",
          instructions: (pipelineOverrides.classify.instructions as string) || "Classify the user message into a JSON object with a 'category' field.",
          model: (pipelineOverrides.classify.model as string) || channelConfig.model || getDefaultModel(),
          temperature: (pipelineOverrides.classify.temperature as number) ?? 0.1,
          max_tokens: (pipelineOverrides.classify.max_tokens as number) ?? 100,
          model_settings: pipelineOverrides.classify.model_settings as AgentConfig["model_settings"],
        }
      : undefined;

    // Simplicity agent — response polisher (optional, from pipeline overrides)
    const simplicityAgent: AgentConfig | undefined = pipelineOverrides.simplicity
      ? {
          id: null,
          name: "simplicity",
          instructions: (pipelineOverrides.simplicity.instructions as string) || "Simplify and polish the response for better readability.",
          model: (pipelineOverrides.simplicity.model as string) || channelConfig.model || getDefaultModel(),
          temperature: (pipelineOverrides.simplicity.temperature as number) ?? 0.5,
          max_tokens: (pipelineOverrides.simplicity.max_tokens as number) ?? 2000,
          model_settings: pipelineOverrides.simplicity.model_settings as AgentConfig["model_settings"],
        }
      : undefined;

    // Specialist agents — domain-specific agents from routing_rules (optional)
    const specialistConfigs: AgentConfig[] = Array.isArray(channelConfig.routing_rules?.specialists)
      ? (channelConfig.routing_rules.specialists as Array<Record<string, unknown>>).map((s: Record<string, unknown>) => ({
          id: null,
          name: (s.name as string) || "specialist",
          instructions: (s.instructions as string) || "",
          model: (s.model as string) || channelConfig.model || getDefaultModel(),
          temperature: (s.temperature as number) ?? 0.7,
          max_tokens: (s.max_tokens as number) ?? 1000,
          routing_category: s.routing_category as string,
          model_settings: s.model_settings as AgentConfig["model_settings"],
        }))
      : [];

    // Alias for backward compat in prompt building
    const agent = mainAgent;

    // ----------------------------------------
    // 9. BUILD PROMPTS + SAVE USER MESSAGE
    // ----------------------------------------
    const contextString = buildStoryContextString(
      context,
      timelineEntries,
      include_health_data === true,
      recentCheckins,
    );

    const { threadUserMessage, modelUserPrompt, taskPrompt } = buildActionPrompt(
      action,
      contextString,
      message,
      target_language,
      timelineEntries,
    );

    const normalizedUserMessage = guardrails.piiDetection.block === false
      ? maskPII(threadUserMessage)
      : threadUserMessage;

    const normalizedModelPrompt = guardrails.piiDetection.block === false
      ? maskPII(modelUserPrompt)
      : modelUserPrompt;

    const { error: userMessageSaveError } = await supabaseUser.rpc("save_chat_message_audited", {
      p_content: normalizedUserMessage,
      p_conversation_id: conversationId,
      p_role: "user",
      p_routing_category: `story_${action}`,
    });

    if (userMessageSaveError) {
      console.error("[ai-story-consult] Failed to save user thread message:", userMessageSaveError.message);
    }

    // ----------------------------------------
    // 10. MULTI-AGENT PIPELINE
    // ----------------------------------------
    // Pipeline (matching reference architecture & ai-chat pattern):
    //   Step 1: CLASSIFY message → get category (chat action only)
    //   Step 2: SPECIALIST context → domain agent enriches response
    //   Step 3: DOCTRINE (main_agent) → final response filtered through RTN doctrine
    //   Step 4: SIMPLICITY agent → polish (if guardrails.useSimplicityAgent)
    // For non-chat actions (recap/translate/recommend/analyze), skip classify+specialist.

    let totalTokensInput = 0;
    let totalTokensOutput = 0;

    const callerContext = `## CALLER CONTEXT
- Actor mode: ${actorMode}
- Access level: ${actorAccessLevel}
- Guardrails level: ${mappedGuardrailsLevel}`;

    const languageInstruction = language === "en"
      ? "Always respond in English."
      : "Odpovídej vždy česky (kromě překladové akce, kde respektuj cílový jazyk).";

    const restrictionPrompt = buildRestrictionPrompt(guardrails, language);

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // STEP 1: CLASSIFY (chat action only)
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    let category = "Else";
    let specialistContext = "";
    let specialistName = "none";

    if (action === "chat" && classifyAgent) {
      console.log("[ai-story-consult] Step 1: Classifying message...");

      try {
        const classifyFn = async () => {
          const res = await openai.responses.create({
            model: classifyAgent.model || getDefaultModel(),
            instructions: classifyAgent.instructions,
            input: normalizedModelPrompt,
            ...buildModelParams(classifyAgent),
            max_output_tokens: classifyAgent.max_tokens || 100,
            text: { format: { type: "json_object" } },
            store: false,
          });
          tracer?.addTokens(res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
          return res;
        };

        const classifyResponse = tracer
          ? await tracer.span("llm_call", "classify", "openai", "responses.create", classifyFn)
          : await classifyFn();

        const classifyContent = classifyResponse.output_text || "{}";
        totalTokensInput += classifyResponse.usage?.input_tokens || 0;
        totalTokensOutput += classifyResponse.usage?.output_tokens || 0;

        try {
          const parsed = JSON.parse(classifyContent);
          if (parsed.category) category = parsed.category;
        } catch {
          console.warn("[ai-story-consult] Failed to parse classification JSON");
        }
      } catch (classifyError) {
        const errMsg = classifyError instanceof Error ? classifyError.message : String(classifyError);
        console.warn("[ai-story-consult] Classification failed, using fallback:", errMsg);
      }

      console.log("[ai-story-consult] Classified as:", category);

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // STEP 2: SPECIALIST CONTEXT
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      const specialistAgent = specialistConfigs.find((s) => s.routing_category === category);
      specialistName = specialistAgent?.name || "unknown";

      if (specialistAgent && category !== "Else") {
        console.log("[ai-story-consult] Step 2: Getting specialist input from:", specialistName);

        try {
          const specialistInput: Array<{
            type: "message";
            role: "user" | "assistant";
            content: string;
          }> = [
            ...conversationHistory.slice(-10).map((m) => ({
              type: "message" as const,
              role: m.role,
              content: m.content,
            })),
            { type: "message" as const, role: "user" as const, content: normalizedModelPrompt },
          ];

          const specialistFn = async () => {
            const res = await openai.responses.create({
              model: specialistAgent.model || getDefaultModel(),
              instructions: specialistAgent.instructions,
              input: specialistInput,
              ...buildModelParams(specialistAgent),
              max_output_tokens: specialistAgent.max_tokens || 1000,
              store: false,
            });
            tracer?.addTokens(res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
            return res;
          };

          const contextResponse = tracer
            ? await tracer.span("llm_call", specialistName, "openai", "responses.create", specialistFn)
            : await specialistFn();

          specialistContext = contextResponse.output_text || "";
          totalTokensInput += contextResponse.usage?.input_tokens || 0;
          totalTokensOutput += contextResponse.usage?.output_tokens || 0;

          console.log("[ai-story-consult] Specialist provided context, length:", specialistContext.length);
        } catch (specialistError) {
          const errMsg = specialistError instanceof Error ? specialistError.message : String(specialistError);
          console.warn("[ai-story-consult] Specialist call failed:", errMsg);
        }
      }
    } else {
      console.log("[ai-story-consult] Non-chat action, skipping classify+specialist");
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // STEP 3: DOCTRINE — main response via main_agent
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    console.log("[ai-story-consult] Step 3: Generating doctrine response via main_agent...");

    const systemPrompt = [
      agent.instructions,
      taskPrompt,
      callerContext,
      languageInstruction,
      restrictionPrompt,
    ].filter(Boolean).join("\n\n");

    const openAiInput: Array<{
      type: "message";
      role: "user" | "assistant" | "developer";
      content: string;
    }> = [
      ...conversationHistory.slice(-20).map((entry) => ({
        type: "message" as const,
        role: entry.role,
        content: entry.content,
      })),
      {
        type: "message",
        role: "developer",
        content: `## STORY CONTEXT\n${contextString}`,
      },
    ];

    // Inject specialist context if available (from Step 2)
    if (specialistContext) {
      openAiInput.push({
        type: "message",
        role: "developer",
        content: `[Expert context from ${specialistName}]: ${specialistContext}`,
      });
    }

    openAiInput.push({
      type: "message",
      role: "user",
      content: normalizedModelPrompt,
    });

    let responseContent: string;

    try {
      const effectiveTemperature = action === "translate" ? 0.3 : (agent.temperature || 0.7);

      const doctrineFn = async () => {
        const res = await openai.responses.create({
          model: agent.model,
          instructions: systemPrompt,
          input: openAiInput,
          ...buildModelParams({ ...agent, temperature: effectiveTemperature }),
          max_output_tokens: agent.max_tokens || 3000,
          store: false,
        });
        tracer?.addTokens(res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        return res;
      };

      const aiResponse = tracer
        ? await tracer.span("llm_call", "main_agent", "openai", "responses.create", doctrineFn)
        : await doctrineFn();

      responseContent = aiResponse.output_text || "Nepodařilo se vygenerovat odpověď.";
      totalTokensInput += aiResponse.usage?.input_tokens || 0;
      totalTokensOutput += aiResponse.usage?.output_tokens || 0;

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // STEP 4: SIMPLICITY AGENT (if enabled by guardrails tier)
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      if (guardrails.useSimplicityAgent && responseContent.length > 200 && simplicityAgent) {
        console.log("[ai-story-consult] Step 4: Applying simplicity agent...");
        try {
          const simplicityFn = async () => {
            const res = await openai.responses.create({
              model: simplicityAgent.model || getDefaultModel(),
              instructions: simplicityAgent.instructions,
              input: [
                { type: "message" as const, role: "assistant" as const, content: responseContent },
                {
                  type: "message" as const,
                  role: "user" as const,
                  content: language === "cs"
                    ? "Zjednodušte a upravte předchozí odpověď asistenta pro lepší čitelnost."
                    : "Simplify and polish the previous assistant response for better readability.",
                },
              ],
              ...buildModelParams(simplicityAgent),
              max_output_tokens: simplicityAgent.max_tokens || 2000,
              store: false,
            });
            tracer?.addTokens(res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
            return res;
          };

          const simplicityResponse = tracer
            ? await tracer.span("llm_call", "simplicity", "openai", "responses.create", simplicityFn)
            : await simplicityFn();

          const simplifiedContent = simplicityResponse.output_text || "";
          totalTokensInput += simplicityResponse.usage?.input_tokens || 0;
          totalTokensOutput += simplicityResponse.usage?.output_tokens || 0;

          if (simplifiedContent.length > 50) {
            responseContent = simplifiedContent;
            console.log("[ai-story-consult] Simplicity agent applied successfully");
          }
        } catch (simplicityError) {
          console.warn("[ai-story-consult] Simplicity agent failed:", simplicityError);
        }
      }
    } catch (aiError: unknown) {
      console.error("[ai-story-consult] OpenAI API error:", aiError);

      if (aiError && typeof aiError === "object" && "status" in aiError) {
        const apiErr = aiError as { status: number };

        if (apiErr.status === 429) {
          return errorResponse(req, "rate_limited", "Rate limit exceeded. Please try again in a moment.", 429, { retry_after: 30 });
        }
        if (apiErr.status === 402) {
          return errorResponse(req, "credits_exhausted", "AI service credits exhausted. Please contact support.", 402);
        }
        if (apiErr.status === 401) {
          return errorResponse(req, "service_unavailable", "AI service configuration error.", 503);
        }
        if (apiErr.status === 400) {
          return errorResponse(req, "bad_request", "Invalid AI request. Please try rephrasing.", 400);
        }
        if (apiErr.status === 500 || apiErr.status === 502 || apiErr.status === 503) {
          return errorResponse(req, "service_unavailable", "AI service is temporarily unavailable. Please try again later.", 503);
        }
      }

      if (aiError instanceof Error && aiError.message?.includes("timeout")) {
        await tracer?.finish("failed", { error: "AI_TIMEOUT" });
        return errorResponse(req, "ai_timeout", "AI response timed out. Please try again.", 504);
      }

      await tracer?.finish("failed", { error: String(aiError) });
      throw aiError;
    }

    // ----------------------------------------
    // 11. OUTPUT GUARDRAILS: APPLY RESTRICTIONS
    // ----------------------------------------
    responseContent = applyGuardrailsToResponse(responseContent, guardrails, language);

    const responseTime = Date.now() - startTime;
    const tokensUsed = totalTokensInput + totalTokensOutput;
    console.log(
      "[ai-story-consult] Pipeline complete — category:", category,
      "specialist:", specialistName,
      "tokens:", tokensUsed,
      "time:", responseTime + "ms",
    );

    // ----------------------------------------
    // 12. SAVE ASSISTANT MESSAGE TO SAME THREAD
    // ----------------------------------------
    const { data: assistantMessageData, error: assistantMessageError } = await supabaseService.rpc(
      "save_chat_message_audited",
      {
        p_content: responseContent,
        p_conversation_id: conversationId,
        p_model_used: agent.model,
        p_response_time_ms: responseTime,
        p_role: "assistant",
        p_routed_to_agent_id: agent.id,
        p_routing_category: action === "chat" ? category : `story_${action}`,
        p_tokens_input: totalTokensInput,
        p_tokens_output: totalTokensOutput,
        p_user_id: userId,
      },
    );

    if (assistantMessageError) {
      console.error("[ai-story-consult] Failed to save assistant thread message:", assistantMessageError.message);
    }

    const assistantMessageId = (assistantMessageData as { id?: string } | null)?.id ?? null;

    // ----------------------------------------
    // 13. SAVE AI SESSION + AUDIT
    // ----------------------------------------
    const { data: sessionData, error: sessionError } = await supabaseService.rpc("edge_story_ai", {
      p_action: "insert_session",
      p_payload: {
        action,
        context_snapshot: {
          entries_count: timelineEntries.length,
          health_data_included: include_health_data === true,
          user_has_consent: context.has_consent,
          actor_mode: actorMode,
          guardrails_level: mappedGuardrailsLevel,
          routing_category: category,
          specialist_used: specialistName,
        },
        conversation_id: conversationId,
        health_data_included: include_health_data === true,
        partner_access_level: actorAccessLevel,
        response_time_ms: responseTime,
        session_type: action === "chat" ? "consultation" : action,
        story_id,
        summary: `AI story consult: ${action}, category: ${category}, specialist: ${specialistName}, ${tokensUsed} tokens`,
        tokens_used: tokensUsed,
        user_id: userId,
      },
    });

    if (sessionError) {
      console.error("[ai-story-consult] Failed to save session:", sessionError.message);
    }

    const sessionId = (sessionData as { id?: string } | null)?.id ?? null;

    // ----------------------------------------
    // 14. FINALIZE TRACER + RETURN RESPONSE
    // ----------------------------------------
    await tracer?.finish("succeeded", {
      action,
      category,
      specialist: specialistName,
      tokens: tokensUsed,
    });

    return jsonResponse(req, {
      session_id: sessionId,
      conversation_id: conversationId,
      run_id: tracer?.runId ?? null,
      message: {
        id: assistantMessageId,
        role: "assistant",
        content: responseContent,
        routing_category: action === "chat" ? category : `story_${action}`,
        created_at: new Date().toISOString(),
      },
      response: responseContent,
      action,
      tokens_used: tokensUsed,
      metadata: {
        access_level: mappedGuardrailsLevel,
        actor_mode: actorMode,
        response_time_ms: responseTime,
        routing_category: category,
        specialist_used: specialistName,
        run_id: tracer?.runId ?? null,
      },
      context_included: {
        user_info: false,
        health_data: include_health_data === true && recentCheckins.length > 0,
        timeline_entries: timelineEntries.length,
      },
    });
  } catch (error) {
    console.error("[ai-story-consult] Unhandled error:", error);
    return errorResponse(req, "server_error", "An unexpected error occurred", 500);
  }
});
