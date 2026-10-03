/**
 * Workflow Engine — Dynamic graph-based execution for AI agent pipelines.
 *
 * Instead of a hardcoded classify → specialist → main_agent → simplicity
 * pipeline, this engine executes a declarative workflow graph stored in the
 * `ai_workflow_definitions` table.
 *
 * Supported node types:
 *   - `classifier`  — LLM call that routes to different branches via transitions
 *   - `agent`       — Standard LLM call (specialist, main_agent, simplicity, etc.)
 *   - `parallel`    — Fan-out to multiple agent nodes in parallel, merge results
 *   - `critic`      — Review response quality and optionally loop back
 *   - `guardrails`  — Apply output guardrails (restriction checks, PII masking)
 *   - `synthesis`   — Synthesize findings from prior nodes into a concrete implementation spec before delegation
 *
 * @module
 */

import type { PostgrestClient } from "./deps.js";
import type { Tracer } from "./tracer.js";
import type { LlmToolSpec, LlmToolResult } from "./llmRouter.js";
import { resolveAvailableModel, unifiedChat, type UnifiedChatResult } from "./llmRouter.js";
import { recordExecutionDecision, toExecutionDecision } from "../reflection/decision.js";
import { detectLazyDelegation } from "./guardrails-config.js";
import { createCostAggregator, type CostSummary } from "./costAggregator.js";
import type { MemoryManager } from "./memoryManager.js";
import {
  createDecisionChain,
  preflightCheckWorkflow,
  type DecisionChain,
  type DecisionSourceType,
} from "./decisionProvenance.js";
import { getRegistry } from "@aisha/llm-dispatch";
import { resolveDefaultModel } from "./defaultModel.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// =============================================================================
// Types — Workflow Graph Schema
// =============================================================================

/** A single node in the workflow graph. */
export interface WorkflowNode {
  type: "classifier" | "agent" | "parallel" | "critic" | "guardrails" | "synthesis";
  /** Agent name (from agent_configurations) or special token like `__from_category__`. */
  agent?: string;
  description?: string;
  /** Next node key (null = terminal). */
  next?: string | null;
  /** Transitions map for classifier nodes (category → node key). */
  transitions?: Record<string, string>;
  /** For parallel nodes: child node keys or `__from_categories__` token. */
  children?: string | string[];
  /** For parallel nodes: how to merge results. */
  merge_strategy?: "concatenate" | "best" | "structured";
  /** For critic nodes: which node to re-execute on low score. */
  target_node?: string;
  /** Node-specific configuration. */
  config?: Record<string, unknown>;
}

/** Complete workflow graph definition. */
export interface WorkflowGraph {
  /** Entry node key. */
  entry: string;
  /** Map of node keys to node definitions. */
  nodes: Record<string, WorkflowNode>;
}

/** Agent configuration derived from channel config (channel-centric architecture). */
export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  instructions: string;
  temperature: number;
  max_tokens: number;
  routing_category?: string;
  model_settings?: {
    reasoning?: { effort: "low" | "medium" | "high" };
    [key: string]: unknown;
  };
}

/** Context passed through the workflow execution. */
export interface WorkflowContext {
  /** The user's message. */
  message: string;
  /** Conversation history. */
  conversationHistory: Array<{ role: string; content: string }>;
  /** Recipient's language as a BCP47-style locale (any — not a cs/en allowlist). */
  language: string;
  /** System prompt base from main agent. */
  systemPromptBase: string;
  /** Restriction prompt from guardrails. */
  restrictionPrompt: string;
  /** Memory context string (from Phase 4). */
  memoryContext: string;
  /** Guardrails config object. */
  guardrails: Record<string, unknown>;
  /** OpenAI API key. */
  openaiApiKey?: string;
  /** Available tool specs for main agent. */
  agentToolSpecs: LlmToolSpec[];
  /** Tool executor instance. */
  toolExecutor: ToolExecutorInstance | null;
  /** Memory manager instance (nullable). */
  memoryManager: MemoryManager | null;
}

/** Result from executing a single node. */
interface NodeResult {
  text: string;
  tokensInput: number;
  tokensOutput: number;
  category?: string;
  categories?: string[];
  transitionKey?: string;
  toolIterations?: number;
  metadata?: Record<string, unknown>;
}

/** Overall workflow execution result. */
export interface WorkflowResult {
  /** Final assistant content. */
  content: string;
  /** Total input tokens across all nodes. */
  totalTokensInput: number;
  /** Total output tokens across all nodes. */
  totalTokensOutput: number;
  /** Classification category. */
  category: string;
  /** Specialist agent name used. */
  specialistUsed: string;
  /** Number of tool call iterations in main agent. */
  toolIterationsUsed: number;
  /** Number of workflow nodes executed. */
  nodesExecuted: number;
  /** Whether critic revised the response. */
  criticRevised: boolean;
  /** Workflow definition ID (if loaded from DB). */
  workflowId?: string;
  /** Decision provenance chain summary for this run. */
  provenanceSummary?: ReturnType<DecisionChain["toTraceSummary"]>;
  /** Preflight check warnings (non-fatal). */
  preflightWarnings?: string[];
  /** Per-model and per-agent cost breakdown for this run. */
  costSummary?: CostSummary;
}

/** Tool executor interface matching the public API of createToolExecutor(). */
export interface ToolExecutorInstance {
  executeAll(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): Promise<
    Array<{ toolCallId: string; content: string; ok: boolean; durationMs: number }>
  >;
  /** @deprecated Use loadToolsByNames instead. */
  loadToolsForAgent(agentId: string): Promise<unknown[]>;
  loadToolsByNames(toolNames: string[]): Promise<unknown[]>;
  toOpenAIToolSpecs(defs: unknown[]): LlmToolSpec[];
}

/**
 * Hint from Aisha orchestration layer for model/tools/stop condition overrides.
 *
 * Populated from `routeViaAisha()` → `route_task` RPC. The workflow engine uses
 * these hints to apply risk-based model selection, tool filtering, and loop limits
 * without replacing the existing agent pipeline.
 *
 * Phase 0.4: `forcedCategory` enables route_task to bypass the LLM classify node.
 *
 * @see orchestrationBridge.ts — routeViaAisha()
 */
export interface RoutePlanHint {
  /** Recommended model for the primary agent (overrides agent_configurations default). */
  primaryModel?: string;
  /** Apply primaryModel to all workflow LLM nodes, not only the main agent. */
  forceModelAcrossWorkflow?: boolean;
  /** Allowed tools whitelist. If provided, only these tools are passed to agents. */
  toolsAllowlist?: string[];
  /** Maximum tool iterations (overrides node config if lower). */
  maxToolIterations?: number;
  /** Whether compliance gate is required after main agent execution. */
  mustPassCompliance?: boolean;
  /** Whether human approval is needed before executing changes. */
  requireHumanApproval?: boolean;
  /** Phase 0.4: If set, skip LLM classify node and use this category directly. */
  forcedCategory?: string;
  /** Phase 0.4: Task kind from route_task for metadata/observability. */
  taskKind?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function agentToChatOpts(agent: AgentConfig, openaiApiKey: string | undefined) {
  // Capability-availability (ZADÁNÍ §2.4): remap to a CONFIGURED backend so the
  // agent runs on whichever provider the instance has — never "No available backend".
  const { model, provider } = resolveAvailableModel(agent.model);
  return {
    provider,
    model,
    temperature: agent.temperature,
    maxTokens: agent.max_tokens,
    reasoningEffort: agent.model_settings?.reasoning?.effort,
    openaiApiKey: openaiApiKey ?? undefined,
  };
}

// =============================================================================
// Default Workflow (fallback when no DB workflow is available)
// =============================================================================

export const DEFAULT_CHAT_WORKFLOW: WorkflowGraph = {
  entry: "classify",
  nodes: {
    classify: {
      type: "classifier",
      agent: "classify",
      transitions: {
        __default__: "specialist",
        Else: "main_agent",
      },
    },
    specialist: {
      type: "agent",
      agent: "__from_category__",
      next: "main_agent",
      config: { inject_as: "developer_context", max_history: 10 },
    },
    main_agent: {
      type: "agent",
      agent: "main_agent",
      next: "simplicity",
      config: { enable_tools: true, max_tool_iterations: 5, max_history: 10 },
    },
    simplicity: {
      type: "agent",
      agent: "simplicity",
      next: null,
      config: { condition: "guardrails.useSimplicityAgent && content.length > 200", fallthrough: true },
    },
  },
};

// =============================================================================
// Workflow Engine
// =============================================================================

export interface WorkflowEngineOptions {
  /** PostgREST service client (for saving node runs). */
  pgrestService: PostgrestClient;
  /** Tracer for observability. */
  tracer: Tracer;
  /** Agent configurations loaded from DB. */
  agents: AgentConfig[];
  /** The run_id for this execution (from tracer). Null when tracing is degraded. */
  runId: string | null;
  /** Debug event callback. */
  addDebug: (stage: string, message: string, level?: "info" | "warn" | "error") => void;
  /** Optional routing hints from Aisha orchestration layer. */
  routePlanHint?: RoutePlanHint | null;
}

/**
 * Create a workflow engine instance.
 *
 * @param options - Engine configuration
 * @returns Engine with `execute()` method
 */
export function createWorkflowEngine(options: WorkflowEngineOptions) {
  const { pgrestService, tracer, agents, runId, addDebug, routePlanHint } = options;

  // Phase A: Decision provenance chain — tracks all decisions and prevents silent overrides
  const decisionChain = createDecisionChain();

  // Phase 5: Per-model, per-agent cost tracking
  const costAggregator = createCostAggregator();

  // E0.2b / I3 — no dispatch without a journaled decision. workflowEngine is the
  // SECOND run loop; its agents carry their model in config (so the decision's
  // resolution_source is 'model_override'), but every LLM call must still mint an
  // ai_decisions row so AISHA's authority is honored uniformly across both loops.
  // journaledLlm wraps unifiedChat with that journaling and fails closed if the
  // durable row cannot be written — no site dispatches a raw or unpersisted call.
  async function journaledLlm(
    chatOpts: Parameters<typeof unifiedChat>[0],
  ): Promise<UnifiedChatResult> {
    await recordExecutionDecision(
      toExecutionDecision(
        { model: chatOpts.model, provider: chatOpts.provider, resolution_source: "model_override" },
        { runtime: "direct_llm" },
      ),
      runId,
    );
    return unifiedChat(chatOpts);
  }

  // Log route plan hint if present
  if (routePlanHint) {
    const hints: string[] = [];
    if (routePlanHint.primaryModel) hints.push(`model=${routePlanHint.primaryModel}`);
    if (routePlanHint.toolsAllowlist) hints.push(`tools=${routePlanHint.toolsAllowlist.length}`);
    if (routePlanHint.maxToolIterations) hints.push(`maxLoops=${routePlanHint.maxToolIterations}`);
    if (routePlanHint.mustPassCompliance) hints.push('compliance=required');
    if (routePlanHint.requireHumanApproval) hints.push('humanApproval=required');
    if (routePlanHint.forcedCategory) hints.push(`forcedCategory=${routePlanHint.forcedCategory}`);
    if (routePlanHint.taskKind) hints.push(`taskKind=${routePlanHint.taskKind}`);
    addDebug('workflow.routePlan', `Aisha route plan active: ${hints.join(', ')}`);

    // Pre-check: verify route plan model has a registered backend
    if (routePlanHint.primaryModel) {
      const registry = getRegistry();
      const allBackends = registry.getAllBackends();
      const canServe = allBackends.some((b) => b.canServe(routePlanHint.primaryModel!));
      if (canServe) {
        addDebug('workflow.routePlan', `Model "${routePlanHint.primaryModel}" has registered backend`);
      } else {
        addDebug('workflow.routePlan', `WARNING: No registered backend for route plan model "${routePlanHint.primaryModel}" — router fallback will apply`, 'warn');
      }
    }

    // Record route plan decisions with provenance
    if (routePlanHint.primaryModel) {
      decisionChain.record(
        "model_selection",
        routePlanHint.primaryModel,
        "orchestration_policy",
        "route_task",
        `Route plan model: ${routePlanHint.primaryModel}`,
      );
    }
    if (routePlanHint.forcedCategory) {
      decisionChain.record(
        "category",
        routePlanHint.forcedCategory,
        "orchestration_policy",
        "route_task",
        `Route plan forced category: ${routePlanHint.forcedCategory}`,
      );
    }
    if (routePlanHint.mustPassCompliance) {
      decisionChain.record(
        "compliance_gate",
        "required",
        "compliance_policy",
        "route_task",
        "Route plan mandates compliance gate",
      );
    }
  }

  const getAgent = (name: string): AgentConfig | undefined =>
    agents.find((a) => a.name === name);

  const getAgentByCategory = (category: string): AgentConfig | undefined =>
    agents.find((a) => a.routing_category === category);

  // Track execution metrics
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let nodesExecuted = 0;

  // --------------------------------------------------
  // Node Executors
  // --------------------------------------------------

  /**
   * Execute a classifier node — sends message to classify agent, parses category.
   * Phase 0.4: If routePlanHint.forcedCategory is set, skip the LLM call and
   * return the forced category directly — saves latency and tokens.
   */
  async function executeClassifier(
    node: WorkflowNode,
    ctx: WorkflowContext,
  ): Promise<NodeResult> {
    // Phase 0.4: Skip LLM classify when route_task provides a forced category
    if (routePlanHint?.forcedCategory) {
      const forced = routePlanHint.forcedCategory;
      addDebug("workflow.classifier", `Route plan forced category: ${forced} (LLM classify skipped)`);
      tracer.event("route_plan_classify_bypass", forced, {
        task_kind: routePlanHint.taskKind,
        source: "route_task",
      });
      return {
        text: "",
        tokensInput: 0,
        tokensOutput: 0,
        category: forced,
        categories: [forced],
      };
    }

    const agentName = node.agent ?? "classify";
    const agent = getAgent(agentName);
    if (!agent) {
      addDebug("workflow.classifier", `Agent '${agentName}' not found, using fallback`, "warn");
      return { text: "", tokensInput: 0, tokensOutput: 0, category: "Else", categories: ["Else"] };
    }

    const classifyInput = `Classify the following user message. Respond in json.\n\nUser message: ${ctx.message}`;
    const multiCategory = node.config?.multi_category === true;
    const classifierModel = routePlanHint?.forceModelAcrossWorkflow && routePlanHint.primaryModel
      ? routePlanHint.primaryModel
      : agent.model || (await resolveDefaultModel(ctx.message));
    const effectiveClassifierAgent = classifierModel !== agent.model
      ? { ...agent, model: classifierModel }
      : agent;
    const opts = agentToChatOpts(effectiveClassifierAgent, ctx.openaiApiKey);

    if (classifierModel !== agent.model) {
      addDebug("workflow.routePlan", `Classifier model override: ${agent.model} → ${classifierModel}`);
    }

    const response = await tracer.span("route_decision", agentName, opts.provider, "unifiedChat", async () => {
      const res = await journaledLlm({
        ...opts,
        model: classifierModel,
        systemPrompt: agent.instructions + (multiCategory ? "\nYou may return multiple categories as a JSON array under 'categories' key." : ""),
        messages: [{ role: "user", content: classifyInput }],
        maxTokens: agent.max_tokens || 100,
        jsonMode: true,
      });
      tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
      costAggregator.record(classifierModel, agentName, res.usage.inputTokens, res.usage.outputTokens);
      return res;
    });

    let category = "Else";
    let categories: string[] = [];

    try {
      const parsed = JSON.parse(response.text || "{}");
      if (parsed.category) category = parsed.category;
      if (Array.isArray(parsed.categories)) {
        categories = parsed.categories;
        if (categories.length > 0 && !category) category = categories[0];
      } else {
        categories = [category];
      }
    } catch {
      addDebug("workflow.classifier", "Classification output was not valid JSON", "warn");
    }

    addDebug("workflow.classifier", `Classified as: ${category} (categories: ${categories.join(", ")})`);

    // Phase A: Record classifier decision with provenance
    decisionChain.record(
      "category",
      category,
      "model_heuristic",
      `classify:${agentName}`,
      `LLM classified message as '${category}'`,
    );

    return {
      text: response.text || "",
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      category,
      categories,
    };
  }

  /**
   * Execute an agent node — calls the specified agent and returns its text output.
   */
  async function executeAgent(
    nodeId: string,
    node: WorkflowNode,
    ctx: WorkflowContext,
    specialistContext: string,
    category: string,
  ): Promise<NodeResult> {
    let agentName = node.agent ?? nodeId;

    // Resolve special tokens
    if (agentName === "__from_category__") {
      const catAgent = getAgentByCategory(category);
      if (!catAgent) {
        addDebug("workflow.agent", `No specialist for category '${category}', skipping`, "warn");
        return { text: "", tokensInput: 0, tokensOutput: 0 };
      }
      agentName = catAgent.name;
    }

    const agent = getAgent(agentName);
    if (!agent) {
      // Fallthrough if node config allows it
      if (node.config?.fallthrough) {
        addDebug("workflow.agent", `Agent '${agentName}' not found, fallthrough`, "warn");
        return { text: specialistContext || "", tokensInput: 0, tokensOutput: 0 };
      }
      addDebug("workflow.agent", `Agent '${agentName}' not found`, "warn");
      return { text: "", tokensInput: 0, tokensOutput: 0 };
    }

    // AISHA BRIDGE: Apply model override from route plan for primary agent,
    // or across all workflow nodes when an explicit debug override is active.
    const isPrimaryAgent = (nodeId === "main_agent" || agentName === "main_agent");
    let effectiveAgent = agent;
    const shouldApplyRoutePlanModel = Boolean(
      routePlanHint?.primaryModel &&
      routePlanHint.primaryModel !== agent.model &&
      (routePlanHint.forceModelAcrossWorkflow || isPrimaryAgent)
    );
    if (shouldApplyRoutePlanModel && routePlanHint?.primaryModel) {
      effectiveAgent = { ...agent, model: routePlanHint.primaryModel };
      addDebug("workflow.routePlan", `Model override: ${agent.model} → ${routePlanHint.primaryModel} (risk-based)`);
      tracer.event("route_plan_override", "model", {
        original: agent.model,
        override: routePlanHint.primaryModel,
        agent: agentName,
      });
      // Phase A: Record model override with provenance (orchestration overrides agent config)
      decisionChain.record(
        `model_selection:${agentName}`,
        routePlanHint.primaryModel,
        "orchestration_policy",
        "route_task",
        `Route plan override: ${agent.model} → ${routePlanHint.primaryModel} for ${agentName}`,
      );
    }

    const opts = agentToChatOpts(effectiveAgent, ctx.openaiApiKey);
    const maxHistory = (node.config?.max_history as number) ?? 20;
    const injectAs = (node.config?.inject_as as string) ?? null;
    const enableTools = node.config?.enable_tools === true;

    // Check condition for conditional nodes (e.g. simplicity)
    if (node.config?.condition) {
      const condStr = node.config.condition as string;
      // Simple condition evaluation: check for guardrails flags and content length
      const shouldRun = evaluateNodeCondition(condStr, ctx.guardrails, specialistContext);
      if (!shouldRun) {
        addDebug("workflow.agent", `Condition not met for '${agentName}', skipping`);
        return { text: specialistContext || "", tokensInput: 0, tokensOutput: 0 };
      }
    }

    // Build messages array
    const messages = [
      ...ctx.conversationHistory.slice(-maxHistory).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      // Inject specialist context if available
      ...(injectAs === "developer_context" && specialistContext
        ? [{ role: "developer" as const, content: `[Expert context from ${agentName}]: ${specialistContext}` }]
        : []),
      // If this is the main agent, inject any prior specialist context
      ...(nodeId === "main_agent" && specialistContext && injectAs !== "developer_context"
        ? [{ role: "developer" as const, content: `[Specialist context]: ${specialistContext}` }]
        : []),
      { role: "user" as const, content: ctx.message },
    ];

    // Build system prompt
    let systemPrompt = agent.instructions;
    if (nodeId === "main_agent" || agentName === "main_agent") {
      systemPrompt = ctx.systemPromptBase + ctx.memoryContext + "\n\n" + ctx.restrictionPrompt;

      // Phase 0.4: Inject compliance directive when route_task mandates it
      if (routePlanHint?.mustPassCompliance) {
        systemPrompt += "\n\n## COMPLIANCE DIRECTIVE (Aisha Dirigent)\n"
          + "This interaction has been flagged for compliance review. "
          + "Ensure your response adheres strictly to platform rules and guidelines. "
          + "Avoid speculative advice, unverified claims, and off-topic content.";
        addDebug("workflow.routePlan", "Compliance directive injected into system prompt");
      }
    }

    // Determine tools
    let tools = enableTools && ctx.agentToolSpecs.length > 0 ? ctx.agentToolSpecs : undefined;

    // AISHA BRIDGE: Filter tools by route plan allowlist
    if (tools && routePlanHint?.toolsAllowlist && routePlanHint.toolsAllowlist.length > 0) {
      const originalCount = tools.length;
      tools = tools.filter(t => routePlanHint.toolsAllowlist!.includes(t.function.name));
      if (tools.length !== originalCount) {
        addDebug("workflow.routePlan", `Tools filtered: ${tools.length}/${originalCount} allowed by route plan`);
      }
    }

    // Execute LLM call with tool loop
    let finalResponse = await tracer.span("llm_call", agentName, opts.provider, "unifiedChat", async () => {
      const res = await journaledLlm({
        ...opts,
        model: effectiveAgent.model,
        systemPrompt,
        messages,
        maxTokens: effectiveAgent.max_tokens || 1500,
        tools,
      });
      tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
      costAggregator.record(effectiveAgent.model, agentName, res.usage.inputTokens, res.usage.outputTokens);
      return res;
    });

    let resultTokensIn = finalResponse.usage.inputTokens;
    let resultTokensOut = finalResponse.usage.outputTokens;
    let toolIterations = 0;

    // Tool call loop (only for nodes with tools enabled)
    const nodeMaxIter = (node.config?.max_tool_iterations as number) ?? 5;
    // AISHA BRIDGE: Cap tool iterations by route plan limit (if lower)
    const maxToolIterations = routePlanHint?.maxToolIterations
      ? Math.min(nodeMaxIter, routePlanHint.maxToolIterations)
      : nodeMaxIter;
    while (
      enableTools &&
      finalResponse.isToolCall &&
      finalResponse.toolCalls &&
      toolIterations < maxToolIterations &&
      ctx.toolExecutor
    ) {
      toolIterations++;
      addDebug("workflow.tools", `Tool iteration ${toolIterations}: ${finalResponse.toolCalls.length} call(s)`);

      const toolCallInputs = finalResponse.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }));

      const toolResults = await ctx.toolExecutor.executeAll(toolCallInputs);

      const pendingToolResults: LlmToolResult[] = toolResults.map((r) => ({
        toolCallId: r.toolCallId,
        content: r.content,
      }));

      finalResponse = await tracer.span(
        "llm_call",
        `${agentName}:tool_followup_${toolIterations}`,
        opts.provider,
        "unifiedChat",
        async () => {
          const res = await journaledLlm({
            ...opts,
            model: effectiveAgent.model,
            systemPrompt,
            messages,
            maxTokens: effectiveAgent.max_tokens || 1500,
            tools,
            toolResults: pendingToolResults,
          });
          tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
          costAggregator.record(effectiveAgent.model, agentName, res.usage.inputTokens, res.usage.outputTokens);
          return res;
        },
      );

      resultTokensIn += finalResponse.usage.inputTokens;
      resultTokensOut += finalResponse.usage.outputTokens;
    }

    if (toolIterations > 0) {
      addDebug("workflow.tools", `Tool loop completed after ${toolIterations} iteration(s)`);

      // Save tool context to session memory
      if (ctx.memoryManager) {
        try {
          await ctx.memoryManager.setSessionKey("last_tool_context", {
            iterations: toolIterations,
            tools_used: (finalResponse.toolCalls ?? []).map((tc: { name: string }) => tc.name),
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Non-blocking
        }
      }
    }

    return {
      text: finalResponse.text || "",
      tokensInput: resultTokensIn,
      tokensOutput: resultTokensOut,
      toolIterations,
    };
  }

  /**
   * Execute a parallel fan-out node — runs multiple specialist agents in parallel.
   */
  async function executeParallel(
    node: WorkflowNode,
    ctx: WorkflowContext,
    categories: string[],
  ): Promise<NodeResult> {
    const timeoutMs = (node.config?.timeout_ms as number) ?? 15000;
    const mergeStrategy = node.merge_strategy ?? "concatenate";

    // Resolve children
    let childAgents: AgentConfig[] = [];
    if (node.children === "__from_categories__") {
      childAgents = categories
        .map((cat) => getAgentByCategory(cat))
        .filter((a): a is AgentConfig => a != null);
    } else if (Array.isArray(node.children)) {
      childAgents = node.children
        .map((name) => getAgent(name))
        .filter((a): a is AgentConfig => a != null);
    }

    if (childAgents.length === 0) {
      addDebug("workflow.parallel", "No agents for parallel execution, skipping");
      return { text: "", tokensInput: 0, tokensOutput: 0 };
    }

    addDebug("workflow.parallel", `Fan-out to ${childAgents.length} agents: ${childAgents.map((a) => a.name).join(", ")}`);
    tracer.event("parallel_fanout", `fan-out:${childAgents.length}`, {
      agents: childAgents.map((a) => a.name),
      categories,
    });

    // Execute agents in parallel with timeout
    const parallelPromises = childAgents.map(async (agent) => {
      const opts = agentToChatOpts(agent, ctx.openaiApiKey);
      const maxHistory = 10;
      const messages = [
        ...ctx.conversationHistory.slice(-maxHistory).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: ctx.message },
      ];

      try {
        const response = await tracer.span("llm_call", agent.name, opts.provider, "unifiedChat", async () => {
          const fallbackModel = agent.model || (await resolveDefaultModel(ctx.message));
          const res = await journaledLlm({
            ...opts,
            model: fallbackModel,
            systemPrompt: agent.instructions,
            messages,
            maxTokens: agent.max_tokens || 1000,
          });
          tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
          costAggregator.record(fallbackModel, agent.name, res.usage.inputTokens, res.usage.outputTokens);
          return res;
        });

        return {
          agent: agent.name,
          text: response.text || "",
          tokensInput: response.usage.inputTokens,
          tokensOutput: response.usage.outputTokens,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        addDebug("workflow.parallel", `Agent '${agent.name}' failed: ${errMsg}`, "warn");
        return { agent: agent.name, text: "", tokensInput: 0, tokensOutput: 0 };
      }
    });

    // Race with timeout
    const results = await Promise.race([
      Promise.all(parallelPromises),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Parallel timeout")), timeoutMs)),
    ]).catch(() => {
      addDebug("workflow.parallel", "Parallel execution timed out, using partial results", "warn");
      return [] as Array<{ agent: string; text: string; tokensInput: number; tokensOutput: number }>;
    });

    // Merge results
    let mergedText = "";
    let sumTokensIn = 0;
    let sumTokensOut = 0;

    for (const r of results) {
      sumTokensIn += r.tokensInput;
      sumTokensOut += r.tokensOutput;
    }

    if (mergeStrategy === "concatenate") {
      mergedText = results
        .filter((r) => r.text.length > 0)
        .map((r) => `[${r.agent}]: ${r.text}`)
        .join("\n\n");
    } else if (mergeStrategy === "best") {
      // Pick the longest response
      const best = results.reduce((a, b) => (a.text.length > b.text.length ? a : b), results[0]);
      mergedText = best?.text ?? "";
    } else {
      // structured — wrap in JSON
      mergedText = JSON.stringify(results.map((r) => ({ agent: r.agent, context: r.text })));
    }

    addDebug("workflow.parallel", `Merged ${results.length} results (${mergedText.length} chars)`);

    return { text: mergedText, tokensInput: sumTokensIn, tokensOutput: sumTokensOut };
  }

  /**
   * Execute a critic node — evaluate the current response and optionally loop back.
   */
  async function executeCritic(
    node: WorkflowNode,
    ctx: WorkflowContext,
    currentContent: string,
  ): Promise<NodeResult & { shouldRetry: boolean }> {
    const threshold = (node.config?.threshold as number) ?? 0.7;
    const maxIterations = (node.config?.max_iterations as number) ?? 2;
    // Capability-availability (ZADÁNÍ §2.4): remap to a CONFIGURED backend.
    const { model: criticModel, provider } = resolveAvailableModel(
      (node.config?.model as string) ?? (await resolveDefaultModel()),
    );
    const criticPrompt = `You are a quality reviewer for AI assistant responses.

Evaluate the following response for:
1. Relevance to the user's question
2. Factual accuracy and groundedness
3. Safety and appropriateness
4. Coherence and helpful structure

User message: ${ctx.message}

AI Response to review:
${currentContent}

Respond in JSON with: { "score": 0.0-1.0, "pass": true/false, "feedback": "brief improvement notes" }`;

    const response = await tracer.span("critic_review", "critic", provider, "unifiedChat", async () => {
      const res = await journaledLlm({
        provider,
        model: criticModel,
        systemPrompt: "You are a strict quality evaluator. Respond only in JSON.",
        messages: [{ role: "user", content: criticPrompt }],
        maxTokens: 200,
        jsonMode: true,
        openaiApiKey: ctx.openaiApiKey,
      });
      tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
      costAggregator.record(criticModel, "critic", res.usage.inputTokens, res.usage.outputTokens);
      return res;
    });

    let score = 1.0;
    let pass = true;
    let feedback = "";

    try {
      const parsed = JSON.parse(response.text || "{}");
      score = typeof parsed.score === "number" ? parsed.score : 1.0;
      pass = parsed.pass !== false && score >= threshold;
      feedback = parsed.feedback || "";
    } catch {
      addDebug("workflow.critic", "Critic output was not valid JSON — failing closed (pass=false)", "warn");
      pass = false;
    }

    addDebug("workflow.critic", `Score: ${score.toFixed(2)}, pass: ${pass}, feedback: ${feedback.substring(0, 100)}`);
    tracer.event("critic_review", "evaluation", { score, pass, feedback: feedback.substring(0, 200) });

    return {
      text: feedback,
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      shouldRetry: !pass,
      metadata: { score, pass, feedback },
    };
  }

  // --------------------------------------------------
  // Condition Evaluator (simple, safe)
  // --------------------------------------------------

  /**
   * Execute a synthesis node — reads findings from prior nodes (specialist context)
   * and produces a concrete implementation spec before delegation to an executor agent.
   *
   * Prevents "lazy delegation" by requiring the synthesis output to contain
   * actionable specifics rather than vague instructions like "fix based on findings".
   */
  async function executeSynthesis(
    nodeId: string,
    node: WorkflowNode,
    ctx: WorkflowContext,
    specialistContext: string,
  ): Promise<NodeResult> {
    const synthesisModel = (node.config?.model as string) ?? (await resolveDefaultModel());
    const agentName = node.agent ?? "synthesis";
    const agent = getAgent(agentName);

    const synthesisPrompt = `You are a senior engineering coordinator (Dirigent).

Below are the findings gathered from specialist agents during prior workflow steps.
Your task is to synthesize these findings into a CONCRETE implementation specification.

## Requirements for your output:
1. List SPECIFIC files to modify (exact paths)
2. Describe EXACT changes per file (not "fix the issue" but "add parameter X to function Y")
3. Define acceptance criteria (what tests must pass, what behavior changes)
4. Identify risks and rollback steps

## Anti-patterns you MUST avoid:
- "Fix based on the findings above" — TOO VAGUE
- "Implement the suggested changes" — NO SPECIFICS
- "Apply the recommendations" — LAZY DELEGATION

## Specialist Findings:
${specialistContext}

## User's Original Request:
${ctx.message}

Produce a structured implementation spec in markdown format.`;

    const systemPrompt = agent?.instructions ??
      "You are a synthesis coordinator. Produce concrete, actionable implementation specifications. Never delegate vaguely.";

    const preferredModel = routePlanHint?.forceModelAcrossWorkflow && routePlanHint.primaryModel
      ? routePlanHint.primaryModel
      : synthesisModel;
    // Capability-availability (ZADÁNÍ §2.4): remap to a CONFIGURED backend.
    const { model: effectiveModel, provider } = resolveAvailableModel(preferredModel);

    // event_type 'llm_call': a synthesis node IS an LLM call (unifiedChat). The
    // "synthesis" identity is preserved in agentName + operation. ('synthesis'
    // was never an ai_event_type member, so this span's trace row was being
    // dropped — insert_ai_trace_event's enum cast threw and tracer swallowed it.)
    const response = await tracer.span("llm_call", agentName, provider, "unifiedChat", async () => {
      const res = await journaledLlm({
        provider,
        model: effectiveModel,
        systemPrompt,
        messages: [{ role: "user", content: synthesisPrompt }],
        maxTokens: agent?.max_tokens ?? 2000,
        openaiApiKey: ctx.openaiApiKey,
      });
      tracer.addTokens(res.usage.inputTokens, res.usage.outputTokens);
      costAggregator.record(effectiveModel, agentName, res.usage.inputTokens, res.usage.outputTokens);
      return res;
    });

    const specText = response.text || "";

    // Anti-lazy-delegation check: reject specs that are too vague
    const lazyCheck = detectLazyDelegation(specText);

    if (lazyCheck.isLazy) {
      addDebug("workflow.synthesis", `Anti-lazy-delegation: ${lazyCheck.matchedPatterns.join(", ")}`, "warn");
      tracer.event("quality_gate", "anti_lazy_delegation", {
        node: nodeId,
        detected: true,
        spec_length: specText.length,
      });
      decisionChain.record(
        "synthesis_quality",
        "lazy_delegation_detected",
        "compliance_policy",
        `synthesis:${nodeId}`,
        "Synthesis output contains vague delegation — may need re-synthesis",
      );
    } else {
      addDebug("workflow.synthesis", `Synthesis complete: ${specText.length} chars, concrete spec produced`);
    }

    return {
      text: specText,
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      metadata: { is_lazy: lazyCheck.isLazy, spec_length: specText.length },
    };
  }

  // --------------------------------------------------
  // Condition Evaluator (simple, safe)
  // --------------------------------------------------

  function evaluateNodeCondition(
    condition: string,
    guardrails: Record<string, unknown>,
    content: string,
  ): boolean {
    try {
      // Support simple conditions like:
      // "guardrails.useSimplicityAgent && content.length > 200"
      if (condition.includes("guardrails.useSimplicityAgent")) {
        const flag = guardrails.useSimplicityAgent === true;
        if (condition.includes("content.length > ")) {
          const match = condition.match(/content\.length\s*>\s*(\d+)/);
          const minLength = match ? parseInt(match[1], 10) : 0;
          return flag && content.length > minLength;
        }
        return flag;
      }
      // Default: always run
      return true;
    } catch (_err) {
      addDebug("workflow.condition", "Condition evaluation failed — failing closed (false)", "warn");
      return false;
    }
  }

  // --------------------------------------------------
  // Save Node Run to DB
  // --------------------------------------------------

  async function saveNodeRun(
    nodeId: string | null,
    nodeType: string,
    agentName: string | null,
    status: string,
    result: NodeResult,
    transitionKey?: string,
    startedAt?: Date,
    error?: string,
  ): Promise<void> {
    try {
      const endedAt = new Date();
      const durationMs = startedAt ? endedAt.getTime() - startedAt.getTime() : undefined;
      await pgrestService.rpc("save_workflow_node_run", {
        p_agent_name: agentName,
        p_duration_ms: durationMs ?? null,
        p_ended_at: endedAt.toISOString(),
        p_error_message: error ?? null,
        p_metadata: result.metadata ? JSON.stringify(result.metadata) : "{}",
      
        p_node_id: nodeId,
        p_node_type: nodeType,
        p_output_data: result.text ? { text_length: result.text.length } : null,
        p_run_id: runId,
        p_started_at: startedAt?.toISOString() ?? null,
        p_status: status,
        p_tokens_input: result.tokensInput,
        p_tokens_output: result.tokensOutput,
        p_transition_key: transitionKey ?? null,});
    } catch (_err) {
      // Non-blocking — node run saving should never fail the pipeline
      log.safeWarn("[workflow-engine] saveNodeRun failed", { error: _err instanceof Error ? _err.message : String(_err) });
    }
  }

  // --------------------------------------------------
  // Main Execution Function
  // --------------------------------------------------

  async function execute(
    graph: WorkflowGraph,
    ctx: WorkflowContext,
  ): Promise<WorkflowResult> {
    // Phase A: Preflight check — validate graph before execution
    const agentNames = agents.map((a) => a.name);
    const agentCategories = agents.map((a) => a.routing_category).filter(Boolean) as string[];
    const preflight = preflightCheckWorkflow(graph, agentNames, agentCategories);
    let preflightWarnings: string[] = [];

    if (!preflight.valid) {
      addDebug("workflow.preflight", `Graph validation FAILED: ${preflight.errors.join("; ")}`, "error");
      tracer.event("workflow_start", graph.entry, {
        preflight_valid: false,
        preflight_errors: preflight.errors,
      });
      // Non-fatal: attempt execution anyway (degraded mode) but log the errors
      preflightWarnings = [...preflight.errors, ...preflight.warnings];
    } else {
      if (preflight.warnings.length > 0) {
        addDebug("workflow.preflight", `Graph valid with warnings: ${preflight.warnings.join("; ")}`, "warn");
        preflightWarnings = preflight.warnings;
      } else {
        addDebug("workflow.preflight", "Graph preflight check passed");
      }
    }

    tracer.event("workflow_start", graph.entry, {
      node_count: Object.keys(graph.nodes).length,
      route_plan_active: !!routePlanHint,
      route_plan_model: routePlanHint?.primaryModel ?? null,
      preflight_valid: preflight.valid,
      preflight_warnings: preflightWarnings.length,
    });

    let currentNodeId: string | null = graph.entry;
    let category = "Else";
    let categories: string[] = ["Else"];
    let specialistContext = "";
    let specialistUsed = "unknown";
    let mainContent = "";
    let toolIterationsUsed = 0;
    let criticRevised = false;
    let criticLoopCount = 0;
    const maxCriticLoops = 2;

    // Traverse the graph
    while (currentNodeId) {
      const node: WorkflowNode | undefined = graph.nodes[currentNodeId];
      if (!node) {
        addDebug("workflow.execute", `Node '${currentNodeId}' not found in graph`, "error");
        break;
      }

      nodesExecuted++;
      const nodeStartedAt = new Date();
      addDebug("workflow.node", `Executing node '${currentNodeId}' (type=${node.type})`);
      tracer.event("workflow_node", currentNodeId, { type: node.type, agent: node.agent });

      try {
        switch (node.type) {
          case "classifier": {
            const result = await executeClassifier(node, ctx);
            totalTokensInput += result.tokensInput;
            totalTokensOutput += result.tokensOutput;
            category = result.category ?? "Else";
            categories = result.categories ?? [category];

            // Determine transition
            let nextNode: string | null = null;
            if (node.transitions) {
              if (node.transitions[category]) {
                nextNode = node.transitions[category];
              } else if (node.transitions.__default__) {
                nextNode = node.transitions.__default__;
              }
            }

            const transitionKey = category;
            await saveNodeRun(currentNodeId, "classifier", node.agent ?? null, "completed", result, transitionKey, nodeStartedAt);
            tracer.event("workflow_transition", `${currentNodeId} → ${nextNode}`, { category, transition: transitionKey });
            currentNodeId = nextNode;
            break;
          }

          case "agent": {
            const result = await executeAgent(currentNodeId, node, ctx, specialistContext, category);
            totalTokensInput += result.tokensInput;
            totalTokensOutput += result.tokensOutput;

            // Track specialist vs main agent output
            const resolvedAgent = node.agent === "__from_category__"
              ? getAgentByCategory(category)?.name ?? "unknown"
              : (node.agent ?? currentNodeId);

            if (currentNodeId === "specialist" || node.config?.inject_as === "developer_context") {
              specialistContext = result.text;
              specialistUsed = resolvedAgent;
            } else {
              // For main_agent, simplicity, etc. — this is the content
              if (result.text) mainContent = result.text;
            }

            if (result.toolIterations && result.toolIterations > 0) {
              toolIterationsUsed = result.toolIterations;
            }

            await saveNodeRun(currentNodeId, "agent", resolvedAgent, "completed", result, undefined, nodeStartedAt);
            currentNodeId = node.next ?? null;
            break;
          }

          case "parallel": {
            const result = await executeParallel(node, ctx, categories);
            totalTokensInput += result.tokensInput;
            totalTokensOutput += result.tokensOutput;
            specialistContext = result.text;
            specialistUsed = `parallel(${categories.join(",")})`;

            await saveNodeRun(currentNodeId, "parallel", null, "completed", result, undefined, nodeStartedAt);
            currentNodeId = node.next ?? null;
            break;
          }

          case "critic": {
            if (criticLoopCount >= maxCriticLoops) {
              addDebug("workflow.critic", "Max critic loops reached, proceeding");
              currentNodeId = node.next ?? null;
              break;
            }

            const result = await executeCritic(node, ctx, mainContent);
            totalTokensInput += result.tokensInput;
            totalTokensOutput += result.tokensOutput;

            await saveNodeRun(currentNodeId, "critic", null, "completed", result, undefined, nodeStartedAt);

            if (result.shouldRetry && node.target_node) {
              criticLoopCount++;
              criticRevised = true;
              addDebug("workflow.critic", `Score below threshold, looping back to '${node.target_node}'`);
              // Inject critic feedback into the context
              specialistContext += `\n\n[Critic feedback]: ${result.text}`;
              currentNodeId = node.target_node;
            } else {
              currentNodeId = node.next ?? null;
            }
            break;
          }

          case "guardrails": {
            // Guardrails are handled externally in ai-chat after the workflow
            addDebug("workflow.guardrails", "Guardrails node (handled post-workflow)");
            await saveNodeRun(currentNodeId, "guardrails", null, "completed", {
              text: "", tokensInput: 0, tokensOutput: 0,
            }, undefined, nodeStartedAt);
            currentNodeId = node.next ?? null;
            break;
          }

          case "synthesis": {
            const result = await executeSynthesis(currentNodeId, node, ctx, specialistContext);
            totalTokensInput += result.tokensInput;
            totalTokensOutput += result.tokensOutput;
            // Synthesis output replaces specialist context — downstream agents get the spec
            specialistContext = result.text;
            await saveNodeRun(currentNodeId, "synthesis", node.agent ?? null, "completed", result, undefined, nodeStartedAt);
            currentNodeId = node.next ?? null;
            break;
          }

          default:
            addDebug("workflow.execute", `Unknown node type '${node.type}'`, "error");
            currentNodeId = null;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        addDebug("workflow.execute", `Node '${currentNodeId}' failed: ${errMsg}`, "error");
        await saveNodeRun(
          currentNodeId,
          node.type,
          node.agent ?? null,
          "failed",
          { text: "", tokensInput: 0, tokensOutput: 0 },
          undefined,
          nodeStartedAt,
          errMsg,
        );
        // Propagate error — the caller (ai-chat) handles it
        throw err;
      }

      // Safety: max 20 node executions to prevent infinite loops
      if (nodesExecuted > 20) {
        addDebug("workflow.execute", "Max node executions (20) reached, terminating", "error");
        break;
      }
    }

    // Phase A: Record any provenance violations as trace events
    if (decisionChain.hasViolations()) {
      const violations = decisionChain.getViolations();
      addDebug("workflow.provenance", `${violations.length} decision override violation(s) detected`, "warn");
      for (const v of violations) {
        tracer.event("quality_gate", "provenance_violation", {
          decision: v.attemptedDecision,
          attempted_source: v.attemptedSource,
          blocked_by: v.existingDecision.sourceType,
          reason: v.reason,
        });
      }
    }

    return {
      content: mainContent,
      totalTokensInput,
      totalTokensOutput,
      category,
      specialistUsed,
      toolIterationsUsed,
      nodesExecuted,
      criticRevised,
      provenanceSummary: decisionChain.toTraceSummary(),
      preflightWarnings,
      costSummary: costAggregator.getSummary(),
    };
  }

  return { execute };
}

// =============================================================================
// Workflow Loader — Load active workflow from DB
// =============================================================================

/**
 * Load the active workflow definition for a given context.
 * Falls back to the default hardcoded workflow if none is found.
 */
export async function loadWorkflow(
  pgrestService: PostgrestClient,
  context: string = "chat",
): Promise<{ graph: WorkflowGraph; workflowId?: string; name: string }> {
  try {
    const { data, error } = await pgrestService.rpc("get_active_workflow_for_context", {
      p_context: context,
    });

    if (!error && data && Array.isArray(data) && data.length > 0) {
      const row = data[0];
      const graph = row.graph as WorkflowGraph;
      if (graph && graph.entry && graph.nodes) {
        return { graph, workflowId: row.id, name: row.name };
      }
    }
  } catch {
    // Fall through to default
  }

  return { graph: DEFAULT_CHAT_WORKFLOW, name: "default_chat_pipeline" };
}
