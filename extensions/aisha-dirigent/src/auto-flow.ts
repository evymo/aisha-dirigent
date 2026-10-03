/**
 * Auto-flow — Event-driven AISHA automation.
 *
 * Monitors workspace events (saves, git operations, diagnostics) and
 * proactively provides AISHA guidance without manual user commands.
 *
 * This is a core part of the autonomous development management —
 * AISHA watches what you do and provides expertise automatically.
 *
 * @module
 */

import * as vscode from "vscode";
import { callN8nAgent } from "./mcp-client";
import { getDirigentConfig } from "./config";
import { getWorkspaceContext, getGitBranch, invalidateTechStackCache } from "./workspace";
import { resolveStoryContext } from "./story-context";
import { recordFileSave, scheduleConfigRefresh } from "./config-writer";
import { shouldAutoRegenerate } from "./generators/auto-regen-gate";
import { recordChildProcess } from "./resource-tracker";
import { edgeChat } from "./local-llm-client";
import { isEdgeFirstEnabled } from "./compute-tier";

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────

/** Debounce delay for save events (ms) */
const SAVE_DEBOUNCE_MS = 3000;
/** Debounce delay for diagnostics batch window (ms) — URIs are collected, then processed */
const DIAGNOSTIC_BATCH_WINDOW_MS = 3000;
/** Extended debounce for patterns known to be transient (module resolution, type regen) */
const TRANSIENT_PATTERN_DEBOUNCE_MS = 6000;
/** Max URIs to process per diagnostic batch (prioritized: open editors first) */
const DIAGNOSTIC_BATCH_MAX_URIS = 5;
/** Minimum time between proactive notifications (ms) */
const NOTIFICATION_COOLDOWN_MS = 15_000;
/** Max number of diagnostics lines sent to AISHA in a proactive debug prompt */
const MAX_DEBUG_DIAGNOSTICS = 3;
/** Inactivity threshold — skip diagnostics processing when user is idle (ms) */
const USER_ACTIVITY_TIMEOUT_MS = 60_000;

/**
 * Known transient TS error patterns — these are very likely false positives
 * caused by TS server lag (file creation, type regeneration, module graph update).
 * Errors matching these get a longer debounce via TRANSIENT_PATTERN_DEBOUNCE_MS.
 */
const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  // Module resolution — appears after new file/rename until TS reindexes
  /Cannot find module/i,
  /Nepovedlo se najít modul/i, // Czech locale
  /Module '.*' has no exported member/i,
  /has no exported member/i,
  // Stale types.ts — large union mismatch after type regeneration
  /is not assignable to parameter of type/i,
  /nejde přiřadit k parametru typu/i, // Czech locale
  // Type not found — appears briefly during compilation
  /Cannot find name/i,
  /Nepovedlo se najít název/i, // Czech locale
  // Import path resolution during file moves
  /Module not found/i,
  /Could not find a declaration file/i,
];

/** Files that are known to cause transient diagnostics after regeneration */
const TRANSIENT_FILE_PATTERNS: RegExp[] = [
  /types\.ts$/, // AISHA generated types
  /\.d\.ts$/,  // declaration files
  /locales\/.*\.json$/, // compiled i18n
];
/** Patterns that trigger compliance hints on save */
const COMPLIANCE_PATTERNS = [
  /AISHA\/migrations\//,
  /AISHA\/sql\//,
  /src\/hooks\//,
  /src\/lib\/schemas\//,
  /src\/integrations\//,
];
/** Patterns for test files */
const TEST_PATTERNS = [/\.test\.(ts|tsx)$/, /\.spec\.(ts|tsx)$/];
/** Patterns for i18n segment files */
const I18N_PATTERNS = [/src\/i18n\/segments\//];
/** Patterns for Zod schema files — silent data loss risk with parseRpcArraySafe */
const SCHEMA_PATTERNS = [/src\/lib\/schemas\/.*\.ts$/];

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────

let lastNotificationTime = 0;
let saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let lastUserActivityAt = Date.now();
const lastDiagnosticPromptSignatures = new Map<string, string>();

// ── Batched diagnostics state ──
/** Pending URIs waiting for batch processing */
const pendingDiagnosticUris = new Set<string>();
/** Single batch timer — fires after DIAGNOSTIC_BATCH_WINDOW_MS of inactivity */
let diagnosticBatchTimer: ReturnType<typeof setTimeout> | undefined;
/** Recheck timers for transient patterns (per-URI, separate from batch) */
const transientRecheckTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Session-level auto-approve: when true, briefs go to chat without asking. Reset on extension restart. */
let autoSendToChat = false;

// ── findFiles cache (TTL-based) ──────────────────────────
const FIND_FILES_CACHE_TTL_MS = 60_000; // 60s

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

/** Cache: test file existence by source file path */
const testExistsCache = new Map<string, CacheEntry<{ testPath: string; exists: boolean }>>();
/** Cache: barrel index content (single entry, refreshed on index.ts save) */
let barrelContentCache: CacheEntry<string> | null = null;

function isCacheValid<T>(entry: CacheEntry<T> | undefined | null): entry is CacheEntry<T> {
  return entry != null && Date.now() - entry.cachedAt < FIND_FILES_CACHE_TTL_MS;
}

/**
 * Log to the AISHA output channel (visible in VS Code Output panel).
 */
function log(msg: string): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Auto-Flow");
  }
  outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Check cooldown — prevent notification spam.
 */
function canNotify(): boolean {
  const now = Date.now();
  if (now - lastNotificationTime < NOTIFICATION_COOLDOWN_MS) return false;
  lastNotificationTime = now;
  return true;
}

// ──────────────────────────────────────────
// Dirigent Brief — Development State Assessment
// ──────────────────────────────────────────

/** File role detected from path patterns */
type FileRole = "hook" | "component" | "schema" | "migration" | "test" | "i18n" | "page" | "sql_function" | "edge_function" | "other";

/** Development state for a given file */
interface DevStateItem {
  label: string;
  status: "ok" | "missing" | "warning";
  path?: string;
}

/**
 * Detect the role of a file from its workspace-relative path.
 */
function detectFileRole(filePath: string): FileRole {
  if (TEST_PATTERNS.some(p => p.test(filePath))) return "test";
  if (/src\/hooks\/use[A-Z].*\.ts$/.test(filePath)) return "hook";
  if (/src\/components\/.*\.(tsx|ts)$/.test(filePath)) return "component";
  if (/src\/lib\/schemas\/.*\.ts$/.test(filePath)) return "schema";
  if (/((?:AISHA|aisha\/db)\/migrations)\/.*\.sql$/.test(filePath)) return "migration";
  if (I18N_PATTERNS.some(p => p.test(filePath))) return "i18n";
  if (/src\/pages\/.*\.(tsx|ts)$/.test(filePath)) return "page";
  if (/((?:AISHA|aisha\/db)\/sql\/functions)\//.test(filePath)) return "sql_function";
  if (/(AISHA\/functions|archive\/edge-functions-reference|aisha\/db\/sql\/functions)\//.test(filePath)) return "edge_function";
  return "other";
}

/**
 * Check if a test file exists for a given source file.
 * Uses in-memory cache (60s TTL) to avoid repeated findFiles calls.
 */
async function checkTestExists(filePath: string): Promise<{ testPath: string; exists: boolean }> {
  // Check cache first
  const cached = testExistsCache.get(filePath);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  const fileName = filePath.split("/").pop()?.replace(/\.(tsx?)$/, "") ?? "";
  const role = detectFileRole(filePath);

  let testPath: string;
  if (role === "hook") {
    testPath = `src/tests/hooks/${fileName}.test.ts`;
  } else if (role === "component") {
    testPath = `src/tests/components/${fileName}.test.tsx`;
  } else {
    testPath = `src/tests/${fileName}.test.ts`;
  }

  const found = await vscode.workspace.findFiles(testPath, null, 1);
  const result = { testPath, exists: found.length > 0 };
  testExistsCache.set(filePath, { value: result, cachedAt: Date.now() });
  return result;
}

/**
 * Check if a hook is exported from the barrel index.
 * Caches barrel content (60s TTL, invalidated on index.ts save).
 */
async function checkBarrelExport(hookName: string): Promise<boolean> {
  // Use cached barrel content if valid
  if (isCacheValid(barrelContentCache)) {
    return barrelContentCache.value.includes(hookName);
  }

  const indexFiles = await vscode.workspace.findFiles("src/hooks/index.ts", null, 1);
  if (indexFiles.length === 0) return false;
  try {
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexFiles[0]));
    barrelContentCache = { value: content, cachedAt: Date.now() };
    return content.includes(hookName);
  } catch {
    return false;
  }
}

/**
 * Assess the development state around a specific file.
 */
async function assessDevState(filePath: string): Promise<DevStateItem[]> {
  const items: DevStateItem[] = [];
  const role = detectFileRole(filePath);
  const fileName = filePath.split("/").pop()?.replace(/\.(tsx?)$/, "") ?? "";

  // Source file exists (always OK — we're looking at it)
  items.push({ label: `${role === "hook" ? "Hook" : role === "component" ? "Component" : "File"}: ${filePath}`, status: "ok", path: filePath });

  // Test existence check (for hooks, components, schemas)
  if (role === "hook" || role === "component" || role === "schema") {
    const test = await checkTestExists(filePath);
    items.push({
      label: `Test: ${test.testPath}`,
      status: test.exists ? "ok" : "missing",
      path: test.testPath,
    });
  }

  // Hook-specific: barrel export
  if (role === "hook") {
    const hookName = fileName;
    const inBarrel = await checkBarrelExport(hookName);
    items.push({
      label: "Barrel export: src/hooks/index.ts",
      status: inBarrel ? "ok" : "missing",
      path: "src/hooks/index.ts",
    });
  }

  // Check if types.ts has uncommitted changes (git diff)
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
      const { execSync } = await import("child_process");
      const diff = execSync("git diff --name-only HEAD", { cwd: root, timeout: 3000, encoding: "utf-8" }).trim();
      recordChildProcess();
      if (diff.includes("src/integrations/AISHA/types.ts")) {
        items.push({ label: "Types: src/integrations/AISHA/types.ts modified but uncommitted", status: "warning" });
      }
    }
  } catch { /* ignore git errors */ }

  return items;
}

/**
 * Get KB rules relevant for a specific file role.
 */
function getKbRulesForRole(role: FileRole): string[] {
  const rules: string[] = [];
  switch (role) {
    case "hook":
      rules.push("RPC-only: use AISHA.rpc(), never .from()");
      rules.push("Zod validation on every API response: schema.parse(data)");
      rules.push("No console.* — use safeError() from @/lib/security/safeLogger");
      rules.push("Export hook from src/hooks/index.ts barrel");
      break;
    case "component":
      rules.push("No hardcoded text in JSX — use t(\"key\") from useTranslation()");
      rules.push("No emoji in UI — use lucide-react icons");
      rules.push("Components never call API directly — use hooks");
      rules.push("Wrap sensitive data in <ErrorBoundary>");
      break;
    case "schema":
      rules.push("CRITICAL: parseRpcArraySafe uses safeParse — silently drops invalid items!");
      rules.push("Run tests IMMEDIATELY after any Zod schema change");
      rules.push("Type inference: type MyType = z.infer<typeof mySchema>");
      break;
    case "migration":
      rules.push("Register: npm run db:migration:register");
      rules.push("Apply: npm run db:migrate:local");
      rules.push("Generate types: npm run db:types:gen:local");
      rules.push("No psql meta-commands (\\connect, \\set, \\i, \\copy)");
      rules.push("SECURITY DEFINER + SET search_path for anon functions");
      break;
    case "i18n":
      rules.push("EN is canonical key set — edit src/i18n/segments/en/*.json");
      rules.push("No fallbacks: t(\"key\", \"Fallback\") is FORBIDDEN");
      rules.push("Run npm run i18n:check before commit");
      break;
    case "test":
      rules.push("Mock must match implementation — check hook before writing test");
      rules.push("Use vi.mocked(AISHA.rpc) consistently");
      rules.push("Avoid fragile toHaveBeenCalledTimes(1) — React re-renders cause multiple calls");
      break;
    case "page":
      rules.push("Pages use hooks for data access, not direct API calls");
      rules.push("All UI text via t(\"key\") — no hardcoded strings");
      break;
    default:
      rules.push("No any types — use proper types or unknown + type guard");
      rules.push("No console.* — use safeError()");
  }
  return rules;
}

/**
 * Build workflow directives — prioritized next steps for the agent.
 * Test-first philosophy: if test is missing, creating it is ALWAYS step 1.
 */
function getWorkflowDirectives(role: FileRole, state: DevStateItem[], filePath: string): string[] {
  const directives: string[] = [];
  const missingTest = state.find(s => s.label.startsWith("Test:") && s.status === "missing");
  const missingBarrel = state.find(s => s.label.startsWith("Barrel export:") && s.status === "missing");

  // Test-first: ALWAYS priority #1 when test is missing
  if (missingTest?.path) {
    directives.push(`Write test FIRST: ${missingTest.path}`);
  }

  // Fix any errors (caller adds these)
  // — intentionally left as a slot for the caller to insert error fixes

  // Barrel export
  if (missingBarrel) {
    directives.push("Add barrel export to src/hooks/index.ts");
  }

  // Role-specific verification steps
  switch (role) {
    case "hook":
    case "component":
    case "schema":
      if (missingTest?.path) {
        directives.push(`Run: npm run test:run -- ${missingTest.path}`);
      }
      directives.push("Verify: npx tsc --noEmit");
      break;
    case "migration":
      directives.push("Run: npm run db:migration:register");
      directives.push("Run: npm run db:migrate:local && npm run db:types:gen:local");
      directives.push("Verify: npx tsc --noEmit");
      break;
    case "i18n":
      directives.push("Run: npm run i18n:check");
      break;
    default:
      directives.push("Verify: npx tsc --noEmit");
  }

  return directives;
}

/**
 * Build the Dirigent Brief — a structured prompt for the default Copilot agent.
 *
 * Contains: errors, development state, workflow directives, KB rules, story context.
 * Sent WITHOUT @aisha prefix so the default agent can edit files directly.
 */
async function buildDirigentBrief(
  filePath: string,
  errors?: string[],
): Promise<string> {
  const role = detectFileRole(filePath);
  const state = await assessDevState(filePath);
  const story = await resolveStoryContext();
  const directives = getWorkflowDirectives(role, state, filePath);
  const kbRules = getKbRulesForRole(role);

  const parts: string[] = [];

  // Header
  if (errors?.length) {
    parts.push(`Fix the errors in ${filePath}:`);
  } else {
    parts.push(`Continue development in ${filePath}:`);
  }

  // Errors section — optionally recap via edge model
  if (errors?.length) {
    parts.push("");
    parts.push("[Errors]");

    // If edge-first is enabled and there are multiple errors, attempt an edge recap
    if (errors.length >= 3 && isEdgeFirstEnabled()) {
      const recapResult = await edgeChat(
        [
          { role: "system", content: "Summarize these errors into a concise pattern analysis. Group related errors. Be brief." },
          { role: "user", content: errors.join("\n") },
        ],
        { task: "recap", maxTokens: 512 },
      );
      if (recapResult) {
        parts.push("[Edge Recap]");
        parts.push(recapResult.content);
        parts.push("");
        parts.push("[Raw Errors]");
      }
    }

    for (const e of errors) {
      parts.push(e);
    }
  }

  // Development state
  parts.push("");
  parts.push("[Development State]");
  for (const item of state) {
    const icon = item.status === "ok" ? "✓" : item.status === "missing" ? "✗" : "⚠";
    const suffix = item.status === "missing" ? " — MISSING, create first" : item.status === "warning" ? " — needs attention" : "";
    parts.push(`${icon} ${item.label}${suffix}`);
  }

  // Workflow directives
  if (directives.length > 0) {
    // If we have errors, insert "Fix errors" as step after test-first but before verification
    const effectiveDirectives = [...directives];
    if (errors?.length) {
      const testFirstIdx = effectiveDirectives.findIndex(d => d.startsWith("Write test FIRST"));
      const insertIdx = testFirstIdx >= 0 ? testFirstIdx + 1 : 0;
      effectiveDirectives.splice(insertIdx, 0, `Fix the ${errors.length} error(s) listed above`);
    }
    parts.push("");
    parts.push("[Workflow Directives]");
    effectiveDirectives.forEach((d, i) => parts.push(`${i + 1}. ${d}`));
  }

  // KB rules
  if (kbRules.length > 0) {
    parts.push("");
    parts.push("[KB Rules]");
    for (const rule of kbRules) {
      parts.push(`- ${rule}`);
    }
  }

  // Story context
  if (story.storyId) {
    parts.push(`- Story: ${story.storyId}`);
  }

  const brief = parts.join("\n");
  log(`[dirigent] Brief built for ${filePath} (role=${role}, errors=${errors?.length ?? 0}, state=${state.length} items, directives=${directives.length})`);
  return brief;
}

/**
 * Send a Dirigent Brief to the default Copilot chat (without @aisha prefix).
 * Respects auto-approve session state.
 *
 * @returns true if brief was sent to chat
 */
async function sendBriefToChat(brief: string, filePath: string): Promise<boolean> {
  if (autoSendToChat) {
    log(`[dirigent] Auto-send active, opening chat for ${filePath}`);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
    return true;
  }

  if (!canNotify()) {
    log(`[dirigent] Cooldown active, deferring brief for ${filePath}`);
    return false;
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const action = await vscode.window.showInformationMessage(
    vscode.l10n.t("AISHA Dirigent: development guidance ready for {0}", fileName),
    vscode.l10n.t("Send to Chat"),
    vscode.l10n.t("Always send"),
    vscode.l10n.t("Dismiss"),
  );

  if (action === vscode.l10n.t("Always send")) {
    autoSendToChat = true;
    log(`[dirigent] Auto-send enabled for this session`);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
    return true;
  }

  if (action === vscode.l10n.t("Send to Chat")) {
    log(`[dirigent] User approved, sending brief for ${filePath}`);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
    return true;
  }

  log(`[dirigent] User dismissed brief for ${filePath}`);
  return false;
}

function buildDiagnosticSignature(errors: vscode.Diagnostic[]): string {
  return errors.slice(0, MAX_DEBUG_DIAGNOSTICS).map(error => {
    const line = error.range.start.line + 1;
    return `L${line}:${error.message}`;
  }).join(" | ");
}

/**
 * Check if any error messages match known transient TS patterns.
 */
function hasTransientPatterns(errors: vscode.Diagnostic[]): boolean {
  return errors.some(e =>
    TRANSIENT_ERROR_PATTERNS.some(p => p.test(e.message)),
  );
}

/**
 * Check if the file path is known to produce transient diagnostics.
 */
function isTransientFile(filePath: string): boolean {
  return TRANSIENT_FILE_PATTERNS.some(p => p.test(filePath));
}

function clearTransientRecheckTimer(uriKey: string): void {
  const timer = transientRecheckTimers.get(uriKey);
  if (!timer) return;
  clearTimeout(timer);
  transientRecheckTimers.delete(uriKey);
}

async function reviewStableDiagnostics(uri: vscode.Uri, isRecheck = false): Promise<void> {
  if (uri.scheme !== "file") {
    log(`[diag] Skipping non-file URI: ${uri.scheme}:${uri.path}`);
    return;
  }

  const filePath = vscode.workspace.asRelativePath(uri, false);
  if (/node_modules|dist|\.next|coverage/.test(filePath)) {
    log(`[diag] Skipping excluded path: ${filePath}`);
    return;
  }

  // Skip files that are known regeneration targets (types.ts, .d.ts)
  if (isTransientFile(filePath)) {
    log(`[diag] Skipping transient-file pattern: ${filePath}`);
    return;
  }

  const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
  if (openDocument?.isDirty) {
    log(`[diag] Skipping dirty (unsaved) file: ${filePath}`);
    return;
  }

  const diagnostics = vscode.languages.getDiagnostics(uri);
  const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

  if (errors.length === 0) {
    if (lastDiagnosticPromptSignatures.has(filePath)) {
      log(`[diag] Errors cleared for ${filePath} — removing cached signature`);
    }
    lastDiagnosticPromptSignatures.delete(filePath);
    return;
  }

  // If errors match known transient patterns and this is not a recheck — schedule recheck
  if (!isRecheck && hasTransientPatterns(errors)) {
    log(`[diag] Transient pattern detected in ${filePath} (${errors.length} error(s)), scheduling recheck in ${TRANSIENT_PATTERN_DEBOUNCE_MS}ms`);
    const uriKey = uri.toString();
    clearTransientRecheckTimer(uriKey);
    transientRecheckTimers.set(uriKey, setTimeout(() => {
      transientRecheckTimers.delete(uriKey);
      log(`[diag] Recheck firing for ${filePath}`);
      void reviewStableDiagnostics(uri, true);
    }, TRANSIENT_PATTERN_DEBOUNCE_MS));
    return;
  }

  const signature = buildDiagnosticSignature(errors);
  if (lastDiagnosticPromptSignatures.get(filePath) === signature) {
    log(`[diag] Duplicate signature, skipping: ${filePath}`);
    return;
  }

  if (!canNotify()) {
    log(`[diag] Cooldown active, deferring notification for ${filePath}`);
    return;
  }

  lastDiagnosticPromptSignatures.set(filePath, signature);
  log(`[diag] ✓ ${errors.length} stable error(s) confirmed in ${filePath}${isRecheck ? " (after recheck)" : ""}`);
  log(`[diag]   Signature: ${signature.substring(0, 200)}`);

  const errorLines = errors.slice(0, MAX_DEBUG_DIAGNOSTICS).map(error =>
    `L${error.range.start.line + 1}: ${error.message.substring(0, 160)}`,
  );

  // Build and send a Dirigent Brief (to regular chat, not @aisha)
  const brief = await buildDirigentBrief(filePath, errorLines);
  await sendBriefToChat(brief, filePath);
}

// ──────────────────────────────────────────
// Event handlers
// ──────────────────────────────────────────

/**
 * Handle file save — detect what changed and offer proactive dirigent guidance.
 *
 * Routes all guidance through the Dirigent Brief system → regular chat.
 * The default Copilot agent can then act on the directives directly.
 */
async function onFileSaved(document: vscode.TextDocument): Promise<void> {
  const filePath = vscode.workspace.asRelativePath(document.uri, false);
  log(`File saved: ${filePath}`);

  // Skip non-project files
  if (document.uri.scheme !== "file") return;

  const role = detectFileRole(filePath);

  // ── Config Writer: track developer direction + schedule rules refresh ──
  const directionChanged = recordFileSave(filePath, role);
  if (directionChanged) {
    scheduleConfigRefresh("direction-change");
  } else {
    scheduleConfigRefresh("save");
  }

  // ── Migration file saved → dirigent brief with migration workflow ──
  if (role === "migration") {
    const brief = await buildDirigentBrief(filePath);
    await sendBriefToChat(brief, filePath);
    return;
  }

  // ── Hook file saved → check for missing test, build dirigent brief ──
  if (role === "hook") {
    const test = await checkTestExists(filePath);
    if (!test.exists) {
      const brief = await buildDirigentBrief(filePath);
      await sendBriefToChat(brief, filePath);
    }
    return;
  }

  // ── Component file saved → same pattern ──
  if (role === "component") {
    const test = await checkTestExists(filePath);
    if (!test.exists) {
      const brief = await buildDirigentBrief(filePath);
      await sendBriefToChat(brief, filePath);
    }
    return;
  }

  // ── i18n segment saved → brief with i18n directives ──
  if (role === "i18n") {
    const brief = await buildDirigentBrief(filePath);
    await sendBriefToChat(brief, filePath);
    return;
  }

  // ── Zod schema saved → brief with parseRpcArraySafe warning ──
  if (role === "schema") {
    const brief = await buildDirigentBrief(filePath);
    await sendBriefToChat(brief, filePath);
    return;
  }

  // ── Compliance-sensitive file → background check + brief if issues ──
  if (COMPLIANCE_PATTERNS.some(p => p.test(filePath))) {
    const n8nUrl = getDirigentConfig().n8nTriggerUrl;

    if (n8nUrl) {
      log(`Running background compliance check for ${filePath}`);
      try {
        const story = await resolveStoryContext();
        const result = await callN8nAgent("compliance-agent", {
          file_path: filePath,
          story_id: story.storyId,
          action: "quick_check",
        });
        if (result?.success && result.response) {
          if (/violation|error|warning|issue/i.test(result.response)) {
            // Compliance issues found — build brief with compliance context
            const brief = await buildDirigentBrief(filePath, [`Compliance: ${result.response.substring(0, 300)}`]);
            await sendBriefToChat(brief, filePath);
          } else {
            log(`Compliance check passed for ${filePath}`);
          }
        }
      } catch (err) {
        log(`Background compliance check failed: ${err}`);
      }
    }
  }
}

/**
 * Handle diagnostic changes — collect URIs into a batch, process after window.
 *
 * Instead of per-URI debounce timers (which caused excessive rg spawns via
 * reviewStableDiagnostics → checkTestExists → findFiles), we collect all URIs
 * into a Set and process up to DIAGNOSTIC_BATCH_MAX_URIS after the batch
 * window closes. Open editors are prioritized.
 */
function onDiagnosticsChanged(event: vscode.DiagnosticChangeEvent): void {
  for (const uri of event.uris) {
    pendingDiagnosticUris.add(uri.toString());
  }

  // Reset batch timer — wait for more URIs
  if (diagnosticBatchTimer) clearTimeout(diagnosticBatchTimer);
  diagnosticBatchTimer = setTimeout(() => {
    diagnosticBatchTimer = undefined;
    void processDiagnosticBatch();
  }, DIAGNOSTIC_BATCH_WINDOW_MS);
}

/**
 * Process the collected diagnostic batch.
 *
 * Prioritizes open editor URIs, processes up to DIAGNOSTIC_BATCH_MAX_URIS,
 * discards the rest to avoid rg/findFiles flooding.
 */
async function processDiagnosticBatch(): Promise<void> {
  const batch = Array.from(pendingDiagnosticUris);
  pendingDiagnosticUris.clear();

  if (batch.length === 0) return;

  // Activity gate: skip batch if user has been idle > 60s
  if (Date.now() - lastUserActivityAt > USER_ACTIVITY_TIMEOUT_MS) {
    log(`[diag:batch] Skipping — user idle for ${Math.round((Date.now() - lastUserActivityAt) / 1000)}s`);
    return;
  }

  log(`[diag:batch] Processing batch of ${batch.length} URI(s), max ${DIAGNOSTIC_BATCH_MAX_URIS}`);

  // Prioritize: open editor URIs first
  const openUris = new Set(
    vscode.window.visibleTextEditors.map(e => e.document.uri.toString()),
  );
  const sorted = batch.sort((a, b) => {
    const aOpen = openUris.has(a) ? 0 : 1;
    const bOpen = openUris.has(b) ? 0 : 1;
    return aOpen - bOpen;
  });

  const toProcess = sorted.slice(0, DIAGNOSTIC_BATCH_MAX_URIS);
  const skipped = sorted.length - toProcess.length;
  if (skipped > 0) {
    log(`[diag:batch] Skipping ${skipped} lower-priority URI(s)`);
  }

  for (const uriStr of toProcess) {
    const uri = vscode.Uri.parse(uriStr);
    log(`[diag:batch] Reviewing ${vscode.workspace.asRelativePath(uri, false)}`);
    await reviewStableDiagnostics(uri);
  }
}

/**
 * Handle branch switch — sync copilot instructions and story context.
 * Uses lightweight getGitBranch() instead of full getWorkspaceContext()
 * to avoid triggering findFiles/rg on every 30s poll.
 */
let lastBranch: string | null = null;

/** Get the last known branch (shared with context sync to avoid duplicate git calls). */
export function getLastKnownBranch(): string | null {
  return lastBranch;
}

async function checkBranchChange(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;

  const branch = getGitBranch(root);
  if (!branch || branch === lastBranch) return;

  const prevBranch = lastBranch;
  lastBranch = branch;

  if (!prevBranch) return; // First check, no change

  log(`Branch changed: ${prevBranch} → ${branch}`);

  // Extract story ID from branch name (e.g., feature/story-UUID, EV-123)
  const storyMatch = branch.match(
    /(?:story[/-]|EV-)([0-9a-f-]{8,36}|\d+)/i,
  );

  if (storyMatch) {
    const storyId = storyMatch[1];
    if (!canNotify()) return;
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t("AISHA: Detected story context from branch. Set story {0}?", storyId.slice(0, 8) + "\u2026"),
      vscode.l10n.t("Set Story"),
      vscode.l10n.t("Dismiss"),
    );
    if (action === vscode.l10n.t("Set Story")) {
      await vscode.commands.executeCommand("aisha.dirigent.setStory");
    }
  }
}

// ──────────────────────────────────────────
// Auto-sync: copilot-instructions.md
// ──────────────────────────────────────────

/**
 * Check if copilot-instructions.md needs updating.
 * Called once on activation and by event-driven triggers (story.json watcher, rules_updated SSE).
 */
async function autoSyncInstructions(): Promise<void> {
  if (!shouldAutoRegenerate("auto-flow")) {
    log("Auto-sync suppressed (aisha.dirigent.autoRegenerate disabled)");
    return;
  }

  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return;

  const story = await resolveStoryContext();
  if (!story.storyId) return;

  const fileUri = vscode.Uri.joinPath(root.uri, ".github", "copilot-instructions.md");

  try {
    const existing = await vscode.workspace.fs.readFile(fileUri);
    const content = new TextDecoder().decode(existing);
    // If file already mentions the story, skip
    if (content.includes(story.storyId)) return;
  } catch {
    // File doesn't exist — should generate
  }

  log("Auto-syncing copilot-instructions.md (story context changed)");
  await vscode.commands.executeCommand("aisha.dirigent.syncInstructions");
}

// ──────────────────────────────────────────
// Registration
// ──────────────────────────────────────────

/**
 * Register all auto-flow event listeners.
 *
 * Called from `extension.ts activate()`.
 * Returns disposables for cleanup.
 */
export function registerAutoFlow(
  context: vscode.ExtensionContext,
): void {
  // ── File save listener (debounced) ──
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      lastUserActivityAt = Date.now();
      const rel = vscode.workspace.asRelativePath(doc.uri, false);

      // Invalidate barrel cache when index.ts is saved
      if (rel === "src/hooks/index.ts") {
        barrelContentCache = null;
      }
      // Invalidate test-exists cache when a test file is saved (new test created)
      if (/\.test\.(tsx?|jsx?)$/.test(rel)) {
        testExistsCache.clear();
      }
      // Invalidate tech stack cache when package.json changes
      if (rel === "package.json") {
        invalidateTechStackCache();
      }

      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        void onFileSaved(doc);
      }, SAVE_DEBOUNCE_MS);
    }),
  );

  // ── Diagnostics listener ──
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      void onDiagnosticsChanged(event);
    }),
  );

  // ── User activity tracker (for diagnostics idle gate) ──
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      lastUserActivityAt = Date.now();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      lastUserActivityAt = Date.now();
    }),
  );

  // ── Branch change detection (FileSystemWatcher + 5min fallback) ──
  const gitHeadWatcher = vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  const gitRefsWatcher = vscode.workspace.createFileSystemWatcher("**/.git/refs/heads/*");
  const onGitHeadChange = () => { void checkBranchChange(); };
  gitHeadWatcher.onDidChange(onGitHeadChange);
  gitHeadWatcher.onDidCreate(onGitHeadChange);
  gitRefsWatcher.onDidChange(onGitHeadChange);
  gitRefsWatcher.onDidCreate(onGitHeadChange);
  context.subscriptions.push(gitHeadWatcher, gitRefsWatcher);

  // Fallback polling every 5 min (catches cases where FileSystemWatcher misses)
  const branchInterval = setInterval(() => {
    void checkBranchChange();
  }, 300_000);
  context.subscriptions.push({
    dispose: () => clearInterval(branchInterval),
  });

  // ── One-shot instructions sync on startup (event-driven, no polling) ──
  void autoSyncInstructions();

  // ── Output channel ──
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Auto-Flow");
  }
  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => {
      if (diagnosticBatchTimer) clearTimeout(diagnosticBatchTimer);
      for (const uriKey of transientRecheckTimers.keys()) {
        clearTransientRecheckTimer(uriKey);
      }
    },
  });

  // ── Initial branch check ──
  void checkBranchChange();

  log("AISHA Auto-Flow registered — autonomous monitoring active");
  log(`[diag] Batch window: ${DIAGNOSTIC_BATCH_WINDOW_MS}ms, max URIs/batch: ${DIAGNOSTIC_BATCH_MAX_URIS}, transient recheck: ${TRANSIENT_PATTERN_DEBOUNCE_MS}ms, cooldown: ${NOTIFICATION_COOLDOWN_MS}ms`);
  log(`[diag] Transient error patterns: ${TRANSIENT_ERROR_PATTERNS.length}, transient file patterns: ${TRANSIENT_FILE_PATTERNS.length}`);
}
