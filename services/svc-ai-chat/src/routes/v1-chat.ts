/**
 * Omni /v1 ingress — OpenAI + Anthropic compatible facade over the AISHA engine.
 *
 *   POST /v1/chat/completions   (OpenAI)     ─┐
 *   POST /v1/messages           (Anthropic)  ─┤→ ONE pipeline → ONE run:
 *   GET  /v1/models             (discovery)  ─┘   auth → story-bind → admit →
 *                                                 complexity-route → SSE | 202
 *
 * Both POST surfaces funnel through {@link runOmniTurn} so they cannot diverge
 * (§5). Routing (§6.5): tier1/2 → real SSE `chat.completion.chunk` frames
 * (id `chatcmpl-aisha-<runId>`, conversation_id echoed) terminated by
 * `data: [DONE]`; tier3+ (or a complex prompt on a cheap-tier model) → HTTP 202 +
 * `X-Stream-Poll-URL: /reflect/runs/<runId>` (no hanging stream). Admission
 * (fn_admit_clow) gates BEFORE the first byte: deny→402, ask→202. A pre-first-token
 * backend failure returns a non-200 error, never a "successful" empty stream (§7.3).
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { authenticateOmni } from "./omniAuth.js";
import { rpcService } from "../postgrest.js";
import {
  classifyMessageComplexity,
  chooseExecutionStrategy,
  kickOffReflectionWorkflow,
} from "../lib/orchestrationBridge.js";
import { unifiedChatStream, unifiedChat, resolveAvailableModel, selectServiceableSlugs } from "../lib/llmRouter.js";
import type { LlmMessage, LlmProvider, LlmToolSpec, LlmToolResult } from "../lib/llmRouter.js";
import { journalDispatch } from "../lib/dispatchJournal.js";
import { estimateSpendUsd as sharedEstimateSpendUsd, promptCharsOf } from "../lib/spendEstimate.js";
import { mintMcpUserToken, mcpToolsList, mcpToolCall } from "../lib/mcpToolProxy.js";
import { mapBackendKindToProvider, type ClowBackend } from "../reflection/decision.js";
import { detectDataSensitivity, auditResidencyVerdict } from "../lib/governedOrchestration.js";
import { config } from "../config.js";
import { createSafeLogger } from "@aisha/security";
import { withAitgGuardOrRefuse, createAitgRunner } from "@aisha/aitg";

const log = createSafeLogger("svc-ai-chat");

// OWASP AITG output guard — classify the completion (AITG-APP-01 injection
// bleed-through, AITG-APP-12 toxic output) BEFORE the final SSE flush; a violation is
// replaced with a safe refusal. Fail-soft transport (the runner swallows the write
// error and returns null — never breaks the stream). Streaming uses a buffered-flush
// variant: the 200 head is committed on the first token (§7.3), then the accumulated
// text is guarded before it is written out.
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: "svc-ai-chat:v1-chat",
});

/** Model aliases that force the tier3+ async lane regardless of prompt size. */
const HIGH_TIER_ALIASES = new Set(["aisha-deep", "aisha-reasoning"]);

interface OmniMessage {
  role: string;
  content: string;
}

function extractMessages(body: Record<string, unknown>): OmniMessage[] {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  return raw
    .filter((m): m is { role?: unknown; content?: unknown } => !!m && typeof m === "object")
    .filter((m) => typeof m.content === "string")
    .map((m) => ({ role: typeof m.role === "string" ? m.role : "user", content: m.content as string }));
}

function toLlmMessages(messages: OmniMessage[]): LlmMessage[] {
  return messages.map((m) => ({
    role: (["system", "user", "assistant", "developer"].includes(m.role) ? m.role : "user") as LlmMessage["role"],
    content: m.content,
  }));
}

/**
 * Stable conversation id for a turn so the OpenAI + Anthropic surfaces of the
 * SAME logical turn share one run (§4.6 / §5). Explicit body.conversation_id wins;
 * else derived (UUID-shaped) from story + first message.
 */
function deriveConversationId(body: Record<string, unknown>, storyId: string | null, messages: OmniMessage[]): string {
  if (typeof body.conversation_id === "string" && body.conversation_id) return body.conversation_id;
  const h = createHash("sha256").update(`${storyId ?? "nostory"}::${messages[0]?.content ?? ""}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * One run per logical turn. Two protocol calls for the same turn (same derived
 * conversation_id) share the run (§5 dual-protocol same run_id). Short-lived
 * in-memory cache keyed by conversation_id; the durable run lives in ai_runs.
 */
const turnRunCache = new Map<string, { runId: string; at: number }>();
async function ensureTurnRun(conversationId: string, userId: string | null, storyId: string | null): Promise<string> {
  const cached = turnRunCache.get(conversationId);
  if (cached && Date.now() - cached.at < 60_000) return cached.runId;
  const runId = await rpcService<string>("create_ai_run", {
    p_actor_user_id: userId,
    p_kind: "chat",
    p_route_plan: null,
    p_story_id: storyId,
  }).catch(() => null);
  const id = runId ?? createHash("sha256").update(`${conversationId}:${Date.now()}`).digest("hex").slice(0, 32);
  turnRunCache.set(conversationId, { runId: id, at: Date.now() });
  // opportunistic GC
  if (turnRunCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of turnRunCache) if (now - v.at > 60_000) turnRunCache.delete(k);
  }
  return id;
}

/** Stream tier1/2 completions as OpenAI chat.completion.chunk SSE frames. */
async function streamCompletion(
  reply: FastifyReply,
  args: { runId: string; conversationId: string; model: string; provider: LlmProvider; maxTokens: number; messages: OmniMessage[] },
): Promise<void> {
  const { runId, conversationId, model, provider, maxTokens, messages } = args;
  // I1: journal the streaming dispatch (fail-closed) BEFORE the generator is driven /
  // any byte is sent — mirrors streamWithTools. model/provider are the upstream-resolved
  // dispatch values (resolveOmniDispatch), so the journaled model matches what streams.
  await journalDispatch({ model, provider, runId, reason: "omni.v1_chat.stream" });
  const gen = unifiedChatStream({ provider, model, messages: toLlmMessages(messages), maxTokens });

  // Pre-first-token commit (§7.3): a setup/backend failure surfaces as a non-200
  // error BEFORE any byte — never a 200 SSE that emits only [DONE].
  let firstStep: IteratorResult<{ delta: { content?: string }; finishReason?: string }>;
  try {
    firstStep = await gen.next();
  } catch (err) {
    reply.code(502).header("content-type", "application/json").send({
      error: "no_backend",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-AISHA-Run-ID": runId,
    "Access-Control-Allow-Origin": "*",
  });
  const id = `chatcmpl-aisha-${runId}`;
  const created = Math.floor(Date.now() / 1000);
  const frame = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      conversation_id: conversationId,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  // role marker first (OpenAI convention).
  raw.write(frame({ role: "assistant" }, null));

  // Buffered-flush AITG guard: the 200 head is already committed on the first token
  // (§7.3), so we accumulate the completion and run the OWASP output guard over the
  // FULL text before the final flush. A violation flushes a safe refusal instead.
  let fullText = "";
  const collect = (chunk: { delta: { content?: string }; finishReason?: string }) => {
    if (chunk.delta.content) fullText += chunk.delta.content;
  };
  try {
    if (!firstStep.done && firstStep.value) collect(firstStep.value);
    for await (const chunk of gen) collect(chunk);
  } catch (err) {
    log.safeWarn("[v1] stream interrupted post-first-token", { error: err instanceof Error ? err.message : String(err) });
  }
  const guarded = await withAitgGuardOrRefuse(
    {
      runner: aitgRunner,
      buildSha: config.buildSha ?? "dev",
      triggeredBy: "self",
      enabled: ["AITG-APP-01", "AITG-APP-12"],
      service: "svc-ai-chat:v1-chat",
    },
    async () => ({ text: fullText }),
    { text: "I cannot help with that request." },
  );
  if (guarded.violated) {
    log.safeWarn("[v1] AITG output guard violation — refusal flushed", {
      tests: Object.keys(guarded.observations),
    });
  }
  if (guarded.result.text) raw.write(frame({ content: guarded.result.text }, null));
  raw.write(frame({}, "stop"));
  raw.write("data: [DONE]\n\n");
  raw.end();
}

/** Max model↔tool round-trips before the agentic loop returns its best answer. */
const MAX_TOOL_ITERS = 5;

interface SseCtx {
  runId: string;
  conversationId: string;
  model: string;
}

/** Open an OpenAI chat.completion.chunk SSE stream and return write/end helpers. */
function beginSse(
  reply: FastifyReply,
  ctx: SseCtx,
): { write: (delta: Record<string, unknown>, finish: string | null) => void; end: () => void } {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-AISHA-Run-ID": ctx.runId,
    "Access-Control-Allow-Origin": "*",
  });
  const id = `chatcmpl-aisha-${ctx.runId}`;
  const created = Math.floor(Date.now() / 1000);
  return {
    write: (delta, finish) =>
      raw.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: ctx.model,
          conversation_id: ctx.conversationId,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      ),
    end: () => {
      raw.write("data: [DONE]\n\n");
      raw.end();
    },
  };
}

/**
 * tier1/2 WITH MCP tools — a bounded agentic loop. Every tool_call executes on
 * svc-mcp-knowledge UNDER THE USER'S MINTED TOKEN (RFC 8693 mediation), so per-tool
 * authorization + tenant isolation (RLS) are enforced THERE, never re-implemented
 * here, and the caller's PAT is never forwarded. The final answer streams as SSE.
 * The `forceTool` test hook executes one named tool directly — a deterministic
 * proxy/mediation check that does not rely on the local model emitting a tool_call.
 */
async function streamWithTools(
  reply: FastifyReply,
  args: {
    runId: string;
    conversationId: string;
    model: string;
    provider: LlmProvider;
    maxTokens: number;
    messages: OmniMessage[];
    tools: LlmToolSpec[];
    userJwt: string;
    forceTool?: string;
  },
): Promise<void> {
  const { runId, conversationId, model, provider, maxTokens, messages, tools, userJwt, forceTool } = args;
  const llmMessages = toLlmMessages(messages);

  let finalText = "";
  try {
    if (forceTool) {
      // Deterministic proxy/mediation check: execute the named tool, surface its result.
      finalText = await mcpToolCall(userJwt, forceTool, {});
    } else {
      // I1: journal every raw LLM dispatch (no dispatch without a journaled decision).
      await journalDispatch({ model, provider, runId, reason: "omni.v1_chat" });
      let resp = await unifiedChat({ provider, model, messages: llmMessages, maxTokens, tools, toolChoice: "auto" });
      let iters = 0;
      while (resp.isToolCall && resp.toolCalls?.length && iters < MAX_TOOL_ITERS) {
        iters++;
        const toolResults: LlmToolResult[] = [];
        for (const tc of resp.toolCalls) {
          toolResults.push({ toolCallId: tc.id, content: await mcpToolCall(userJwt, tc.name, tc.arguments) });
        }
        // I1: the tool-result follow-up is a second raw dispatch — journal it too.
        await journalDispatch({ model, provider, runId, reason: "omni.v1_chat.tool_followup" });
        resp = await unifiedChat({ provider, model, messages: llmMessages, maxTokens, tools, toolResults });
      }
      finalText = resp.text;
    }
  } catch (err) {
    // Pre-first-token failure → non-200 error, never a 200 SSE with only [DONE] (§7.3).
    reply.code(502).header("content-type", "application/json").send({
      error: "no_backend",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Buffered-flush AITG guard: finalText is already fully assembled (agentic loop
  // terminated), so classify it before opening the stream; on violation flush a safe
  // refusal instead. Pre-first-token (§7.3) failures were already handled above.
  const guarded = await withAitgGuardOrRefuse(
    {
      runner: aitgRunner,
      buildSha: config.buildSha ?? "dev",
      triggeredBy: "self",
      enabled: ["AITG-APP-01", "AITG-APP-12"],
      service: "svc-ai-chat:v1-chat",
    },
    async () => ({ text: finalText }),
    { text: "I cannot help with that request." },
  );
  if (guarded.violated) {
    log.safeWarn("[v1] AITG output guard violation (tools lane) — refusal flushed", {
      tests: Object.keys(guarded.observations),
    });
  }
  finalText = guarded.result.text;

  const sse = beginSse(reply, { runId, conversationId, model });
  sse.write({ role: "assistant" }, null);
  if (finalText) sse.write({ content: finalText }, null);
  sse.write({}, "stop");
  sse.end();
}

/**
 * Parametric backend selection for the interactive (tier1/2) /v1 lane — the SAME
 * capability-availability path the reflection lane uses, instead of a hardcoded
 * provider. Consults `aisha_resolve_clow_backend` (cost_class + ai_model_benchmarks
 * ranking + serviceability + §11 residency) and maps the winning backend_kind →
 * LlmProvider via the canonical decision.ts helper, threading the live key truth
 * (selectServiceableSlugs) so a DB-enabled provider we hold no key for is excluded.
 * §11: a confidential prompt with NO serviceable on-prem backend is REFUSED (403) —
 * never silently sent to a cloud provider. Falls back to resolveAvailableModel
 * (static config-availability) only when the resolver yields nothing AND cloud is allowed.
 */
async function resolveOmniDispatch(
  messages: OmniMessage[],
  requestedModel: string,
  conversationId: string,
  storyId: string | null,
  userId: string | null,
  aiRunId: string | null,
): Promise<
  | { provider: LlmProvider; model: string; maxOutputTokens?: number; inputPricePerM?: number; outputPricePerM?: number }
  | { refuse: { http: number; body: unknown } }
> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const sensitivity = detectDataSensitivity(messages, null);
  // §11 DoD #5: audit the residency verdict (no-op unless confidential).
  auditResidencyVerdict(sensitivity, { userId, aiRunId, surface: "omni" });
  const cloudForbidden = !sensitivity.canUseCloudApis;

  // Capability needs are DERIVED, never hardcoded — the SAME producer the reflection
  // lane uses (derive_clow_needs), so the resolver ranks against the request's REAL
  // needs (write/internet/tools) consistently across surfaces. The only non-derived
  // input is the §11 residency verdict (cloud_forbidden) — itself computed dynamically
  // by detectDataSensitivity. Everything else (allow_local, cost_class, ranking) is the
  // resolver's own dynamic policy.
  // Bounded dynamic-resolution budget (Fix B): the two resolver RPCs share ONE wall-clock
  // deadline. On expiry they abort and the lane degrades to the static fallback / §11 refuse
  // below — never a ~60s hang (2× the 30s per-RPC ceiling) on a slow-but-alive PostgREST.
  const dispatchBudget = new AbortController();
  const budgetTimer = setTimeout(() => dispatchBudget.abort(), config.omniDispatchBudgetMsInteractive);
  const task = { description: lastUser || "chat", task_kind: "chat", story_id: storyId ?? undefined };
  let needs: Record<string, unknown> = {};
  try {
    needs = (await rpcService<Record<string, unknown>>("derive_clow_needs", { p_task: task }, { signal: dispatchBudget.signal })) ?? {};
  } catch (err) {
    log.safeWarn("[v1] derive_clow_needs failed (resolver still runs with base clow)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let top: ClowBackend | null = null;
  try {
    const resolution = await rpcService<{ resolved?: boolean; top?: ClowBackend | null }>(
      "aisha_resolve_clow_backend",
      {
        p_clow: {
          purpose: (lastUser || "chat").slice(0, 200),
          task_kind: "chat",
          needs_write: needs.needs_write,
          needs_internet: needs.needs_internet,
          needs_tools: needs.needs_tools,
          cloud_forbidden: cloudForbidden,
        },
        p_context: {
          session_id: conversationId,
          story_id: storyId,
          serviceable_slugs: selectServiceableSlugs(),
        },
      },
      { signal: dispatchBudget.signal },
    );
    top = resolution?.top ?? null;
  } catch (err) {
    log.safeWarn("[v1] aisha_resolve_clow_backend failed (capability-availability fallback)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(budgetTimer);

  if (top?.model_id) {
    // Resolver picked a serviceable, residency-compliant backend → use it, carrying the
    // resolved model's real capacity + pricing (dynamic clamp + token-aware spend estimate).
    return {
      provider: mapBackendKindToProvider(top),
      model: top.model_id,
      maxOutputTokens: typeof top.max_output_tokens === "number" ? top.max_output_tokens : undefined,
      inputPricePerM: typeof top.input_price_per_m === "number" ? top.input_price_per_m : undefined,
      outputPricePerM: typeof top.output_price_per_m === "number" ? top.output_price_per_m : undefined,
    };
  }
  if (cloudForbidden) {
    // §11 fail-closed: confidential data + no serviceable on-prem backend → refuse.
    // (The resolver hard-excludes cloud when cloud_forbidden=true, so an empty result
    // here means NO compliant backend exists — never fall through to a cloud provider.)
    return { refuse: { http: 403, body: { error: "governance_not_allowed", reason: "no_onprem_backend_for_confidential_data" } } };
  }
  // Cloud permitted + resolver empty/unavailable → static config-availability remap.
  return resolveAvailableModel(requestedModel);
}

/**
 * Admission gate (§6.1): fn_admit_clow → deny (402) / ask (202) / allow. Returns the HTTP
 * response to send, or null to proceed. Fail-CLOSED (GAP D): a governance-gate error
 * returns 503 rather than dispatching ungoverned — symmetric with the reflection path
 * (openclaw_resolve_clow: "cannot proceed without a verdict"). No silent spend/risk bypass.
 * estimate_usd is the projected spend — token-aware on the tier1/2 lane (see estimateSpendUsd).
 */
async function admitClow(args: {
  purpose: string; storyId: string | null; conversationId: string; estimateUsd: number | null;
}): Promise<{ http: number; body: unknown } | null> {
  try {
    const verdict = await rpcService<{ decision?: string; reason?: string }>("fn_admit_clow", {
      p_clow: { purpose: (args.purpose || "chat").slice(0, 200), task_kind: "chat", runtime: "direct_llm", capability_tags: [] },
      p_context: { story_id: args.storyId, session_id: args.conversationId, estimate_usd: args.estimateUsd },
    }, { timeoutMs: config.omniAdmitBudgetMs });
    if (verdict?.decision === "deny") {
      return { http: 402, body: { error: "spend_denied", reason: verdict.reason ?? "admission_denied" } };
    }
    if (verdict?.decision === "ask") {
      return { http: 202, body: { error: "approval_required", reason: verdict.reason ?? "approval_required", status: "pending" } };
    }
  } catch (err) {
    // GAP D: fail-CLOSED. A governance-gate error must NOT let an ungoverned dispatch
    // through — surface a retryable 503 instead of silently bypassing spend+risk admission.
    log.safeError("[v1] fn_admit_clow failed (fail-closed)", { error: err instanceof Error ? err.message : String(err) });
    return { http: 503, body: { error: "governance_unavailable", reason: "admission check failed — refusing to dispatch ungoverned" } };
  }
  return null;
}

/**
 * Token-aware spend estimate (USD) for the RESOLVED model — unblinds the admission gate.
 * Uses the resolved model's per-million pricing from ai_model_registry (the single price-rate
 * source). DD-1: returns null when no rate is known, so admission defers to the DB catalog
 * rather than a synthetic constant. On the tier1/2 lane resolveOmniDispatch supplies the rate.
 */
function estimateSpendUsd(messages: OmniMessage[], maxTokens: number, inputPricePerM?: number, outputPricePerM?: number): number | null {
  return sharedEstimateSpendUsd(promptCharsOf(messages), maxTokens, inputPricePerM, outputPricePerM);
}

/** The single pipeline both /v1/chat/completions and /v1/messages funnel through. */
async function runOmniTurn(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // 1. Auth + fail-closed story binding (§8/§8.5).
  const auth = await authenticateOmni(req.headers.authorization, body);
  if (!auth.ok) return reply.code(auth.http).send(auth.body);

  const messages = extractMessages(body);
  const model = typeof body.model === "string" ? body.model : "aisha-fast";
  const conversationId = deriveConversationId(body, auth.storyId, messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // 1b. Test hook (§5.6 false-positive guard): force the spend gate to deny up front.
  if (req.headers["x-omni-test-force-deny"] === "spend") {
    return reply.code(402).header("content-type", "application/json").send({ error: "spend_denied", reason: "forced_test" });
  }

  // 2. Admission (§6.1) is applied PER LANE below (not here) so the tier1/2 spend estimate
  //    can be token-aware against the ACTUALLY-resolved model. Ordering invariant preserved:
  //    on the tier1/2 lane resolveOmniDispatch runs first, so residency (403) is still decided
  //    before spend (402); the x-omni-test-force-deny hook above still short-circuits up front.

  // 3. Mandatory complexity routing (§6.5): MAX(requested-model-tier, prompt-complexity).
  const complexity = classifyMessageComplexity(lastUser, [], messages);
  const highTier = HIGH_TIER_ALIASES.has(model) || complexity === "complex" || complexity === "deep_analysis";

  // 4. One run per turn (dual-protocol same-turn → same run via conversation_id).
  const runId = await ensureTurnRun(conversationId, auth.userId, auth.storyId);

  if (highTier) {
    // Admission for the async reflection lane (coarse estimate — the reflection's true cost
    // is metered as it runs; this gates obviously-over-budget stories before kickoff).
    const gate = await admitClow({ purpose: lastUser, storyId: auth.storyId, conversationId, estimateUsd: 0.02 });
    if (gate) return reply.code(gate.http).header("content-type", "application/json").send(gate.body);
    // tier3+ → async lane: kick off reflection (best-effort) + 202 + poll URL.
    try {
      const strategy = await chooseExecutionStrategy(
        { description: lastUser, type: "chat", story_id: auth.storyId, agent_slug: "aisha" },
        { session_id: conversationId },
      );
      await kickOffReflectionWorkflow(strategy, { description: lastUser, agent_slug: "aisha" }, auth.storyId).catch(() => null);
    } catch (err) {
      log.safeWarn("[v1] async kickoff failed (still returning 202 handshake)", { error: err instanceof Error ? err.message : String(err) });
    }
    return reply
      .code(202)
      .header("content-type", "application/json")
      .header("X-AISHA-Run-ID", runId)
      .header("X-Stream-Poll-URL", `/reflect/runs/${runId}`)
      .send({ accepted: true, run_id: runId, status: "pending", conversation_id: conversationId });
  }

  // tier1/2 → real SSE stream — parametric backend selection (resolver + §11 residency),
  // no longer a hardcoded provider. Confidential prompt with no on-prem backend → 403.
  const dispatch = await resolveOmniDispatch(messages, model, conversationId, auth.storyId, auth.userId, runId);
  if ("refuse" in dispatch) {
    return reply.code(dispatch.refuse.http).header("content-type", "application/json").send(dispatch.refuse.body);
  }
  // Effective output cap is DYNAMIC: the RESOLVED model's real max_output_tokens (registry).
  // 1024 stays only as the request-omission default; the cap bounds the request so a client
  // cannot demand an unbounded budget (cost/DoS). NULL capacity → conservative config default,
  // never unbounded. The cap is max_output_tokens (NOT context_window — that would over-permit).
  const requestedMaxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0
    ? body.max_tokens : config.omniRequestMaxTokensDefault;
  const maxTokens = Math.min(requestedMaxTokens, dispatch.maxOutputTokens ?? config.omniDefaultMaxOutputTokens);
  // Token-aware admission against the resolved model — residency (403) already cleared above,
  // so spend (402) is decided after it. estimate_usd now scales with the clamped output budget.
  const gate = await admitClow({
    purpose: lastUser,
    storyId: auth.storyId,
    conversationId,
    estimateUsd: estimateSpendUsd(messages, maxTokens, dispatch.inputPricePerM, dispatch.outputPricePerM),
  });
  if (gate) return reply.code(gate.http).header("content-type", "application/json").send(gate.body);

  // MCP tool execution (PR-B — RFC 8693 mediation): forward a MINTED user-scoped
  // token (sub=user_id, role=authenticated — never service_role), NEVER the caller's
  // PAT. A scoped/legacy PAT with no user_id mints nothing ⇒ fail-closed (tool-less
  // turn), so an unscoped/service credential is never sent downstream. The
  // x-omni-test-force-tool hook exercises the proxy + downstream user-identity auth
  // deterministically (local models rarely emit a tool_call).
  const forceTool = typeof req.headers["x-omni-test-force-tool"] === "string"
    ? (req.headers["x-omni-test-force-tool"] as string)
    : undefined;
  const wantsTools = forceTool != null || (Array.isArray(body.tools) && body.tools.length > 0);
  if (wantsTools) {
    const userJwt = mintMcpUserToken(auth.userId, auth.storyId);
    if (userJwt) {
      const tools = forceTool ? [] : await mcpToolsList(userJwt);
      if (forceTool || tools.length > 0) {
        return streamWithTools(reply, {
          runId,
          conversationId,
          model: dispatch.model,
          provider: dispatch.provider,
          maxTokens,
          messages,
          tools,
          userJwt,
          forceTool,
        });
      }
    }
  }
  return streamCompletion(reply, { runId, conversationId, model: dispatch.model, provider: dispatch.provider, maxTokens, messages });
}

/** Aisha virtual model tiers exposed via GET /v1/models (discovery, PAT-auth, UNGATED). */
const AISHA_MODEL_TIERS = ["aisha-fast", "aisha-balanced", "aisha-deep", "aisha-reasoning"];

export async function v1ChatRoutes(app: FastifyInstance): Promise<void> {
  // OpenAI + Anthropic surfaces — ONE pipeline.
  app.post("/v1/chat/completions", async (req, reply) => runOmniTurn(req, reply));
  app.post("/v1/messages", async (req, reply) => runOmniTurn(req, reply));

  // Discovery — PAT-authenticated but quota-UNGATED (§5.5): never charges, never denies on spend.
  app.get("/v1/models", async (req, reply) => {
    const auth = await authenticateOmni(req.headers.authorization, null);
    if (!auth.ok) return reply.code(auth.http).send(auth.body);
    const created = Math.floor(Date.now() / 1000);
    return reply.send({
      object: "list",
      data: AISHA_MODEL_TIERS.map((id) => ({ id, object: "model", created, owned_by: "aisha" })),
    });
  });
}
