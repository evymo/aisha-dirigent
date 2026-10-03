/**
 * Main chat participant handler for `@aisha` in VS Code Copilot Chat.
 *
 * Routes slash commands to MCP tools and renders markdown responses.
 *
 * @module
 */

import * as vscode from "vscode";
import { callMcpTool, extractMarkdown, extractJson, callN8nAgent, type N8nAgentResponse, type McpToolResponse } from "./mcp-client";
import { safeWriteFromUri } from "./generators/file-safety";
import { getAutoGenMarker } from "./generators/registry";

/**
 * Ensure MCP-returned markdown carries the AISHA auto-gen header marker so
 * subsequent `safeWrite` calls treat the file as managed. Without this, a
 * round-trip through MCP would strip the marker and the next regen would be
 * refused as user-owned.
 */
function ensureAutoGenMarker(md: string): string {
  return md.includes(getAutoGenMarker()) ? md : `> ${getAutoGenMarker()}\n\n${md}`;
}
import { getDirigentConfig } from "./config";
import { getWorkspaceContext, getProjectAnalysis, type WorkspaceContext } from "./workspace";
import { resolveStoryContext } from "./story-context";
import { isPushConnected } from "./aisha-push";
import {
  getSessionPayload,
  getSessionSync,
  applyDirective,
  recordTurn,
  type SessionDirective,
} from "./session-manager";
import { handleConnectRepo } from "./github-app";
import { buildInlineFooter, buildStatsMarkdown, type RequestStats } from "./resource-tracker";
import { edgeChat, formatEdgeTag, type ChatMessage } from "./local-llm-client";
import { getEnvironment, isEdgeFirstEnabled, type TaskKind } from "./compute-tier";

/** Event emitter for session changes — used by tree-view */
export const onSessionChanged = new vscode.EventEmitter<string | null>();

/** Decision metadata for story sync and cache. */
export interface DecisionRecord {
  type: string;
  summary: string;
  severity: string;
  source: "directive" | "autoflow" | "push" | "manual" | "tier-selection";
  tier?: "edge" | "self-hosted" | "cloud";
  model?: string;
  timestamp: string;
}

/** Event emitter for decisions extracted from n8n directives */
export const onDecisionMade = new vscode.EventEmitter<DecisionRecord>();

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function getExpertiseLevel(): string {
  return getDirigentConfig().expertiseLevel || "intermediate";
}

/**
 * Sanitize error messages for chat display.
 * Strips internal details (URLs, stack traces) and returns a user-safe summary.
 */
function sanitizeErrorForChat(raw: string | undefined | null): string {
  if (!raw) return "Backend unavailable.";
  // Strip URLs that may leak internal infrastructure
  const noUrls = raw.replace(/https?:\/\/[^\s)]+/g, "[internal]");
  // Truncate overly long messages (stack traces, JSON blobs)
  const truncated = noUrls.length > 200 ? noUrls.slice(0, 200) + "…" : noUrls;
  return truncated;
}

/**
 * Build common args shared by most MCP tools.
 */
async function buildBaseArgs(): Promise<{
  workspace: WorkspaceContext;
  storyId: string | null;
  expertiseLevel: string;
}> {
  const [workspace, story] = await Promise.all([
    getWorkspaceContext(),
    resolveStoryContext(),
  ]);

  return {
    workspace,
    storyId: story.storyId,
    expertiseLevel: getExpertiseLevel(),
  };
}

/**
 * Stream markdown response into chat.
 */
function streamMarkdown(
  stream: vscode.ChatResponseStream,
  md: string,
): void {
  stream.markdown(md);
}

/**
 * Append inline resource usage footer if stats are available.
 */
function appendStatsFooter(
  stream: vscode.ChatResponseStream,
  reqStats: RequestStats | null | undefined,
): void {
  if (!reqStats) return;
  const showUsage = vscode.workspace.getConfiguration("aisha.dirigent").get<boolean>("showUsageStats", true);
  if (!showUsage) return;
  stream.markdown(`\n\n---\n> 📊 ${buildInlineFooter(reqStats)}`);
}

/**
 * Process Aisha response — record turn, apply session directive, show orchestration notes.
 * Also appends inline stats footer if available.
 */
async function processAishaResponse(
  result: N8nAgentResponse | null,
  stream: vscode.ChatResponseStream,
  userPrompt?: string,
  intent?: string,
): Promise<void> {
  // Inline stats footer from the request
  appendStatsFooter(stream, result?._stats);

  // Record conversation turn for Aisha's memory
  if (userPrompt) {
    recordTurn(userPrompt, result?.response, intent, result?.success ?? false);
  }

  if (!result?.directive) return;

  const directive = result.directive as SessionDirective;
  await applyDirective(directive);

  // Extract decisions from directive for the Decisions tree view
  const ts = new Date().toISOString();
  if (directive.domain) {
    onDecisionMade.fire({ type: "Domain", summary: `Reassigned to ${directive.domain}`, severity: "info", source: "directive", timestamp: ts });
  }
  if (directive.current_task) {
    onDecisionMade.fire({ type: "Task", summary: directive.current_task, severity: "info", source: "directive", timestamp: ts });
  }
  if (directive.status === "blocked") {
    onDecisionMade.fire({ type: "Escalation", summary: directive.orchestration_note ?? "Blocked", severity: "warning", source: "directive", timestamp: ts });
  }
  if (directive.cross_session?.length) {
    for (const msg of directive.cross_session) {
      onDecisionMade.fire({ type: "Cross-session", summary: `→ ${msg.target_domain}: ${msg.message}`, severity: "info", source: "directive", timestamp: ts });
    }
  }

  // Show orchestration note if Aisha sent one
  if (directive.orchestration_note) {
    stream.markdown(`\n\n---\n> **AISHA:** ${directive.orchestration_note}`);
  }

  // Show cross-session messages (informational)
  if (directive.cross_session?.length) {
    for (const msg of directive.cross_session) {
      stream.markdown(`\n> _Cross-session [${msg.target_domain}]:_ ${msg.message}`);
    }
  }
}

// ──────────────────────────────────────────
// Autonomous flow — AISHA decides what to do
// ──────────────────────────────────────────

/**
 * Intent categories for autonomous routing.
 */
type AishaIntent =
  | "code_review"      // User is asking about code quality
  | "test_strategy"    // User is asking about tests
  | "compliance"       // User is asking about compliance / PR readiness
  | "debug"            // User has errors / is debugging
  | "knowledge"        // User needs platform knowledge / docs
  | "estimate"         // User needs effort estimation
  | "delivery"         // User needs delivery / story guidance
  | "story_planning"   // User wants to discuss/refine story scope & planning
  | "general";         // Catch-all → delegate to Dirigent

/**
 * Detect user intent from prompt + workspace context.
 * Runs locally (no API call) for speed.
 */
function detectIntent(prompt: string, ctx: Awaited<ReturnType<typeof buildBaseArgs>>): AishaIntent {
  const p = prompt.toLowerCase();

  // Error/debug signals
  if (ctx.workspace.diagnosticSummary || /\b(error|bug|chyb|nefunguje|fails?|broken|debug|fix)\b/.test(p)) {
    return "debug";
  }
  // Test signals
  if (/\b(test|testy?|coverage|vitest|spec|mock)\b/.test(p)) {
    return "test_strategy";
  }
  // Compliance / PR signals
  if (/\b(compliance|pr|pull.?request|review|gate|lint|audit)\b/.test(p)) {
    return "compliance";
  }
  // Story planning / refinement signals (before delivery — "story" is more specific here)
  if (/\b(scope|milestone|planning|požadav|roadmap|refinement|acceptance.?crit|akcepta|user.?story|backlog)\b/.test(p)) {
    return "story_planning";
  }
  // Delivery / story signals
  if (/\b(deliver|deploy|release|story|sprint|status|ship)\b/.test(p)) {
    return "delivery";
  }
  // Estimate signals
  if (/\b(estimat|odhad|effort|complex|story.?point|jak.?dlouho|how.?long)\b/.test(p)) {
    return "estimate";
  }
  // Knowledge signals
  if (/\b(jak|how|what|where|kde|proč|why|explain|docs?|dokumentac|architektur|pattern)\b/.test(p)) {
    return "knowledge";
  }
  // Code review — if user has code selected or is talking about a file
  if (ctx.workspace.activeSelection || /\b(quality|kvalit|refactor|clean|code)\b/.test(p)) {
    return "code_review";
  }

  return "general";
}

/**
 * Build a rich context summary for the agent (sent as part of the payload).
 */
function buildContextSummary(ctx: Awaited<ReturnType<typeof buildBaseArgs>>): string {
  const parts: string[] = [];

  if (ctx.workspace.gitBranch) parts.push(`Branch: ${ctx.workspace.gitBranch}`);
  if (ctx.workspace.activeFilePaths.length > 0) {
    parts.push(`Active files: ${ctx.workspace.activeFilePaths.join(", ")}`);
  }
  if (ctx.workspace.activeLanguage) parts.push(`Language: ${ctx.workspace.activeLanguage}`);
  if (ctx.workspace.diffSummary) parts.push(`Git changes:\n${ctx.workspace.diffSummary}`);
  if (ctx.workspace.diagnosticSummary) parts.push(`Diagnostics: ${ctx.workspace.diagnosticSummary}`);
  if (ctx.workspace.dirtyFiles.length > 0) {
    parts.push(`Unsaved: ${ctx.workspace.dirtyFiles.join(", ")}`);
  }
  if (ctx.workspace.recentCommits.length > 0) {
    parts.push(`Recent commits:\n${ctx.workspace.recentCommits.join("\n")}`);
  }
  if (ctx.storyId) parts.push(`Story: ${ctx.storyId}`);

  return parts.join("\n");
}

/**
 * Default handler — AUTONOMOUS FLOW.
 *
 * When user writes anything to `@aisha` without a slash command,
 * AISHA automatically orchestrates the response via the Dirigent Agent (n8n).
 *
 * Architecture:
 *   Developer → Copilot (@aisha) → Aisha Dirigent (n8n) → MCP tools / sub-agents
 *
 * The extension is a **thin proxy**: collects workspace context, sends everything
 * to Aisha, and streams back the response. Aisha decides which tools to use
 * (MCP knowledge search, compliance checks, quality assessment, etc.).
 *
 * Direct MCP calls remain ONLY as fallback when n8n is unreachable.
 */
async function handleAutonomous(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatFollowup[]> {
  const base = await buildBaseArgs();
  const intent = detectIntent(request.prompt, base);
  const contextSummary = buildContextSummary(base);
  const followUps: vscode.ChatFollowup[] = [];

  const hasN8n = Boolean(getDirigentConfig().n8nTriggerUrl);

  // ── Primary path: Everything goes through Aisha Dirigent ──────────
  if (hasN8n) {
    stream.progress("AISHA orchestrating…");
    const sessionPayload = await getSessionPayload();

    const result = await callN8nAgent("dirigent-agent", {
      task: request.prompt,
      intent,
      session: sessionPayload,
      context: {
        ...base.workspace,
        story_id: base.storyId,
        expertise_level: base.expertiseLevel,
        context_summary: contextSummary,
        selection: base.workspace.activeSelection,
      },
    });

    if (token.isCancellationRequested) return followUps;

    if (result?.success) {
      streamMarkdown(stream, result.response ?? "");
      await processAishaResponse(result, stream, request.prompt, intent);

      // Context-aware follow-ups — use workspace state for specific suggestions
      const activeFile = base.workspace.activeFilePaths[0] ?? "";
      const fileName = activeFile.split("/").pop() ?? "";
      const hasStory = Boolean(base.storyId);
      const hasDiag = Boolean(base.workspace.diagnosticSummary);

      switch (intent) {
        case "debug":
          followUps.push(
            { prompt: `@aisha /dirigent Fix errors in ${fileName || "this file"}`, participant: "aisha" },
          );
          if (fileName.includes("Hook") || fileName.startsWith("use")) {
            followUps.push({ prompt: `@aisha /test ${fileName}`, participant: "aisha" });
          } else {
            followUps.push({ prompt: "@aisha /quality Check if the fix introduced regressions", participant: "aisha" });
          }
          break;
        case "test_strategy":
          followUps.push(
            { prompt: `@aisha /dirigent Generate test for ${fileName || "current hook"}`, participant: "aisha" },
            { prompt: `@aisha /compliance Check gate tests pass`, participant: "aisha" },
          );
          break;
        case "compliance":
          followUps.push(
            { prompt: "@aisha /dirigent Fix all compliance violations", participant: "aisha" },
            { prompt: "@aisha /estimate Effort to fix these violations", participant: "aisha" },
          );
          break;
        case "knowledge":
          followUps.push(
            { prompt: `@aisha /dirigent Show code example for ${request.prompt.split(" ").slice(0, 4).join(" ")}`, participant: "aisha" },
          );
          if (hasStory) {
            followUps.push({ prompt: "@aisha /compliance Does this align with our ruleset?", participant: "aisha" });
          } else {
            followUps.push({ prompt: "@aisha /onboard Set up project context first", participant: "aisha" });
          }
          break;
        case "delivery":
          followUps.push(
            { prompt: "@aisha /compliance Pre-ship compliance check", participant: "aisha" },
            { prompt: "@aisha /estimate Remaining effort to complete", participant: "aisha" },
          );
          break;
        case "story_planning":
          followUps.push(
            { prompt: "@aisha /story What are the main risks?", participant: "aisha" },
            { prompt: "@aisha /story Break into milestones", participant: "aisha" },
            { prompt: "@aisha /story Propose acceptance criteria", participant: "aisha" },
          );
          break;
        case "code_review":
          followUps.push(
            { prompt: `@aisha /dirigent Fix issues in ${fileName || "reviewed code"}`, participant: "aisha" },
            { prompt: `@aisha /test Verify test coverage for ${fileName || "this file"}`, participant: "aisha" },
          );
          break;
        default:
          if (hasDiag) {
            followUps.push({ prompt: "@aisha /dirigent Fix the current errors", participant: "aisha" });
          } else if (hasStory) {
            followUps.push({ prompt: "@aisha /next What should I work on next?", participant: "aisha" });
          } else {
            followUps.push({ prompt: "@aisha /onboard Set up project context", participant: "aisha" });
          }
          followUps.push({ prompt: "@aisha /quality Full quality assessment", participant: "aisha" });
      }

      return followUps;
    }

    // Aisha returned error — record failure, show sanitized details, fall through to MCP fallback
    if (result?.error) {
      recordTurn(request.prompt, result.error, intent, false);
      streamMarkdown(stream, `> **AISHA Error:** ${sanitizeErrorForChat(result.error)}\n\n_Falling back to direct MCP…_\n`);
    } else if (result && !result.success && result.response) {
      // Non-success but has a response (partial failure — tool error surfaced)
      recordTurn(request.prompt, result.response, intent, false);
      streamMarkdown(stream, result.response + "\n\n---\n_AISHA encountered errors during processing. Some tools may be unavailable._\n");
      return followUps;
    } else {
      stream.progress("Aisha unavailable — falling back to direct MCP…");
    }
  }

  // ── Fallback: Direct MCP when n8n is not configured or fails ──────
  await handleModerateSimple(request, stream, token, base, intent === "debug" ? "debugging" : "code_review");
  followUps.push({ prompt: "@aisha /status Check platform connectivity", participant: "aisha" });

  return followUps;
}

/**
 * Simple moderate_flow call — used as fallback when n8n is not available.
 */
async function handleModerateSimple(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  base: Awaited<ReturnType<typeof buildBaseArgs>>,
  sessionType: string,
): Promise<void> {
  const result = await callMcpTool("moderate_flow", {
    session_type: sessionType,
    tech_stack: base.workspace.techStack.join(", "),
    file_paths: base.workspace.activeFilePaths,
    diff_summary: base.workspace.diffSummary ?? undefined,
    expertise_level: base.expertiseLevel,
    story_id: base.storyId ?? undefined,
    user_prompt: request.prompt,
  });

  if (token.isCancellationRequested) return;

  streamMarkdown(stream, extractMarkdown(result) ?? "_No response from AISHA._");
}

/**
 * /test — Evaluate test strategy for a hook or file.
 * Routes through Aisha Dirigent with test_strategy intent.
 */
async function handleTest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA evaluating test strategy…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || `Test evaluation for ${base.workspace.activeFilePaths[0] ?? "current file"}`,
    intent: "test_strategy",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No test evaluation available._");
    await processAishaResponse(result, stream, request.prompt, "test_strategy");
    return;
  }

  // Fallback to direct MCP
  const fallbackResult = await callMcpTool("evaluate_test_strategy", {
    file_paths: base.workspace.activeFilePaths,
    tech_stack: base.workspace.techStack.join(", "),
    expertise_level: base.expertiseLevel,
    story_id: base.storyId ?? undefined,
    user_prompt: request.prompt,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No test evaluation available._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /quality — Assess code quality against platform standards.
 * Routes through Aisha Dirigent with code_review intent.
 */
async function handleQuality(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA assessing code quality…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || "Code quality assessment for current files",
    intent: "code_review",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
      check_types: parseCheckTypes(request.prompt),
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No quality assessment available._");
    await processAishaResponse(result, stream, request.prompt, "code_review");
    return;
  }

  // Fallback to direct MCP
  const fallbackResult = await callMcpTool("assess_quality", {
    file_paths: base.workspace.activeFilePaths,
    code_snippet: base.workspace.activeSelection ?? undefined,
    check_types: parseCheckTypes(request.prompt),
    expertise_level: base.expertiseLevel,
    user_prompt: request.prompt,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No quality assessment available._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /compliance — Check PR compliance against pinned ruleset.
 * Routes through Aisha Dirigent with compliance intent.
 */
async function handleCompliance(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA checking compliance…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || "PR compliance check for current changes",
    intent: "compliance",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
      diff_summary: base.workspace.diffSummary ?? "No changes detected",
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No compliance report available._");
    await processAishaResponse(result, stream, request.prompt, "compliance");
    return;
  }

  // Fallback to direct MCP
  const fallbackResult = await callMcpTool("validate_compliance", {
    file_paths: base.workspace.activeFilePaths,
    story_id: base.storyId ?? undefined,
    diff_summary: base.workspace.diffSummary ?? "No changes detected",
    check_types: ["rpc_pattern", "security", "types", "i18n", "error_handling"],
    expertise_level: base.expertiseLevel,
    user_prompt: request.prompt,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No compliance report available._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /estimate — Estimate development effort.
 * Routes through Aisha Dirigent with estimate intent.
 */
async function handleEstimate(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA estimating effort…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || "Effort estimation for current task",
    intent: "estimate",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No effort estimate available._");
    await processAishaResponse(result, stream, request.prompt, "estimate");
    return;
  }

  // Fallback to direct MCP
  const fallbackResult = await callMcpTool("estimate_effort", {
    task_description: request.prompt || "Current task",
    affected_files: base.workspace.activeFilePaths,
    expertise_level: base.expertiseLevel,
    story_id: base.storyId ?? undefined,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No effort estimate available._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /story — Discuss and refine a project story.
 * Uses `planning_heavy` context profile (16K budget) for rich story analysis.
 * Routes through Dirigent Agent with story_planning intent.
 */
async function handleStory(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA analyzing story context…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || "Story refinement and planning discussion",
    intent: "story_planning",
    context_profile: "planning_heavy",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No story analysis available._");
    await processAishaResponse(result, stream, request.prompt, "story_planning");
    return;
  }

  // Fallback to direct MCP — compose planning context + search knowledge
  const fallbackResult = await callMcpTool("search_knowledge", {
    query: request.prompt || "Story planning and scope analysis",
    include_ai_instructions: true,
    limit: 10,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No story context available. Ensure MCP Knowledge Server is connected._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /next — Suggest what to do next in the current story.
 * Routes through Aisha Dirigent for holistic next-step recommendation.
 */
async function handleNext(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("AISHA suggesting next step…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt || "What should I do next?",
    intent: "delivery",
    session: sessionPayload,
    context: {
      ...base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
      diff_summary: base.workspace.diffSummary ?? undefined,
    },
  });

  if (token.isCancellationRequested) return;

  if (result?.success) {
    streamMarkdown(stream, result.response ?? "_No suggestion available._");
    await processAishaResponse(result, stream, request.prompt, "delivery");
    return;
  }

  // Fallback to direct MCP
  const fallbackResult = await callMcpTool("suggest_next_step", {
    tech_stack: base.workspace.techStack.join(", "),
    file_paths: base.workspace.activeFilePaths,
    diff_summary: base.workspace.diffSummary ?? undefined,
    expertise_level: base.expertiseLevel,
    story_id: base.storyId ?? undefined,
    user_prompt: request.prompt,
  });
  streamMarkdown(stream, extractMarkdown(fallbackResult) ?? "_No suggestion available._");
  appendStatsFooter(stream, fallbackResult?._stats);
}

/**
 * /instructions — Generate `.github/copilot-instructions.md` from knowledge base.
 */
async function handleInstructions(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  stream.progress("Generating copilot-instructions.md…");

  const { storyId } = await buildBaseArgs();
  let instructionsContent: string;

  if (storyId) {
    // Story-aware: use generate_copilot_instructions RPC via MCP
    // This generates rich, rule-based instructions from the story's pinned ruleset
    stream.progress("Using story ruleset for instructions…");
    const result = await callMcpTool("generate_copilot_instructions", {
      story_id: storyId,
    });

    if (token.isCancellationRequested) return;

    const md = extractMarkdown(result);
    if (!md) {
      streamMarkdown(stream, "_Could not generate instructions from story ruleset. Is a ruleset pinned?_");
      return;
    }

    instructionsContent = md;
  } else {
    // No story context — use default instructions (public rules, no auth required)
    stream.progress("No story context — generating default instructions…");
    const result = await callMcpTool("generate_default_instructions", {});

    if (token.isCancellationRequested) return;

    const md = extractMarkdown(result);
    if (!md) {
      streamMarkdown(stream, "_Could not generate default instructions. Is the knowledge base seeded?_");
      return;
    }

    instructionsContent = md;
  }

  // Write to .github/copilot-instructions.md via safeWrite (backup +
  // user-section preservation + refuse-user-owned guard).
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root) {
    const stamped = ensureAutoGenMarker(instructionsContent);
    const outcome = await safeWriteFromUri(root.uri, ".github/copilot-instructions.md", stamped);
    const source = storyId ? "story ruleset" : "default rules";

    switch (outcome.outcome) {
      case "refused-user-owned":
        streamMarkdown(
          stream,
          `\`.github/copilot-instructions.md\` already exists and was authored manually (no AISHA marker). Skipped — delete the file first if you want Dirigent to regenerate it.`,
        );
        break;
      case "backup-failed":
        streamMarkdown(
          stream,
          `_Could not back up existing \`.github/copilot-instructions.md\` — write aborted._`,
        );
        break;
      default: {
        const lineCount = stamped.split("\n").length;
        streamMarkdown(
          stream,
          `Generated \`.github/copilot-instructions.md\` (${lineCount} lines) from **${source}**.${outcome.preservedUserSection ? " _User-section preserved._" : ""}\n\n` +
          `Copilot will now follow these instructions for all interactions in this workspace.` +
          (storyId ? `\n\n_Story: \`${storyId}\`_` : ""),
        );
      }
    }
  } else {
    streamMarkdown(stream, instructionsContent);
  }
}

// ──────────────────────────────────────────
// n8n Agent Delegation Handlers
// ──────────────────────────────────────────

/**
 * /dirigent — Delegate a complex task to the n8n AISHA Dirigent Agent.
 *
 * The Dirigent orchestrates across all sub-agents (Knowledge, Compliance,
 * Delivery) and MCP tools with full context and memory.
 *
 * Usage:
 *   @aisha /dirigent Review the PR changes for story EV-123
 *   @aisha /dirigent Run compliance check on current branch
 *   @aisha /dirigent What's the status of delivery for this sprint?
 */
async function handleDirigent(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const base = await buildBaseArgs();
  stream.progress("Delegating to AISHA Dirigent Agent…");

  const sessionPayload = await getSessionPayload();

  const result = await callN8nAgent("dirigent-agent", {
    task: request.prompt,
    session: sessionPayload,
    context: {
      workspace: base.workspace,
      story_id: base.storyId,
      expertise_level: base.expertiseLevel,
    },
  });

  if (token.isCancellationRequested) return;

  if (!result || !result.success) {
    streamMarkdown(
      stream,
      `**Dirigent Agent Error:** ${sanitizeErrorForChat(result?.error) || "No response from n8n agent. Check n8nTriggerUrl in .aisha/dirigent.local.json or aisha.dirigent.n8nTriggerUrl setting."}\n\n` +
      `_Falling back to direct MCP tools…_`,
    );
    // Fallback to direct MCP moderate_flow
    const fallbackBase = await buildBaseArgs();
    await handleModerateSimple(request, stream, token, fallbackBase, "code_review");
    return;
  }

  const response = result.response ?? "_Agent returned empty response._";
  const providerInfo = result.provider ? ` (${result.provider}/${result.model ?? "unknown"})` : "";
  streamMarkdown(stream, response + `\n\n---\n_Processed by AISHA Dirigent${providerInfo}_`);
  await processAishaResponse(result, stream, request.prompt, "dirigent");
}

/**
 * /route — Route a task to a specific model via WF_MODEL_ROUTER.
 *
 * Usage:
 *   @aisha /route gemini Classify this error message
 *   @aisha /route openai Review this security-critical code
 */
async function handleRoute(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  stream.progress("Routing to model…");

  // Parse provider from first word of prompt
  const words = request.prompt.trim().split(/\s+/);
  const providerHint = words[0]?.toLowerCase();
  const task = words.slice(1).join(" ") || request.prompt;

  let provider = "auto";
  if (["openai", "gpt"].includes(providerHint)) provider = "openai";
  else if (["gemini", "google"].includes(providerHint)) provider = "google";
  else if (["claude", "anthropic"].includes(providerHint)) provider = "anthropic";

  const result = await callN8nAgent("model-router", {
    task,
    provider,
  });

  if (token.isCancellationRequested) return;

  if (!result || !result.success) {
    streamMarkdown(
      stream,
      `**Model Router Error:** ${sanitizeErrorForChat(result?.error) || "No response. Check n8n trigger configuration."}\n\n` +
      `_Falling back to direct MCP…_`,
    );
    // Fallback to direct MCP moderate_flow
    const base = await buildBaseArgs();
    await handleModerateSimple(request, stream, token, base, "code_review");
    return;
  }

  const response = result.response ?? "_Router returned empty response._";
  const providerInfo = result.provider ? ` (${result.provider}/${result.model ?? "unknown"})` : "";
  streamMarkdown(stream, response + `\n\n---\n_Routed via Model Router${providerInfo}_`);
}

// ──────────────────────────────────────────
// /models — Show AI model registry status
// ──────────────────────────────────────────

/**
 * `/models` — Display model registry overview from Aisha backend.
 *
 * Shows all tracked AI models across providers with availability,
 * eval status, and performance metrics.
 */
async function handleModels(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  stream.progress("Fetching AI model registry…");

  const providerFilter = request.prompt.trim().toLowerCase() || null;

  const result = await callMcpTool("get_model_registry", {
    provider: providerFilter,
    available_only: false,
  });

  if (!result) {
    streamMarkdown(stream, "**Error:** Could not fetch model registry. Check MCP connection.");
    return;
  }

  const json = extractJson(result);
  const models = json?.models as Array<Record<string, unknown>> | undefined;

  if (!models?.length) {
    const md = extractMarkdown(result);
    streamMarkdown(stream, md || "_No models found in registry._");
    return;
  }

  // Build markdown table
  const lines: string[] = [
    "## AI Model Registry\n",
    "| Provider | Model | Status | Score | Available |",
    "|----------|-------|--------|-------|-----------|",
  ];

  for (const m of models) {
    const status = m.eval_status ?? "—";
    const score = typeof m.latest_eval_score === "number"
      ? (m.latest_eval_score as number).toFixed(3)
      : "—";
    const available = m.is_available ? "✅" : "❌";
    lines.push(`| ${m.provider} | ${m.model_id} | ${status} | ${score} | ${available} |`);
  }

  lines.push(`\n_Total: ${models.length} models_`);
  streamMarkdown(stream, lines.join("\n"));
}

// ──────────────────────────────────────────
// /eval — Trigger or view evaluation runs
// ──────────────────────────────────────────

/**
 * `/eval` — Show eval run status or trigger a new evaluation.
 *
 * Usage:
 *   @aisha /eval           — Show latest eval run results
 *   @aisha /eval trigger   — Trigger a new manual eval run
 */
async function handleEval(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  const subcommand = request.prompt.trim().toLowerCase();

  if (subcommand === "trigger" || subcommand === "run") {
    stream.progress("Triggering evaluation run…");

    const result = await callN8nAgent("eval-trigger", {
      trigger_type: "manual",
      reason: "Triggered from VS Code @aisha /eval command",
    });

    if (!result?.success) {
      streamMarkdown(stream, `**Eval trigger failed:** ${sanitizeErrorForChat(result?.error) || "No response from backend."}`);
      return;
    }

    streamMarkdown(stream, `✅ **Eval run triggered**\n\n${result.response ?? "Run is being processed."}`);
    return;
  }

  // Default: show latest eval results
  stream.progress("Fetching evaluation results…");

  const result = await callMcpTool("get_eval_runs", {
    limit: 5,
  });

  if (!result) {
    streamMarkdown(stream, "**Error:** Could not fetch eval runs. Check MCP connection.");
    return;
  }

  const md = extractMarkdown(result);
  streamMarkdown(stream, md || "_No evaluation runs found._");
}

// ──────────────────────────────────────────
// /proposals — Show improvement proposals
// ──────────────────────────────────────────

/**
 * `/proposals` — Display active improvement proposals from the self-learning loop.
 */
async function handleProposals(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  stream.progress("Fetching improvement proposals…");

  const statusFilter = request.prompt.trim().toLowerCase() || "pending";

  const result = await callMcpTool("get_improvement_proposals", {
    status: statusFilter,
    limit: 10,
  });

  if (!result) {
    streamMarkdown(stream, "**Error:** Could not fetch proposals. Check MCP connection.");
    return;
  }

  const json = extractJson(result);
  const proposals = json?.proposals as Array<Record<string, unknown>> | undefined;

  if (!proposals?.length) {
    const md = extractMarkdown(result);
    streamMarkdown(stream, md || `_No ${statusFilter} proposals found._`);
    return;
  }

  const lines: string[] = [
    `## Improvement Proposals (${statusFilter})\n`,
    "| Type | Title | Priority | Source |",
    "|------|-------|----------|--------|",
  ];

  for (const p of proposals) {
    lines.push(`| ${p.proposal_type} | ${p.title} | ${p.priority} | ${p.source} |`);
  }

  lines.push(`\n_Showing ${proposals.length} proposals_`);
  streamMarkdown(stream, lines.join("\n"));
}

// ──────────────────────────────────────────
// /status — Platform status & connectivity
// ──────────────────────────────────────────

// ──────────────────────────────────────────
// /stats — Resource usage statistics
// ──────────────────────────────────────────

/**
 * `/stats` — Show resource usage: API calls, tokens, latency, cost.
 */
async function handleStats(
  _request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  streamMarkdown(stream, buildStatsMarkdown());
}

/**
 * `/status` — Show platform status: connectivity, story context, workspace info.
 * Replaces the former `/health` command.
 */
async function handleStatus(
  _request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  stream.progress("Running connectivity checks…");
  const config = getDirigentConfig();

  const lines: string[] = ["## Platform Status\n"];

  // ── MCP Knowledge Server ──
  const mcpUrl = config.mcpUrl || "";
  if (!mcpUrl) {
    lines.push("| Service | Status |", "|---------|--------|");
    lines.push("| MCP Knowledge Server | Not configured |");
  } else {
    const mcpResult = await callMcpTool("get_knowledge_stats", {});
    const ok = mcpResult && !mcpResult.isError;
    lines.push("| Service | Status |", "|---------|--------|");
    lines.push(`| MCP Knowledge Server | ${ok ? "Connected" : "Error"} |`);
  }

  // ── n8n Trigger ──
  const n8nUrl = config.n8nTriggerUrl || "";
  lines.push(`| n8n Agent Trigger | ${n8nUrl ? "Configured" : "Not configured"} |`);

  // ── Push Channel ──
  lines.push(`| Aisha Push Channel | ${isPushConnected() ? "Connected" : "Disconnected"} |`);

  // ── Story Context ──
  const story = await resolveStoryContext();
  lines.push(`| Story Context | ${story.storyId ? `Active (${story.source})` : "None"} |`);

  // ── Environment / Tier ──
  const env = getEnvironment();
  lines.push(`\n### Environment\n`);
  lines.push(`- **Backend:** ${env.backend.label} (${env.backend.type})`);
  lines.push(`- **Edge available:** ${env.edge.available ? `Yes (${env.edge.models.length} models)` : "No"}`);
  if (env.edge.available) {
    lines.push(`- **Edge models:** ${env.edge.models.map(m => m.modelId).join(", ")}`);
    lines.push(`- **Chip:** ${env.edge.chip.name} (${env.edge.chip.cores} cores, ${env.edge.chip.memoryGb}GB RAM)`);
  }
  const edgeFirst = vscode.workspace.getConfiguration("aisha.dirigent").get<boolean>("edgeFirst", false);
  lines.push(`- **Edge-first mode:** ${edgeFirst ? "Enabled" : "Disabled"}`);

  // ── Workspace ──
  const ctx = await getWorkspaceContext();
  lines.push(`\n### Workspace\n`);
  lines.push(`- **Branch:** ${ctx.gitBranch ?? "N/A"}`);
  lines.push(`- **Tech stack:** ${ctx.techStack.join(", ") || "undetected"}`);
  lines.push(`- **Active files:** ${ctx.activeFilePaths.length}`);
  if (ctx.diagnosticSummary) {
    lines.push(`- **Diagnostics:** ${ctx.diagnosticSummary}`);
  }

  streamMarkdown(stream, lines.join("\n"));
}

// ──────────────────────────────────────────
// /onboard — Autonomous project onboarding
// ──────────────────────────────────────────

/**
 * `/onboard` — Full autonomous onboarding pipeline.
 *
 * 1. Detects workspace tech stack and domain
 * 2. Updates story context via `detect_project_context_from_analysis`
 * 3. Recommends expert rules via `recommend_ruleset_for_story`
 * 4. Creates story ruleset and syncs copilot-instructions.md
 *
 * Usage:
 *   @aisha /onboard
 *   @aisha /onboard healthcare vue python
 */
async function handleOnboard(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const { storyId } = await buildBaseArgs();

  if (!storyId) {
    streamMarkdown(
      stream,
      "**No story context found.** Set a story first:\n\n" +
      "1. Run the **Connect Wizard** (`AISHA Dirigent: Connect`)\n" +
      "2. Or set it manually: `AISHA Dirigent: Set Active Story`\n\n" +
      "_The onboarding pipeline needs a story to pin expert rules to._\n\n" +
      "> **Tip:** Use `@aisha /instructions` to generate default rules without a story connection.",
    );
    return;
  }

  // Step 1: Analyze workspace
  stream.progress("Analyzing workspace…");
  const analysis = await getProjectAnalysis();

  // Merge user hints from prompt (e.g. "@aisha /onboard healthcare vue python")
  if (request.prompt.trim()) {
    const userHints = request.prompt.trim().split(/[\s,]+/).filter(Boolean);
    for (const hint of userHints) {
      if (!analysis.tech_stack.includes(hint)) {
        analysis.tech_stack.push(hint);
      }
    }
  }

  streamMarkdown(
    stream,
    `### 1. Project Analysis\n\n` +
    `- **Tech Stack:** ${analysis.tech_stack.join(", ") || "none detected"}\n` +
    `- **Domain:** ${analysis.domain?.join(", ") || "not specified"}\n` +
    `- **Risk Profile:** ${analysis.risk_profile ?? "not set"}\n\n`,
  );

  if (token.isCancellationRequested) return;

  // Step 2: Send analysis to backend to update story context
  stream.progress("Updating story context…");
  const detectResult = await callMcpTool("detect_project_context_from_analysis", {
    story_id: storyId,
    analysis,
  });

  if (token.isCancellationRequested) return;

  const detectJson = extractJson(detectResult);
  if (detectJson?.success) {
    const detected = detectJson.detected as Record<string, unknown> | undefined;
    streamMarkdown(
      stream,
      `### 2. Story Context Updated\n\n` +
      `- **Tech Stack:** ${(detected?.tech_stack as string[])?.join(", ") ?? "unchanged"}\n` +
      `- **Domain:** ${(detected?.domain as string[])?.join(", ") ?? "unchanged"}\n` +
      `- **Risk Profile:** ${(detected?.risk_profile as string) ?? "unchanged"}\n\n`,
    );
  } else {
    streamMarkdown(stream, "### 2. Story Context\n\n_Could not update — continuing with existing context._\n\n");
  }

  if (token.isCancellationRequested) return;

  // Step 3: Get rule recommendations
  stream.progress("Recommending expert rules…");
  const recommendResult = await callMcpTool("recommend_ruleset_for_story", {
    story_id: storyId,
  });

  if (token.isCancellationRequested) return;

  const recommendJson = extractJson(recommendResult);
  if (!recommendJson?.success) {
    streamMarkdown(
      stream,
      "### 3. Rule Recommendations\n\n_Could not generate recommendations. Is the knowledge base populated?_\n\n" +
      (extractMarkdown(recommendResult) ?? ""),
    );
    return;
  }

  const matchDetails = recommendJson.match_details as Array<{
    slug: string;
    title: string;
    category: string;
    total_score: number;
    tag_overlap: number;
  }> | undefined;
  const ruleIds = recommendJson.recommended_rule_ids as string[] | undefined;
  const totalRecommended = (recommendJson.total_recommended as number) ?? 0;

  if (!matchDetails?.length || !ruleIds?.length) {
    streamMarkdown(stream, "### 3. Rule Recommendations\n\n_No matching expert rules found for this project context._\n");
    return;
  }

  // Build recommendation table
  const lines: string[] = [
    `### 3. Rule Recommendations (${totalRecommended} rules)\n`,
    "| Rule | Category | Score | Tag Match |",
    "|------|----------|-------|-----------|",
  ];

  for (const m of matchDetails.slice(0, 20)) {
    const categoryLabel = m.category.replace(/_/g, " ");
    lines.push(`| ${m.title} | ${categoryLabel} | **${m.total_score}** | ${m.tag_overlap} |`);
  }

  if (matchDetails.length > 20) {
    lines.push(`| _…and ${matchDetails.length - 20} more_ | | | |`);
  }

  lines.push("");
  streamMarkdown(stream, lines.join("\n"));

  if (token.isCancellationRequested) return;

  // Step 4: Create ruleset from recommendations
  stream.progress("Creating story ruleset…");
  const createResult = await callMcpTool("create_story_ruleset", {
    story_id: storyId,
    rule_ids: ruleIds,
  });

  if (token.isCancellationRequested) return;

  const createJson = extractJson(createResult);
  if (createJson?.ruleset_id) {
    streamMarkdown(
      stream,
      `### 4. Ruleset Created\n\n` +
      `- **Ruleset ID:** \`${(createJson.ruleset_id as string).slice(0, 8)}…\`\n` +
      `- **Fingerprint:** \`${createJson.fingerprint ?? "generated"}\`\n` +
      `- **Rules pinned:** ${totalRecommended}\n\n`,
    );
  } else {
    streamMarkdown(
      stream,
      "### 4. Ruleset\n\n_Could not create ruleset._\n\n" +
      (extractMarkdown(createResult) ?? ""),
    );
    return;
  }

  if (token.isCancellationRequested) return;

  // Step 5: Sync copilot-instructions.md
  stream.progress("Syncing copilot-instructions.md…");
  const instructionsResult = await callMcpTool("generate_copilot_instructions", {
    story_id: storyId,
  });

  const instructionsMd = extractMarkdown(instructionsResult);
  if (instructionsMd) {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (root) {
      const stamped = ensureAutoGenMarker(instructionsMd);
      const outcome = await safeWriteFromUri(root.uri, ".github/copilot-instructions.md", stamped);

      if (outcome.outcome === "refused-user-owned") {
        streamMarkdown(
          stream,
          `### 5. Copilot Instructions Skipped\n\n` +
          `\`.github/copilot-instructions.md\` exists without an AISHA marker — looks manually authored. Delete it first if you want Dirigent to regenerate.`,
        );
      } else if (outcome.outcome === "backup-failed") {
        streamMarkdown(
          stream,
          `### 5. Copilot Instructions Skipped\n\n_Backup of existing file failed; write aborted._`,
        );
      } else {
        const ruleCount = (stamped.match(/^### /gm) ?? []).length;
        streamMarkdown(
          stream,
          `### 5. Copilot Instructions Synced\n\n` +
          `Written \`.github/copilot-instructions.md\` with **${ruleCount} rule sections**.${outcome.preservedUserSection ? " _User-section preserved._" : ""}\n\n` +
          `Copilot will now follow these expert rules for all interactions in this workspace.\n\n` +
          `---\n_Onboarding complete for story \`${storyId.slice(0, 8)}…\`_`,
        );
      }
    }
  } else {
    streamMarkdown(stream, "### 5. Instructions\n\n_Could not generate copilot-instructions.md._\n");
  }
}

// ──────────────────────────────────────────
// /local — Run a task on the local edge model
// ──────────────────────────────────────────

/** Valid subcommands for /local. */
const LOCAL_TASKS: Record<string, { task: TaskKind; systemPrompt: string }> = {
  recap: {
    task: "recap",
    systemPrompt:
      "You are a concise technical assistant. Summarize the provided content into clear bullet points. Focus on errors, failures, and actionable items.",
  },
  diff: {
    task: "filter",
    systemPrompt:
      "You are a code review assistant. Analyze the provided diff and summarize key changes, potential issues, and areas of concern.",
  },
  filter: {
    task: "filter",
    systemPrompt:
      "You are a context filtering assistant. Extract only the relevant parts from the provided input. Remove noise and irrelevant details.",
  },
};

/**
 * `/local` — Run a task on the local edge model (Ollama/vLLM).
 * Subcommands: recap, diff, filter.
 *
 * Usage: `@aisha /local recap <content>`
 */
async function handleLocal(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const env = getEnvironment();

  if (!isEdgeFirstEnabled()) {
    streamMarkdown(
      stream,
      "**Edge-first mode is disabled.** Enable it in settings: `aisha.dirigent.edgeFirst`.\n\n" +
        "_Edge mode routes simple tasks (recap, diff, filter) to your local LLM._",
    );
    return;
  }

  if (!env.edge.available) {
    streamMarkdown(
      stream,
      "**No local LLM runtime detected.** Make sure Ollama or Docker Desktop AI is running.\n\n" +
        `Checked endpoints: ${env.edge.endpoints.join(", ") || "none"}`,
    );
    return;
  }

  // Parse subcommand and content
  const parts = request.prompt.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  const content = parts.slice(1).join(" ");

  const taskDef = LOCAL_TASKS[subcommand];
  if (!taskDef) {
    const available = Object.keys(LOCAL_TASKS).join(", ");
    streamMarkdown(
      stream,
      `**Unknown subcommand:** \`${subcommand || "(empty)"}\`\n\nAvailable: ${available}\n\n` +
        "Usage: `@aisha /local recap <content>`",
    );
    return;
  }

  if (!content) {
    streamMarkdown(stream, `**Missing content.** Usage: \`@aisha /local ${subcommand} <text or paste>\``);
    return;
  }

  stream.progress(`Running ${subcommand} on edge model…`);

  const messages: ChatMessage[] = [
    { role: "system", content: taskDef.systemPrompt },
    { role: "user", content },
  ];

  const result = await edgeChat(messages, {
    task: taskDef.task,
  });

  if (token.isCancellationRequested) return;

  if (!result) {
    streamMarkdown(
      stream,
      `**Edge model unavailable for ${subcommand}.** The task could not be processed locally.\n\n` +
        "_Try running the task without /local — AISHA will route it through the backend._",
    );
    return;
  }

  streamMarkdown(stream, result.content);
  stream.markdown(`\n\n---\n> ${formatEdgeTag(result)}`);
}

// ──────────────────────────────────────────
// Router
// ──────────────────────────────────────────

const COMMAND_HANDLERS: Record<
  string,
  (
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => Promise<void>
> = {
  test: handleTest,
  quality: handleQuality,
  compliance: handleCompliance,
  estimate: handleEstimate,
  next: handleNext,
  instructions: handleInstructions,
  dirigent: handleDirigent,
  route: handleRoute,
  models: handleModels,
  eval: handleEval,
  proposals: handleProposals,
  status: handleStatus,
  stats: handleStats,
  onboard: handleOnboard,
  "connect-repo": handleConnectRepo,
  story: handleStory,
  local: handleLocal,
  health: handleStatus,
};

/**
 * Main chat request handler for `@aisha`.
 *
 * If a slash command is used, routes to the specific handler.
 * Otherwise, AISHA autonomously detects intent and orchestrates
 * the best response with proactive follow-up suggestions.
 */
export async function handleChatRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  let followUps: vscode.ChatFollowup[] = [];

  try {
    const handler = request.command
      ? COMMAND_HANDLERS[request.command]
      : undefined;

    if (handler) {
      // Explicit slash command — use dedicated handler
      await handler(request, stream, token);
    } else {
      // AUTONOMOUS FLOW — AISHA decides what to do
      followUps = await handleAutonomous(request, stream, token);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error occurred";
    stream.markdown(`**Error:** ${sanitizeErrorForChat(message)}`);
  }

  return {
    metadata: { followUps },
  };
}

/**
 * Clear the active moderation session.
 */
export function clearSession(): void {
  onSessionChanged.fire(null);
}

/**
 * Get current active session ID (for tree views).
 */
export function getActiveSessionId(): string | null {
  return getSessionSync()?.id ?? null;
}

// ──────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────

/**
 * Parse check types from user prompt (e.g. "rpc security types").
 * Falls back to a default set if nothing recognized.
 */
function parseCheckTypes(prompt: string): string[] {
  const known = [
    "rpc_pattern",
    "security",
    "types",
    "i18n",
    "error_handling",
    "testing",
    "performance",
    "accessibility",
  ];
  const found = known.filter((t) =>
    prompt.toLowerCase().includes(t.replace("_", " ")) ||
    prompt.toLowerCase().includes(t),
  );

  return found.length > 0
    ? found
    : ["rpc_pattern", "security", "types", "error_handling"];
}
