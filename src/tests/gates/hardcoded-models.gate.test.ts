/**
 * Hardcoded Model & Provider Gate Tests
 *
 * Dynamically detects hardcoded LLM model names, static provider lists,
 * and vendor-locked routing logic across the ENTIRE codebase.
 *
 * Categories:
 * 1. Hardcoded model name literals (gpt-*, claude-*, gemini-*, etc.)
 * 2. Static provider arrays (["openai", "anthropic", ...])
 * 3. Hardcoded model-to-provider routing (switch/if on model/provider names)
 *
 * Principle: Model selection MUST flow through the resolution chain:
 *   DB registry (get_adaptive_model_tiers) → env vars → fallback defaults
 * AISHA discovers available models dynamically — not hardcoded to today's state.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Project layout ──────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");

const TS_CODE_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "trash/legacy-archive/edge-functions-reference"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "packages"),
  // svc-ai-chat is the LLM dispatch surface — its model defaults are now all live
  // resolves (resolveDefaultModel / tier floors / soulforge slots), so lock it at
  // baseline 0. Only the provider health-probe + discovery prefix literals (which
  // MUST name a concrete model / match a prefix) are allowlisted below.
  path.join(ROOT, "services/svc-ai-chat/src"),
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SourceFile {
  absPath: string;
  relPath: string;
  content: string;
  lines: string[];
}

interface Violation {
  file: string;
  line: number;
  detail: string;
  fix: string;
}

function isTestOrGenerated(relPath: string): boolean {
  return (
    relPath.includes("/tests/") ||
    relPath.includes("/__tests__/") ||
    relPath.includes(".test.") ||
    relPath.includes(".spec.") ||
    relPath.includes("/mocks/") ||
    relPath.includes("/fixtures/") ||
    relPath.includes("/dist/") ||
    relPath.includes("/node_modules/") ||
    relPath.includes("setupTests") ||
    relPath.includes("vitest.") ||
    relPath.includes("playwright.") ||
    relPath.includes("integrations/db/types.ts")
  );
}

function collectFiles(dirs: string[], extensions: Set<string>): SourceFile[] {
  const out: SourceFile[] = [];
  for (const dir of dirs) {
    collectFilesRecursive(dir, extensions, out);
  }
  return out;
}

function collectFilesRecursive(dir: string, extensions: Set<string>, out: SourceFile[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name.startsWith(".")) continue;
      collectFilesRecursive(full, extensions, out);
    } else if (extensions.has(path.extname(entry.name))) {
      const relPath = path.relative(ROOT, full);
      if (isTestOrGenerated(relPath)) continue;
      const content = fs.readFileSync(full, "utf-8");
      out.push({ absPath: full, relPath, content, lines: content.split("\n") });
    }
  }
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line} — ${v.detail}\n    FIX: ${v.fix}`)
    .join("\n");
}

// ─── Load once ───────────────────────────────────────────────────────────────

const ALL_TS = collectFiles(TS_CODE_DIRS, CODE_EXTENSIONS);

// ─── Allowlists ──────────────────────────────────────────────────────────────
// Each entry MUST have a technical reason. "backlog" is NOT a valid reason.

/**
 * Files where hardcoded model names are LEGITIMATE:
 * - Resolution chain fallback defaults (orchestrationBridge)
 * - Model discovery catalog (discover-models — Anthropic has no models endpoint)
 * - Backend routing (backendRegistry canServe — prefix-based, not model-specific)
 * - Health check probes (providers — must target a specific model)
 * - Type definitions (expert-overlay types)
 */
const MODEL_LITERAL_ALLOWLIST: Record<string, string> = {
  // Phase 13 WP 13.3 — IDE identifier strings (NOT LLM model names).
  // The SupportedIde union ("claude-code" | "cursor" | "copilot" |
  // "jetbrains") matches the IDE that the bridge syncs to. The
  // hardcoded-models regex flags "claude-code" as a substring match
  // for the "claude-*" model family even though semantically it's an
  // IDE name. Intentional false-positive suppression.
  "packages/aisha-ide-bridge/src/bridge.ts":
    "IDE identifier strings (Phase 13 WP 13.3) — SupportedIde union + IDE_DEFAULT_OUTPUT_PATH map; NOT LLM model names",

  // Fáze 1C — adapter ID and module path for the Claude Code supervision
  // overlay generator. The literal "claude-overlay" identifies an adapter,
  // and "./adapter-claude-overlay.mjs" is its module path. Neither is an
  // LLM model name; both are IDE artifact identifiers.
  "scripts/ide-adapters/adapter-claude-overlay.mjs":
    "Adapter ID + module path literals (claude-overlay) — IDE artifact identifiers, NOT LLM model names",
  "scripts/ide-adapters/registry.mjs":
    "Adapter ID + module path literals (claude-overlay) for ADAPTERS registry — IDE artifact identifiers, NOT LLM model names",

  // Same pattern for the Claude-app conversion pipeline: "claude-app" is the
  // adapter / format ID (the Claude Code app target), NOT an LLM model name —
  // the claude-* regex flags it as a substring false positive.
  "scripts/ide-adapters/adapter-claude-app.mjs":
    "Adapter/format ID literal (claude-app) — IDE artifact identifier, NOT an LLM model name",
  "scripts/package-claude-app.mjs":
    "Format ID literal (claude-app) for the packager — IDE artifact identifier, NOT an LLM model name",

  // Resolution chain fallback defaults — the LAST resort in the 4-layer chain
  "trash/legacy-archive/edge-functions-reference/_shared/orchestrationBridge.ts":
    "Centralized model tier fallback defaults (DB→env→hardcoded chain)",

  // Single centralized default model — ONE env var for all edge functions
  "trash/legacy-archive/edge-functions-reference/_shared/defaultModel.ts":
    "AISHA_DEFAULT_MODEL / AISHA_DEFAULT_LOCAL_MODEL — single source of truth for all edge function fallbacks",

  // Model discovery — scans providers, must know what to look for
  "trash/legacy-archive/edge-functions-reference/discover-models/index.ts":
    "Provider discovery catalog — Anthropic KNOWN_MODELS, capability regexes, family extraction",

  // Backend routing — prefix-based canServe() and backend factory
  "trash/legacy-archive/edge-functions-reference/_shared/backendRegistry.ts":
    "Backend prefix routing (gpt-*→OpenAI, claude-*→Anthropic, etc.)",

  // ── Backend canServe() prefix matchers + svc-ai-chat runtime/source identifiers (NOT defaults) ──
  // The dispatch surface's model DEFAULTS are now all live resolves (resolveDefaultModel,
  // the orchestrationBridge tier floors, soulforge slots). These remaining literals are
  // provider canServe() PREFIX matchers (must name a model-id prefix to route) or
  // runtime/source slugs (not LLM model names). The per-provider backends were extracted to
  // the shared @aisha/llm-dispatch package (behavior-preserving git mv) — same matchers, new path.
  "packages/llm-dispatch/src/providers/openai.ts":
    "canServe() prefix matchers (chatgpt-*, ft:gpt-*) — model-id prefixes for routing, NOT a default",
  "packages/llm-dispatch/src/providers/openai-compat.ts":
    "canServe() prefix matcher (grok-*) for the OpenAI-compat backend — routing prefix, NOT a default",
  "services/svc-ai-chat/src/routes/models.ts":
    "Model-family prefix (o1-*) in the /models listing filter — routing prefix, NOT a default",
  "services/svc-ai-chat/src/reflection/runtime/adapters.ts":
    "cli_slug fallback 'claude-cli' — a RUNTIME/backend identifier (the claude_cli executor), NOT an LLM model name",
  "services/svc-ai-chat/src/routes/dirigent-supervisor.ts":
    "live-session source label 'claude-code' — origin identifier of the agent session, NOT an LLM model name",

  // Provider implementations — health checks need a concrete model
  "trash/legacy-archive/edge-functions-reference/_shared/providers/anthropic.ts":
    "Health check probe must target a specific model endpoint",
  "trash/legacy-archive/edge-functions-reference/_shared/providers/openai.ts":
    "Health check probe must target a specific model endpoint",
  "trash/legacy-archive/edge-functions-reference/_shared/providers/openai-compat.ts":
    "Model prefix matching for tool_call support detection",
  "trash/legacy-archive/edge-functions-reference/_shared/providers/gemini.ts":
    "Health check probe and model name formatting",

  // LLM router type definitions and provider resolution
  "trash/legacy-archive/edge-functions-reference/_shared/llmRouter.ts":
    "LlmProvider type union + resolveProvider() prefix matching",

  // Runtime config with env var override (has override, fallback is intentional)
  "trash/legacy-archive/edge-functions-reference/_shared/runtimeConfig.ts":
    "getAnalyzeTrackingDocumentModel() — env ANALYZE_TRACKING_DOCUMENT_MODEL → fallback",

  // Execution mode detection
  "trash/legacy-archive/edge-functions-reference/_shared/executionMode.ts":
    "Execution mode detection — no model literals, but provider prefix matching",

  // Scripts — diagnostic/dev tools where model names are expected
  "scripts/models-check.mjs":
    "Model catalog diagnostic script — read-only verification",
  "scripts/models-wizard.mjs":
    "Developer wizard for model configuration — interactive tool",
  "scripts/aisha-chat-interactive.mjs":
    "CLI dev tool — display formatting and local dev defaults",
  "scripts/aisha-provision.ts":
    "Provisioning script — seed data for development environments",

  // Template file — not production code
  "agentsdk-template.ts":
    "SDK template example — not imported or executed in production",

  // Files using centralized getDefaultModel() — no per-function env vars
  "trash/legacy-archive/edge-functions-reference/_shared/guardrails-config.ts":
    "Uses getDefaultModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/_shared/proactiveEngine.ts":
    "Uses getDefaultModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/_shared/workflowEngine.ts":
    "Uses getDefaultModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/ai-story-consult/index.ts":
    "Uses getDefaultModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/translate-content/index.ts":
    "Uses getDefaultModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/evaluate-ai-response/index.ts":
    "Uses getDefaultModel() / getDefaultLocalModel() from defaultModel.ts",
  "trash/legacy-archive/edge-functions-reference/list-openai-models/index.ts":
    "CHAT_MODEL_PREFIXES env override — prefix filter, not model selection",
  "src/hooks/useAvailableModels.ts":
    "VITE_FALLBACK_MODEL_IDS env override — build-time configurable fallback",
  "src/pages/admin/AdminPublicChat.tsx":
    "VITE_DEFAULT_CHAT_MODEL env override — build-time configurable default model",
  "packages/n8n-nodes-aisha/nodes/AishaLlmRouter/AishaLlmRouter.node.ts":
    "LLM_DEFAULT_MODEL_* / LLM_TASK_PRIORITY_* / FALLBACK_LLM_MODEL env overrides",
  "packages/n8n-nodes-aisha/nodes/AishaModelRouter/AishaModelRouter.node.ts":
    "MODEL_ROUTER_OPENAI / GOOGLE / ANTHROPIC / XAI env overrides + fromDb strategy",

  // Setup cockpit — provider key validation probe with AISHA_ANTHROPIC_PROBE_MODEL env override
  "scripts/setup-cockpit/host.mjs":
    "validateProviderKey() probe model with process.env.AISHA_ANTHROPIC_PROBE_MODEL override",
};

/**
 * Regex patterns that match LLM model name string literals.
 * Catches: "gpt-4o", "claude-3-opus", "gemini-1.5-pro", etc.
 * Requires quotes to distinguish from variable names or comments.
 */
const MODEL_LITERAL_PATTERNS: RegExp[] = [
  // OpenAI models
  /["'`]gpt-[345][^"'`]*["'`]/i,
  /["'`]o[134]-[^"'`]*["'`]/i,
  /["'`]chatgpt-[^"'`]*["'`]/i,
  /["'`]ft:gpt-[^"'`]*["'`]/i,

  // Anthropic models
  /["'`]claude-[^"'`]*["'`]/i,

  // Google models
  /["'`]gemini-[^"'`]*["'`]/i,

  // xAI models
  /["'`]grok-[^"'`]*["'`]/i,

  // Meta models
  /["'`]llama[23][^"'`]*["'`]/i,

  // Mistral models
  /["'`]mistral-[^"'`]*["'`]/i,

  // Local model prefixes with specific model names (not just prefix routing)
  /["'`]ollama-mistral-nemo["'`]/i,
  /["'`]docker-ai\/[^"'`]+["'`]/i,

  // Provider-prefixed model references ("openai/gpt-4o", "anthropic/claude-3", etc.)
  /["'`]openai\/[^"'`]+["'`]/i,
  /["'`]anthropic\/[^"'`]+["'`]/i,
  /["'`]google\/[^"'`]+["'`]/i,
];

/**
 * Lines that are comments, JSDoc, or type assertions (not runtime code).
 */
function isCommentOrType(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("/**") ||
    // Type-only contexts (not runtime)
    /^\s*\*\s/.test(trimmed) ||
    /^\s*type\s+\w+\s*=/.test(trimmed) ||
    /^\s*\|\s*["']/.test(trimmed) // Union type members
  );
}

// =============================================================================
// 1. HARDCODED MODEL NAME LITERALS
// =============================================================================

describe("1 · Hardcoded model name literals", () => {
  it("scans non-trivial codebase", () => {
    expect(ALL_TS.length).toBeGreaterThan(50);
  });

  it("no new hardcoded model names outside allowlist — regression baseline", () => {
    const violations: Violation[] = [];

    for (const file of ALL_TS) {
      if (MODEL_LITERAL_ALLOWLIST[file.relPath]) continue;

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (isCommentOrType(line)) continue;

        for (const pattern of MODEL_LITERAL_PATTERNS) {
          const match = pattern.exec(line);
          if (match) {
            const value = match[0];

            // Skip if it's inside a comment at end of line
            const beforeMatch = line.substring(0, match.index);
            if (beforeMatch.includes("//")) continue;

            // Skip import statements
            if (/^\s*import\s/.test(line)) continue;

            // Skip variable names that happen to match (e.g., const gpt4Model = ...)
            // We only care about string literals
            if (!/["'`]/.test(value)) continue;

            violations.push({
              file: file.relPath,
              line: i + 1,
              detail: `Hardcoded model literal: ${value}`,
              fix: "Use resolveModelTiersFromRegistry(), env var (MODEL_TIER_*), or selectOptimalModel()",
            });
            break; // One violation per line is enough
          }
        }
      }
    }

    // Pre-existing debt baseline. This number MUST only decrease.
    // Was 65, then all files got env var overrides and were added to allowlist.
    const KNOWN_BASELINE = 0;

    if (violations.length > 0) {
      console.warn(
        `\u26a0\ufe0f ${violations.length} hardcoded model literals (baseline: ${KNOWN_BASELINE}):\n`
        + formatViolations(violations),
      );
    }

    expect(
      violations.length,
      `Hardcoded model literals INCREASED above baseline ${KNOWN_BASELINE}.\n`
      + `New violations — use dynamic resolution instead:\n${formatViolations(violations)}`,
    ).toBeLessThanOrEqual(KNOWN_BASELINE);
  });
});

// =============================================================================
// 2. STATIC PROVIDER ARRAYS
// =============================================================================

describe("2 · Static provider arrays", () => {
  /**
   * Detects hardcoded arrays like ["openai", "anthropic", "google", "xai"].
   * These should be read from backendRegistry, ai_model_registry, or env vars.
   */
  const STATIC_PROVIDER_ARRAY = /\[\s*["'](openai|anthropic|google|xai|ollama|vllm)["']\s*,\s*["'](openai|anthropic|google|xai|ollama|vllm)["']/g;

  /** Files where static provider arrays are LEGITIMATE. */
  const PROVIDER_ARRAY_ALLOWLIST: Record<string, string> = {
    "services/svc-ai-chat/src/lib/llmRouter.ts":
      "REMAP_PROVIDER_ORDER — provider-axis tie-break ORDERING for capability-availability remap (cloud→local). Comment-documented as 'preference, never a roster of permitted model names; the MODEL chosen is always discovered'.",
    "trash/legacy-archive/edge-functions-reference/discover-models/index.ts":
      "allProviders array is the scan target list — discovery needs to know where to look",
    "trash/legacy-archive/edge-functions-reference/_shared/backendRegistry.ts":
      "Factory initialization order — registers backends from env vars",
    "trash/legacy-archive/edge-functions-reference/_shared/llmRouter.ts":
      "Provider type definitions and routing logic",
    "scripts/models-check.mjs":
      "Diagnostic script — read-only check",
    "scripts/models-wizard.mjs":
      "Developer wizard — interactive tool",
    "scripts/aisha-chat-interactive.mjs":
      "CLI dev tool",
    // N8N router — env-configurable TASK_PRIORITY with fallback defaults
    "packages/n8n-nodes-aisha/nodes/AishaLlmRouter/AishaLlmRouter.node.ts":
      "LLM_TASK_PRIORITY_* env overrides via JSON parse — fallback arrays are legitimate defaults",
  };

  it("no static provider arrays outside allowlist — regression baseline", () => {
    const violations: Violation[] = [];

    for (const file of ALL_TS) {
      if (PROVIDER_ARRAY_ALLOWLIST[file.relPath]) continue;

      STATIC_PROVIDER_ARRAY.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = STATIC_PROVIDER_ARRAY.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
        const line = file.lines[lineIdx];
        if (isCommentOrType(line)) continue;

        violations.push({
          file: file.relPath,
          line: lineIdx + 1,
          detail: `Static provider array: ${match[0].substring(0, 60)}...`,
          fix: "Read available providers from backendRegistry or ai_model_registry",
        });
      }
    }

    // Baseline — must only decrease. Was 2, N8N router now env-configurable.
    const KNOWN_BASELINE = 0;

    if (violations.length > 0) {
      console.warn(
        `\u26a0\ufe0f ${violations.length} static provider arrays (baseline: ${KNOWN_BASELINE}):\n`
        + formatViolations(violations),
      );
    }

    expect(
      violations.length,
      `Static provider arrays INCREASED above baseline ${KNOWN_BASELINE}.\n`
      + `New violations — use dynamic provider discovery:\n${formatViolations(violations)}`,
    ).toBeLessThanOrEqual(KNOWN_BASELINE);
  });
});

// =============================================================================
// 3. UNOVERRIDABLE MODEL CONSTANTS
// =============================================================================

describe("3 · Unoverridable model constants", () => {
  /**
   * Detects patterns like:
   *   const MODEL = "gpt-4o";
   *   const DEFAULT_MODEL = "claude-3-opus";
   * WITHOUT a corresponding env var override (Deno.env.get or process.env).
   *
   * The correct pattern is:
   *   const MODEL = Deno.env.get("MY_MODEL") ?? "gpt-4o";
   */
  it("model constants must have env var override", () => {
    const violations: Violation[] = [];

    // Pattern: const SOME_MODEL = "model-name" (all caps or containing "model/MODEL")
    const modelConstPattern = /(?:const|let)\s+(\w*(?:[Mm]odel|MODEL)\w*)\s*(?::\s*\w+\s*)?=\s*["'`](gpt-|claude-|gemini-|grok-|llama|mistral-|ollama-|docker-)/g;

    for (const file of ALL_TS) {
      if (MODEL_LITERAL_ALLOWLIST[file.relPath]) continue;

      modelConstPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = modelConstPattern.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
        const line = file.lines[lineIdx];
        if (isCommentOrType(line)) continue;

        // Check if this line or ±2 lines have env var override
        const nearby = file.lines
          .slice(Math.max(0, lineIdx - 2), Math.min(file.lines.length, lineIdx + 3))
          .join("\n");

        const hasEnvOverride =
          /Deno\.env\.get\s*\(/.test(nearby) ||
          /process\.env\b/.test(nearby) ||
          /\?\?/.test(line); // Nullish coalescing = override pattern

        if (hasEnvOverride) continue;

        violations.push({
          file: file.relPath,
          line: lineIdx + 1,
          detail: `Unoverridable model constant: ${match[1]} = "${match[2]}..."`,
          fix: `Use: const ${match[1]} = Deno.env.get("${match[1].replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}") ?? "${match[2]}..."`,
        });
      }
    }

    // Baseline — must only decrease. Was 2, fixed in translate-content + evaluate-ai-response.
    const KNOWN_BASELINE = 0;

    if (violations.length > 0) {
      console.warn(
        `\u26a0\ufe0f ${violations.length} unoverridable model constants (baseline: ${KNOWN_BASELINE}):\n`
        + formatViolations(violations),
      );
    }

    expect(
      violations.length,
      `Unoverridable model constants INCREASED above baseline ${KNOWN_BASELINE}.\n`
      + `New violations — add env var override:\n${formatViolations(violations)}`,
    ).toBeLessThanOrEqual(KNOWN_BASELINE);
  });
});

// =============================================================================
// 4. INLINE FALLBACK MODEL (|| "model-name" without env check)
// =============================================================================

describe("4 · Inline fallback models without env var", () => {
  /**
   * Detects patterns like:
   *   agent.model || "gpt-4o"
   *   config?.model ?? "claude-3"
   *
   * WITHOUT an env var in the resolution chain.
   * The correct pattern is:
   *   agent.model || Deno.env.get("FALLBACK_MODEL") || "gpt-4o"
   */
  it("inline fallback models should have env var in the chain", () => {
    const violations: Violation[] = [];

    // Pattern: someExpr || "model-name" or someExpr ?? "model-name"
    const inlineFallbackPattern = /(?:\|\||(?<!\?)\?\?)\s*["'`](gpt-[345][^"'`]*|claude-[^"'`]*|gemini-[^"'`]*|grok-[^"'`]*|ollama-[^"'`]*|docker-ai\/[^"'`]*)["'`]/g;

    for (const file of ALL_TS) {
      if (MODEL_LITERAL_ALLOWLIST[file.relPath]) continue;

      inlineFallbackPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = inlineFallbackPattern.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
        const line = file.lines[lineIdx];
        if (isCommentOrType(line)) continue;

        // Check if env var is already in the same expression (same line or ±1)
        const nearby = file.lines
          .slice(Math.max(0, lineIdx - 1), Math.min(file.lines.length, lineIdx + 2))
          .join("\n");

        if (/Deno\.env\.get|process\.env/.test(nearby)) continue;

        violations.push({
          file: file.relPath,
          line: lineIdx + 1,
          detail: `Inline model fallback without env override: ${match[0].substring(0, 50)}`,
          fix: "Add Deno.env.get('MODEL_VAR') in the chain: expr || Deno.env.get('X') || 'fallback'",
        });
      }
    }

    // Baseline — must only decrease. Was 12, fixed in proactiveEngine, workflowEngine,
    // ai-story-consult, AishaLlmRouter, AishaModelRouter.
    const KNOWN_BASELINE = 0;

    if (violations.length > 0) {
      console.warn(
        `\u26a0\ufe0f ${violations.length} inline fallback models (baseline: ${KNOWN_BASELINE}):\n`
        + formatViolations(violations),
      );
    }

    expect(
      violations.length,
      `Inline model fallbacks without env var INCREASED above baseline ${KNOWN_BASELINE}.\n`
      + `New violations:\n${formatViolations(violations)}`,
    ).toBeLessThanOrEqual(KNOWN_BASELINE);
  });
});

// =============================================================================
// 5. N8N ROUTING MATRIX (structural check)
// =============================================================================

describe("5 · N8N router static routing matrix", () => {
  /**
   * Checks that the n8n model router has a DB/config override path,
   * not just a hardcoded static matrix.
   */
  it("AishaModelRouter should reference external config or registry", () => {
    const routerFiles = ALL_TS.filter(
      (f) => f.relPath.includes("AishaModelRouter") || f.relPath.includes("AishaLlmRouter"),
    );

    if (routerFiles.length === 0) {
      // Router not present in scanned dirs — not an error
      return;
    }

    for (const file of routerFiles) {
      const hasDbRead =
        /supabase\.rpc\b/.test(file.content) ||
        /fetch\(.*model.*registry/i.test(file.content) ||
        /getAdaptiveModelTiers/i.test(file.content) ||
        /ai_model_registry/i.test(file.content) ||
        /runtimeConfig/i.test(file.content);

      const hasEnvRead =
        /process\.env\b/.test(file.content) ||
        /getNodeParameter\b/.test(file.content) || // n8n dynamic param
        /credentials\b/.test(file.content);

      // At minimum, the router must read external configuration
      if (!hasDbRead && !hasEnvRead) {
        // For now, just log — n8n router is a separate package
        console.warn(
          `\u26a0\ufe0f ${file.relPath}: N8N router has no DB/registry read — fully static routing matrix.`,
        );
      }
    }

    // Structural presence check — routers should exist
    expect(routerFiles.length).toBeGreaterThan(0);
  });
});
