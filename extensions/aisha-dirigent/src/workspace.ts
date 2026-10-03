/**
 * Workspace awareness — tech stack detection, git diff, active file analysis,
 * branch context, recent commits, diagnostics, and selection.
 *
 * Provides rich context about the current workspace and active editor to the
 * Dirigent participant for autonomous MCP / n8n orchestration.
 *
 * @module
 */

import * as vscode from "vscode";
import { execSync } from "child_process";
import { recordChildProcess } from "./resource-tracker";

/** Workspace context for MCP tool calls */
export interface WorkspaceContext {
  /** Detected technology tags */
  techStack: string[];
  /** Currently active file paths (relative to workspace root) */
  activeFilePaths: string[];
  /** Git diff summary (if available) */
  diffSummary: string | null;
  /** Workspace root path */
  rootPath: string | null;
  /** Current git branch name */
  gitBranch: string | null;
  /** Recent commit messages (last 5) */
  recentCommits: string[];
  /** Current selection text from active editor (if any, max 2000 chars) */
  activeSelection: string | null;
  /** Active file language ID (e.g. "typescript", "sql") */
  activeLanguage: string | null;
  /** VS Code diagnostic errors in active files */
  diagnosticSummary: string | null;
  /** Dirty (unsaved) file paths */
  dirtyFiles: string[];
}

/**
 * Detect tech stack from workspace files.
 * Results are cached for TECH_STACK_CACHE_TTL_MS to avoid repeated findFiles calls.
 */

const TECH_STACK_CACHE_TTL_MS = 120_000; // 2 min
let cachedTechStack: { tags: string[]; cachedAt: number } | null = null;

export async function detectTechStack(): Promise<string[]> {
  // Return cached result if valid
  if (cachedTechStack && Date.now() - cachedTechStack.cachedAt < TECH_STACK_CACHE_TTL_MS) {
    return cachedTechStack.tags;
  }

  const tags: Set<string> = new Set();
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return [];

  // Check for common config files
  const checks: Array<[string, string[]]> = [
    ["package.json", ["typescript", "javascript", "node"]],
    ["tsconfig.json", ["typescript"]],
    ["vite.config.ts", ["vite"]],
    ["tailwind.config.ts", ["tailwind"]],
    ["Dockerfile", ["docker"]],
    [".github/workflows/*.yml", ["github-actions"]],
  ];

  for (const [pattern, stackTags] of checks) {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, pattern),
      null,
      1,
    );
    if (files.length > 0) {
      for (const tag of stackTags) tags.add(tag);
    }
  }

  // Check package.json for specific dependencies
  try {
    const pkgFiles = await vscode.workspace.findFiles("package.json", null, 1);
    if (pkgFiles.length > 0) {
      const content = await vscode.workspace.fs.readFile(pkgFiles[0]);
      const pkg = JSON.parse(new TextDecoder().decode(content)) as Record<
        string,
        unknown
      >;
      const allDeps = {
        ...(pkg.dependencies as Record<string, string> | undefined),
        ...(pkg.devDependencies as Record<string, string> | undefined),
      };

      if (allDeps.react) tags.add("react");
      if (allDeps["@tanstack/react-query"]) tags.add("tanstack-query");
      if (allDeps.vitest) tags.add("vitest");
      if (allDeps.playwright || allDeps["@playwright/test"]) tags.add("playwright");
      if (allDeps.i18next) tags.add("i18next");
      if (allDeps.zod) tags.add("zod");
      if (allDeps["lucide-react"]) tags.add("lucide-react");
    }
  } catch {
    // Ignore parse errors
  }

  const result = Array.from(tags);
  cachedTechStack = { tags: result, cachedAt: Date.now() };
  return result;
}

/**
 * Get git diff summary for staged or unstaged changes.
 */
function getGitDiffSummary(rootPath: string): string | null {
  try {
    // Try staged first, then unstaged
    let diff = execSync("git diff --cached --stat", {
      cwd: rootPath,
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
    recordChildProcess();

    if (!diff) {
      diff = execSync("git diff --stat", {
        cwd: rootPath,
        timeout: 5000,
        encoding: "utf-8",
      }).trim();
      recordChildProcess();
    }

    return diff || null;
  } catch {
    return null;
  }
}

/**
 * Get active file paths relative to workspace root.
 */
function getActiveFilePaths(): string[] {
  const paths: string[] = [];
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;

  // Active editor
  const active = vscode.window.activeTextEditor;
  if (active && root) {
    const rel = vscode.workspace.asRelativePath(active.document.uri, false);
    paths.push(rel);
  }

  // Visible editors (tabs)
  for (const editor of vscode.window.visibleTextEditors) {
    if (root) {
      const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
      if (!paths.includes(rel)) {
        paths.push(rel);
      }
    }
  }

  return paths;
}

/**
 * Get current git branch name.
 * Exported for lightweight branch checks (avoids full getWorkspaceContext).
 */
export function getGitBranch(rootPath: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootPath,
      timeout: 3000,
      encoding: "utf-8",
    }).trim() || null;
    recordChildProcess();
    return branch;
  } catch {
    return null;
  }
}

/**
 * Get recent commit messages (last 5).
 */
function getRecentCommits(rootPath: string): string[] {
  try {
    const raw = execSync('git log --oneline -5 --no-decorate', {
      cwd: rootPath,
      timeout: 3000,
      encoding: "utf-8",
    }).trim();
    recordChildProcess();
    return raw ? raw.split("\n") : [];
  } catch {
    return [];
  }
}

/**
 * Get diagnostic errors summary for active files.
 */
function getDiagnosticSummary(): string | null {
  const active = vscode.window.activeTextEditor;
  if (!active) return null;

  const diagnostics = vscode.languages.getDiagnostics(active.document.uri);
  const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
  const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);

  if (errors.length === 0 && warnings.length === 0) return null;

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(`${errors.length} error(s): ${errors.slice(0, 3).map(e => `L${e.range.start.line + 1}: ${e.message}`).join("; ")}`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s)`);
  }

  const summary = parts.join(". ");
  if (active.document.isDirty) {
    return `Transient editor diagnostics (unsaved file): ${summary}`;
  }

  return `VS Code diagnostics: ${summary}`;
}

/**
 * Get current text selection from active editor.
 */
function getActiveSelection(): string | null {
  const active = vscode.window.activeTextEditor;
  if (!active || active.selection.isEmpty) return null;
  const text = active.document.getText(active.selection);
  return text.length > 2000 ? text.substring(0, 2000) + "…" : text;
}

/**
 * Get dirty (unsaved) file paths.
 */
function getDirtyFiles(): string[] {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];
  return vscode.workspace.textDocuments
    .filter(doc => doc.isDirty && !doc.isUntitled)
    .map(doc => vscode.workspace.asRelativePath(doc.uri, false));
}

/** Analysis payload for detect_project_context_from_analysis */
export interface ProjectAnalysis {
  tech_stack: string[];
  domain: string[];
  risk_profile: string | null;
  repo_url: string | null;
  repo_provider: string | null;
  default_branch: string | null;
}

/**
 * Invalidate the cached tech stack. Call when package.json changes.
 */
export function invalidateTechStackCache(): void {
  cachedTechStack = null;
}

/**
 * Returns true when the developer has opted in to sharing rich workspace
 * context (selection, commit messages, diff) with the MCP backend.
 *
 * Config: `aisha.dirigent.shareWorkspaceContext` (default false).
 *
 * File paths, branch name, language id, and tech-stack tags are always shared
 * because the MCP router needs them for routing; the redacted fields are the
 * ones that may contain source code or commit prose.
 */
function shareRichContext(): boolean {
  return vscode.workspace
    .getConfiguration("aisha.dirigent")
    .get<boolean>("shareWorkspaceContext", false);
}

/**
 * Gather full workspace context — rich contextual data for autonomous AISHA.
 *
 * Sensitive fields (activeSelection, recentCommits, diffSummary) are redacted
 * unless `aisha.dirigent.shareWorkspaceContext` is true. This prevents the
 * extension from accidentally exfiltrating secrets pasted into the editor or
 * leaked into commit messages.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const root = vscode.workspace.workspaceFolders?.[0];
  const rootPath = root?.uri.fsPath ?? null;
  const active = vscode.window.activeTextEditor;
  const rich = shareRichContext();

  const [techStack] = await Promise.all([detectTechStack()]);

  return {
    techStack,
    activeFilePaths: getActiveFilePaths(),
    diffSummary: rich && rootPath ? getGitDiffSummary(rootPath) : null,
    rootPath,
    gitBranch: rootPath ? getGitBranch(rootPath) : null,
    recentCommits: rich && rootPath ? getRecentCommits(rootPath) : [],
    activeSelection: rich ? getActiveSelection() : null,
    activeLanguage: active?.document.languageId ?? null,
    diagnosticSummary: getDiagnosticSummary(),
    dirtyFiles: getDirtyFiles(),
  };
}

/**
 * Build a project analysis payload for autonomous onboarding.
 *
 * Detects tech stack, domain hints, repo origin, and default branch.
 * Used by the `/onboard` command to call `detect_project_context_from_analysis`.
 */
export async function getProjectAnalysis(): Promise<ProjectAnalysis> {
  const techStack = await detectTechStack();
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

  // Detect repo URL and provider from git remote
  let repoUrl: string | null = null;
  let repoProvider: string | null = null;
  let defaultBranch: string | null = null;

  if (rootPath) {
    try {
      const remote = execSync("git remote get-url origin", {
        cwd: rootPath,
        timeout: 3000,
        encoding: "utf-8",
      }).trim();
      recordChildProcess();

      if (remote) {
        repoUrl = remote;
        if (remote.includes("github.com")) repoProvider = "github";
        else if (remote.includes("gitlab.com") || remote.includes("gitlab")) repoProvider = "gitlab";
        else if (remote.includes("forgejo") || remote.includes("gitea")) repoProvider = "forgejo";
        else repoProvider = "git";
      }
    } catch { /* no git remote */ }

    try {
      defaultBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: rootPath,
        timeout: 3000,
        encoding: "utf-8",
      }).trim() || null;
      recordChildProcess();
    } catch { /* no git */ }
  }

  // Domain detection heuristics from package.json keywords, directory names
  const domain: string[] = [];
  try {
    const pkgFiles = await vscode.workspace.findFiles("package.json", null, 1);
    if (pkgFiles.length > 0) {
      const content = await vscode.workspace.fs.readFile(pkgFiles[0]);
      const pkg = JSON.parse(new TextDecoder().decode(content)) as Record<string, unknown>;

      // Check keywords field
      const keywords = pkg.keywords as string[] | undefined;
      if (keywords?.length) {
        for (const kw of keywords) {
          if (!domain.includes(kw)) domain.push(kw);
        }
      }

      // Check description for domain hints
      const desc = (pkg.description as string)?.toLowerCase() ?? "";
      const domainHints: Array<[RegExp, string]> = [
        [/\bhealth|medical|clinic\b/, "healthcare"],
        [/\be-?commerce|shop|store|cart\b/, "ecommerce"],
        [/\bfinance|banking|payment\b/, "fintech"],
        [/\beduc|learn|course\b/, "education"],
        [/\bai|machine.?learn|llm|orchestrat\b/, "ai-orchestration"],
        [/\bknowledge|wiki|docs?\b/, "knowledge-management"],
        [/\bplatform|saas|multi.?tenant\b/, "platform-engineering"],
      ];
      for (const [pattern, label] of domainHints) {
        if (pattern.test(desc) && !domain.includes(label)) {
          domain.push(label);
        }
      }
    }
  } catch { /* ignore */ }

  return {
    tech_stack: techStack,
    domain,
    risk_profile: null,
    repo_url: repoUrl,
    repo_provider: repoProvider,
    default_branch: defaultBranch,
  };
}
