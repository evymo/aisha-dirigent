/**
 * Config Writer — Dynamic agent configuration management.
 *
 * Observes developer activity (file saves, terminal results, diagnostics)
 * and dynamically updates local configuration files that AI agents read:
 *
 * - `.aisha/active-rules.json` — contextual rules subset based on current work
 * - `.aisha/prompt-template.md` — situational prompt template for the active task
 * - `.github/copilot-instructions.md` — full ruleset instructions (existing, enhanced)
 *
 * The writer fetches fresh rules from the MCP Knowledge Base via compose_context()
 * and search_knowledge(), replacing the hardcoded getKbRulesForRole() in auto-flow.
 *
 * @module
 */

import * as vscode from "vscode";
import { callMcpTool, extractMarkdown } from "./mcp-client";
import { resolveStoryContext } from "./story-context";
import { getBaselineRules } from "./generators/universal-baseline";
import { safeWriteFromUri, safeWriteJson } from "./generators/file-safety";
import { getAutoGenMarker } from "./generators/registry";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** File role — mirrors auto-flow.ts FileRole */
type FileRole =
  | "hook"
  | "component"
  | "schema"
  | "migration"
  | "test"
  | "i18n"
  | "page"
  | "sql_function"
  | "edge_function"
  | "other";

/** Development direction inferred from recent activity. */
interface DevelopmentDirection {
  /** Primary file roles observed in recent saves. */
  activeRoles: FileRole[];
  /** Files currently being worked on. */
  activeFiles: string[];
  /** Inferred work domain. */
  domain: "frontend" | "backend" | "database" | "testing" | "i18n" | "devops" | "general";
  /** Timestamp of last activity. */
  lastActivityAt: string;
}

/** Active rules written to .aisha/active-rules.json. */
interface ActiveRulesConfig {
  /** Schema version for consumers. */
  version: "1.0";
  /** When these rules were last updated. */
  updatedAt: string;
  /** Story ID these rules are scoped to (null = global). */
  storyId: string | null;
  /** Inferred development direction. */
  direction: DevelopmentDirection;
  /** Contextual rules fetched from KB (keyed by category). */
  rules: Record<string, string[]>;
  /** Template slug if a prompt template was written. */
  activeTemplate: string | null;
  /** Source of the rules. */
  source: "mcp" | "fallback";
}

/** Config update event — fired when a config file is written. */
export interface ConfigUpdateEvent {
  /** Which config file was updated. */
  file: "active-rules" | "prompt-template" | "copilot-instructions";
  /** Absolute path to the written file. */
  path: string;
  /** What triggered the update. */
  trigger: "save" | "terminal" | "direction-change" | "story-change" | "manual";
}

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────

/** Debounce window for config writes (ms). Prevents thrashing on rapid saves. */
const CONFIG_WRITE_DEBOUNCE_MS = 10_000;

/** Minimum interval between MCP calls for rules refresh (ms). */
const MCP_REFRESH_COOLDOWN_MS = 60_000;

/** Maximum recent files tracked for direction inference. */
const MAX_TRACKED_FILES = 10;

/** Maximum recent roles tracked. */
const MAX_TRACKED_ROLES = 5;

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────

/** Recent file save history (newest first). */
const recentSaves: Array<{ file: string; role: FileRole; at: number }> = [];

/** Current development direction. */
let currentDirection: DevelopmentDirection = {
  activeRoles: [],
  activeFiles: [],
  domain: "general",
  lastActivityAt: new Date().toISOString(),
};

/** Last MCP refresh timestamp. */
let lastMcpRefreshAt = 0;

/** Last written rules fingerprint (avoid redundant writes). */
let lastRulesFingerprint = "";

/** Debounce timer for config writes. */
let writeDebounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Output channel for logging. */
let outputChannel: vscode.OutputChannel | undefined;

/** Event emitter for config update notifications. */
const configUpdateEmitter = new vscode.EventEmitter<ConfigUpdateEvent>();

/** Event fired when a config file is updated. */
export const onConfigUpdate = configUpdateEmitter.event;

function log(msg: string): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Config Writer");
  }
  outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

// ──────────────────────────────────────────
// Direction Inference
// ──────────────────────────────────────────

/**
 * Infer development domain from observed file roles.
 */
function inferDomain(roles: FileRole[]): DevelopmentDirection["domain"] {
  if (roles.length === 0) return "general";

  const counts: Partial<Record<FileRole, number>> = {};
  for (const r of roles) {
    counts[r] = (counts[r] ?? 0) + 1;
  }

  // Domain inference rules — order matters
  if (counts.migration || counts.sql_function) return "database";
  if (counts.test) return "testing";
  if (counts.i18n) return "i18n";
  if (counts.edge_function) return "devops";
  if (counts.hook || counts.schema) return "backend";
  if (counts.component || counts.page) return "frontend";
  return "general";
}

/**
 * Record a file save and update development direction.
 *
 * @returns true if the direction changed (new domain or new primary role).
 */
export function recordFileSave(filePath: string, role: FileRole): boolean {
  const now = Date.now();

  // Add to recent saves
  recentSaves.unshift({ file: filePath, role, at: now });
  if (recentSaves.length > MAX_TRACKED_FILES) recentSaves.length = MAX_TRACKED_FILES;

  // Build new direction
  const activeRoles = [...new Set(recentSaves.slice(0, MAX_TRACKED_ROLES).map(s => s.role))];
  const activeFiles = [...new Set(recentSaves.map(s => s.file))];
  const newDomain = inferDomain(activeRoles);

  const directionChanged = newDomain !== currentDirection.domain;

  currentDirection = {
    activeRoles,
    activeFiles,
    domain: newDomain,
    lastActivityAt: new Date(now).toISOString(),
  };

  if (directionChanged) {
    log(`Direction changed → ${newDomain} (roles: ${activeRoles.join(", ")})`);
  }

  return directionChanged;
}

/**
 * Get the current development direction.
 */
export function getDirection(): DevelopmentDirection {
  return { ...currentDirection };
}

// ──────────────────────────────────────────
// MCP Knowledge Fetch
// ──────────────────────────────────────────

/**
 * Fetch contextual rules from MCP backend based on current direction.
 *
 * Uses compose_context() when story is available, falls back to
 * search_knowledge() for keyword-based retrieval.
 *
 * @returns Rules keyed by category, or null if MCP unavailable.
 */
async function fetchContextualRules(
  direction: DevelopmentDirection,
  storyId: string | null,
): Promise<{ rules: Record<string, string[]>; source: "mcp" | "fallback" } | null> {
  const now = Date.now();
  if (now - lastMcpRefreshAt < MCP_REFRESH_COOLDOWN_MS) {
    log("[mcp] Cooldown active, skipping refresh");
    return null;
  }

  // Build a query describing the current development context
  const domainQueries: Record<DevelopmentDirection["domain"], string> = {
    frontend: "React component patterns, i18n, UI rules, error boundaries",
    backend: "RPC-only pattern, Zod validation, hook design, API patterns",
    database: "migration workflow, SECURITY DEFINER, RLS policies, audit journal",
    testing: "test patterns, mock RPC, vitest, gate tests",
    i18n: "i18n workflow, translation segments, missing keys",
    devops: "edge functions, deployment, Docker, Coolify",
    general: "coding standards, TypeScript strict, code hygiene",
  };

  const query = domainQueries[direction.domain];

  try {
    // Strategy 1: compose_context with story (full context + rules)
    if (storyId) {
      const result = await callMcpTool("compose_context", {
        story_id: storyId,
        context_profile_slug: "rules_only",
        query,
      });

      if (result) {
        const md = extractMarkdown(result);
        if (md) {
          lastMcpRefreshAt = now;
          return { rules: parseRulesFromMarkdown(md), source: "mcp" };
        }
      }
    }

    // Strategy 2: search_knowledge (no story context)
    const result = await callMcpTool("search_knowledge", {
      query,
      context_tags: direction.activeRoles,
      limit: 10,
    });

    if (result) {
      const md = extractMarkdown(result);
      if (md) {
        lastMcpRefreshAt = now;
        return { rules: parseRulesFromMarkdown(md), source: "mcp" };
      }
    }
  } catch (err) {
    log(`[mcp] Rules fetch failed: ${err}`);
  }

  // Fallback: use hardcoded rules (same as current getKbRulesForRole)
  log("[mcp] Using fallback rules");
  lastMcpRefreshAt = now;
  return { rules: getFallbackRules(direction), source: "fallback" };
}

/**
 * Parse rules from MCP markdown response into categorized structure.
 */
function parseRulesFromMarkdown(md: string): Record<string, string[]> {
  const rules: Record<string, string[]> = {};
  let currentCategory = "general";

  for (const line of md.split("\n")) {
    const categoryMatch = line.match(/^#{2,4}\s+(.+)/);
    if (categoryMatch) {
      currentCategory = (categoryMatch[1] ?? "general").trim().toLowerCase().replace(/\s+/g, "_");
      if (!rules[currentCategory]) rules[currentCategory] = [];
      continue;
    }

    const ruleMatch = line.match(/^[-*]\s+(.+)/);
    if (ruleMatch) {
      const rule = (ruleMatch[1] ?? "").trim();
      if (rule) {
        if (!rules[currentCategory]) rules[currentCategory] = [];
        rules[currentCategory]!.push(rule);
      }
    }
  }

  return rules;
}

/**
 * Fallback rules when MCP is unavailable — uses universal baseline (not project-specific).
 */
function getFallbackRules(_direction: DevelopmentDirection): Record<string, string[]> {
  return getBaselineRules();
}

// ──────────────────────────────────────────
// File Writers
// ──────────────────────────────────────────

/**
 * Get the workspace root URI.
 */
function getWorkspaceRoot(): vscode.Uri | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

/**
 * Write `.aisha/active-rules.json` — machine-readable contextual rules.
 *
 * This file is consumed by:
 * - Copilot agents (via copilot-instructions.md reference)
 * - AISHA auto-flow (replaces hardcoded getKbRulesForRole)
 * - External tools / n8n workflows
 */
async function writeActiveRules(config: ActiveRulesConfig): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;

  // Fingerprint check — avoid redundant writes
  const fingerprint = JSON.stringify({
    domain: config.direction.domain,
    roles: config.direction.activeRoles,
    ruleCount: Object.values(config.rules).flat().length,
    source: config.source,
  });
  if (fingerprint === lastRulesFingerprint) {
    log("[write] active-rules unchanged, skipping");
    return null;
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  const outcome = await safeWriteJson(root, ".aisha/active-rules.json", content);
  if (outcome.outcome === "backup-failed") {
    log("[write] active-rules backup failed; aborting write");
    return null;
  }

  lastRulesFingerprint = fingerprint;
  log(
    `[write] active-rules.json updated (domain: ${config.direction.domain}, rules: ${Object.values(config.rules).flat().length}, source: ${config.source})${outcome.backupPath ? ` [backup: ${outcome.backupPath}]` : ""}`,
  );

  return vscode.Uri.joinPath(root, ".aisha", "active-rules.json").fsPath;
}

/**
 * Write `.aisha/prompt-template.md` — situational prompt template.
 *
 * Contains a brief focused on the current development direction,
 * including relevant rules, common patterns, and fix templates.
 */
async function writePromptTemplate(
  direction: DevelopmentDirection,
  rules: Record<string, string[]>,
  storyId: string | null,
): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;

  const parts: string[] = [];

  // Header — must include AUTO_GEN_MARKER for safeWrite refuse-user-owned guard
  parts.push("# AISHA — Kontextová šablona");
  parts.push("");
  parts.push(`> ${getAutoGenMarker()}`);
  parts.push(`> Auto-generováno na základě aktuální vývojové aktivity.`);
  parts.push(`> Aktualizováno: ${new Date().toISOString()}`);
  parts.push("");

  // Direction context
  parts.push("## Směr vývoje");
  parts.push("");
  parts.push(`- **Doména:** ${direction.domain}`);
  parts.push(`- **Aktivní role:** ${direction.activeRoles.join(", ") || "general"}`);
  if (storyId) {
    parts.push(`- **Story:** ${storyId}`);
  }
  parts.push("");

  // Active files
  if (direction.activeFiles.length > 0) {
    parts.push("## Rozpracované soubory");
    parts.push("");
    for (const f of direction.activeFiles.slice(0, 5)) {
      parts.push(`- ${f}`);
    }
    parts.push("");
  }

  // Rules by category
  const categoryLabels: Record<string, string> = {
    api_design: "API Design",
    coding_standard: "Coding Standard",
    data_modeling: "Data Modeling",
    database: "Database",
    i18n: "i18n",
    testing: "Testing",
    general: "Obecná pravidla",
  };

  for (const [category, categoryRules] of Object.entries(rules)) {
    if (categoryRules.length === 0) continue;
    parts.push(`## ${categoryLabels[category] ?? category}`);
    parts.push("");
    for (const rule of categoryRules) {
      parts.push(`- ${rule}`);
    }
    parts.push("");
  }

  // Domain-specific templates
  const template = getDomainTemplate(direction.domain);
  if (template) {
    parts.push("## Doporučená šablona");
    parts.push("");
    parts.push(template);
    parts.push("");
  }

  const content = parts.join("\n");
  const outcome = await safeWriteFromUri(root, ".aisha/prompt-template.md", content);

  switch (outcome.outcome) {
    case "refused-user-owned":
      log("[write] prompt-template.md refused — file is user-owned (no AISHA marker). Skipping.");
      return null;
    case "backup-failed":
      log("[write] prompt-template.md backup failed; aborting write");
      return null;
    case "skipped-identical":
      log(`[write] prompt-template.md unchanged (domain: ${direction.domain})`);
      return vscode.Uri.joinPath(root, ".aisha", "prompt-template.md").fsPath;
    case "written":
    default:
      log(
        `[write] prompt-template.md updated (domain: ${direction.domain})${outcome.preservedUserSection ? " [user-section preserved]" : ""}`,
      );
      return vscode.Uri.joinPath(root, ".aisha", "prompt-template.md").fsPath;
  }
}

/**
 * Get a domain-specific code template / recommendation.
 *
 * Returns null — domain-specific templates are now provided by the backend (Tier 1)
 * or generated by local LLM (Tier 2). No hardcoded project-specific templates.
 */
function getDomainTemplate(_domain: DevelopmentDirection["domain"]): string | null {
  return null;
}

// ──────────────────────────────────────────
// Orchestration
// ──────────────────────────────────────────

/**
 * Trigger a config refresh — debounced.
 *
 * Called by auto-flow when a file is saved or direction changes.
 * Uses a debounce window to batch rapid saves.
 *
 * @param trigger - What caused the refresh.
 */
export function scheduleConfigRefresh(trigger: ConfigUpdateEvent["trigger"]): void {
  if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
  writeDebounceTimer = setTimeout(() => {
    writeDebounceTimer = undefined;
    void refreshConfigs(trigger);
  }, CONFIG_WRITE_DEBOUNCE_MS);
}

/**
 * Force an immediate config refresh (no debounce).
 *
 * Used after story change or manual trigger.
 */
export async function forceConfigRefresh(trigger: ConfigUpdateEvent["trigger"]): Promise<void> {
  if (writeDebounceTimer) {
    clearTimeout(writeDebounceTimer);
    writeDebounceTimer = undefined;
  }
  await refreshConfigs(trigger);
}

/**
 * Core refresh logic — fetch rules, write configs, notify.
 */
async function refreshConfigs(trigger: ConfigUpdateEvent["trigger"]): Promise<void> {
  const direction = getDirection();
  const story = await resolveStoryContext();

  log(`[refresh] trigger=${trigger}, domain=${direction.domain}, story=${story.storyId ?? "none"}`);

  // Fetch contextual rules from MCP (or fallback)
  const result = await fetchContextualRules(direction, story.storyId ?? null);
  if (!result) return; // Cooldown or error

  // 1. Write active-rules.json
  const rulesConfig: ActiveRulesConfig = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    storyId: story.storyId ?? null,
    direction,
    rules: result.rules,
    activeTemplate: direction.domain !== "general" ? direction.domain : null,
    source: result.source,
  };

  const rulesPath = await writeActiveRules(rulesConfig);
  if (rulesPath) {
    configUpdateEmitter.fire({ file: "active-rules", path: rulesPath, trigger });
  }

  // 2. Write prompt-template.md (only when direction is specific)
  if (direction.domain !== "general") {
    const templatePath = await writePromptTemplate(direction, result.rules, story.storyId ?? null);
    if (templatePath) {
      configUpdateEmitter.fire({ file: "prompt-template", path: templatePath, trigger });
    }
  }

  // 3. Notify developer (non-blocking)
  if (rulesPath && trigger !== "save") {
    void notifyConfigUpdate(direction, trigger);
  }
}

/**
 * Notify the developer about a config update.
 */
async function notifyConfigUpdate(
  direction: DevelopmentDirection,
  trigger: ConfigUpdateEvent["trigger"],
): Promise<void> {
  const domainLabels: Record<DevelopmentDirection["domain"], string> = {
    frontend: "Frontend UI",
    backend: "Backend hooks/API",
    database: "Database/migrace",
    testing: "Testování",
    i18n: "Internacionalizace",
    devops: "DevOps/deploy",
    general: "Obecné",
  };

  const label = domainLabels[direction.domain];
  const action = await vscode.window.showInformationMessage(
    vscode.l10n.t("AISHA: Pravidla aktualizována pro kontext \"{0}\".", label),
    vscode.l10n.t("Show Template"),
    vscode.l10n.t("Dismiss"),
  );

  if (action === vscode.l10n.t("Show Template")) {
    const root = getWorkspaceRoot();
    if (root) {
      const templateUri = vscode.Uri.joinPath(root, ".aisha", "prompt-template.md");
      try {
        const doc = await vscode.workspace.openTextDocument(templateUri);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        log("[notify] prompt-template.md not found");
      }
    }
  }
}

// ──────────────────────────────────────────
// Public API — for auto-flow integration
// ──────────────────────────────────────────

/**
 * Get contextual rules for a file role — replaces hardcoded getKbRulesForRole.
 *
 * Reads from .aisha/active-rules.json if available, falls back to in-memory.
 *
 * @param role - File role to get rules for.
 * @returns Array of rule strings.
 */
export function getActiveRulesForRole(role: FileRole): string[] {
  // Use in-memory direction rules if available
  const fallback = getFallbackRules({ ...currentDirection, activeRoles: [role] });
  return Object.values(fallback).flat();
}

/**
 * Read the active-rules.json file from disk.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function readActiveRulesConfig(): Promise<ActiveRulesConfig | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;

  try {
    const fileUri = vscode.Uri.joinPath(root, ".aisha", "active-rules.json");
    const raw = await vscode.workspace.fs.readFile(fileUri);
    return JSON.parse(new TextDecoder().decode(raw)) as ActiveRulesConfig;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Registration
// ──────────────────────────────────────────

/**
 * Register the config writer.
 *
 * Called from `extension.ts activate()`.
 * Listens for story.json changes and triggers initial refresh.
 */
export function registerConfigWriter(context: vscode.ExtensionContext): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Config Writer");
  }
  context.subscriptions.push(outputChannel);

  // Watch .aisha/story.json for changes → trigger config refresh
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root) {
    const storyWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, ".aisha/story.json"),
    );
    storyWatcher.onDidChange(() => {
      log("[watch] story.json changed — triggering config refresh");
      void forceConfigRefresh("story-change");
    });
    storyWatcher.onDidCreate(() => {
      log("[watch] story.json created — triggering config refresh");
      void forceConfigRefresh("story-change");
    });
    context.subscriptions.push(storyWatcher);
  }

  // Cleanup
  context.subscriptions.push(
    configUpdateEmitter,
    new vscode.Disposable(() => {
      if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
    }),
  );

  // Initial refresh (deferred to avoid startup delay)
  setTimeout(() => {
    void forceConfigRefresh("manual");
  }, 5_000);

  log("AISHA Config Writer registered");
}
