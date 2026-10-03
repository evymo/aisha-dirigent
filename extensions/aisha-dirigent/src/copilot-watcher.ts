/**
 * Copilot Watcher — real-time AISHA compliance monitoring.
 *
 * Watches `onDidChangeTextDocument` and scans newly inserted code
 * for platform rule violations — fires BEFORE save, catching both
 * Copilot completions and manual typing.
 *
 * Complements `auto-flow.ts` (which runs deeper checks on save).
 *
 * @module
 */

import * as vscode from "vscode";
import { callRpc } from "./backend-rpc";
import { evaluate as evaluateRule } from "./rules-engine";
import type { RuleMatch } from "./rules-engine";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Wait this long after the last change before scanning (catches Copilot bursts). */
const DEBOUNCE_MS = 1800;

/** Don't repeat the same rule notification more often than this. */
const COOLDOWN_MS = 45_000;

/** Only watch these language IDs. */
const TARGET_LANGS = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

// ── Rule definitions (deprecated — kept for cold-start fallback documentation) ───
// VIOLATION_RULES previously held a hardcoded TS array; rules now come from
// claude_hook_bindings via rulesEngine.evaluate(). The DB+JSON-mirror SoT
// (Fáze 3.rules-engine) replaced this with live + bundled fallback fetch.
//
// If you find yourself wanting to add a rule here, instead add a row to
// aisha/db/seed/claude_hook_bindings.{sql,json} so all surfaces (extension
// copilot-watcher, generated .claude/hooks/*, future agents) share one SoT.

// (rule definitions removed — now sourced from claude_hook_bindings table
// via rulesEngine.evaluate; see scanPending below)

// ── State ─────────────────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let outputChannel: vscode.OutputChannel | undefined;
const lastNotified = new Map<string, number>();

/** Accumulated change texts within the current debounce window. */
const pendingTexts: { text: string; file: string }[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Compliance Watch");
  }
  return outputChannel;
}

function canNotify(ruleKey: string): boolean {
  const last = lastNotified.get(ruleKey) ?? 0;
  return Date.now() - last > COOLDOWN_MS;
}

function markNotified(ruleKey: string): void {
  lastNotified.set(ruleKey, Date.now());
}

function shouldSkipFile(filePath: string): boolean {
  // Skip test files — violations are intentional in mocks
  return (
    filePath.includes("/src/tests/") ||
    filePath.includes(".test.ts") ||
    filePath.includes(".test.tsx") ||
    filePath.includes(".spec.ts") ||
    filePath.includes(".spec.tsx")
  );
}

// ── Core scan ─────────────────────────────────────────────────────────────────

async function scanPending(): Promise<void> {
  if (pendingTexts.length === 0) return;

  const snapshot = pendingTexts.splice(0);
  const ch = getChannel();
  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!rootUri) return;

  for (const { text, file } of snapshot) {
    if (!text.trim()) continue;
    if (shouldSkipFile(file)) continue;

    const shortPath = file.split("/src/").pop() ?? file.split("/").pop() ?? file;

    // Delegate matching to the in-extension Rules Engine (in turn cached
    // from mcp_get_claude_hook_bindings live RPC + bundled JSON fallback).
    // Hardcoded VIOLATION_RULES TS array is gone — DB is the single SoT.
    let matches: RuleMatch[];
    try {
      matches = await evaluateRule(
        {
          source: "editor",
          type: "edit-content",
          message: text,
          files: [shortPath],
          timestamp: new Date().toISOString(),
        },
        { rootUri },
      );
    } catch {
      // Engine failure must not break the watcher loop
      continue;
    }

    for (const match of matches) {
      if (!canNotify(match.rule_id)) continue;
      markNotified(match.rule_id);

      // Persist violation to backend for self-learning (fire-and-forget).
      // Severity → legacy {warning|info} mapping preserved so backend
      // self-learning histograms stay stable.
      const legacySeverity = match.severity === "high" ? "warning" : "info";
      void callRpc("fn_log_dev_signal", {
        p_payload: {
          file_path: shortPath,
          message: match.message,
          rule_key: match.rule_id,
        },
        p_severity: legacySeverity,
        p_signal_type: "compliance_violation",
      });

      ch.appendLine(`\n⚡ ${new Date().toLocaleTimeString()} — ${shortPath}`);
      ch.appendLine(`  [${match.rule_id.toUpperCase()}] ${match.message}`);
      ch.show(/* preserveFocus */ true);

      const hint = match.hint ?? `@aisha jak vyřešit ${match.rule_id}?`;
      if (match.severity === "high") {
        void vscode.window
          .showWarningMessage(
            `AISHA: ${match.message}`,
            "Poradit se (@aisha)",
            "Ignorovat",
          )
          .then((choice) => {
            if (choice === "Poradit se (@aisha)") {
              void vscode.commands.executeCommand(
                "workbench.action.chat.open",
                { query: hint },
              );
            }
          });
      } else {
        // Silent — only output channel + info toast
        void vscode.window
          .showInformationMessage(
            `AISHA: ${match.message}`,
            "Poradit se",
            "OK",
          )
          .then((choice) => {
            if (choice === "Poradit se") {
              void vscode.commands.executeCommand(
                "workbench.action.chat.open",
                { query: hint },
              );
            }
          });
      }

      // Backend-side decision composition: fn_log_dev_signal feeds
      // ai_trace_events → governedOrchestration → optional async push
      // back via aisha-push if backend decides advisory is warranted.
      // The extension does NOT compose decisions locally — that's
      // backend's job (mcp_consult_dirigent, governedOrchestration,
      // unifiedChat, KB retrieval). Extension stays thin: emit signal,
      // wait for async push response if relevant.
    }
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register the Copilot Watcher on text document changes.
 *
 * Called from `extension.ts activate()`.
 * Returns disposables are pushed onto `context.subscriptions`.
 */
export function registerCopilotWatcher(
  context: vscode.ExtensionContext,
): void {
  // Ensure output channel exists from the start
  outputChannel = getChannel();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const { document, contentChanges } = event;

      // Only TS/JS files
      if (!TARGET_LANGS.has(document.languageId)) return;
      // Only workspace files (skip output panels, diff views, etc.)
      if (document.uri.scheme !== "file") return;
      // Skip empty events (cursor moves, selection changes)
      if (contentChanges.length === 0) return;

      // Accumulate all inserted text in this debounce window
      for (const change of contentChanges) {
        if (change.text) {
          pendingTexts.push({
            text: change.text,
            file: document.uri.fsPath,
          });
        }
      }

      // (Re-)arm the debounce timer — scanPending is async; setTimeout
      // ignores returned promise. Errors inside scanPending are caught
      // inline so unhandledRejection events stay quiet.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void scanPending().catch(() => {
          // already swallowed inline; this is the belt-and-braces guard
        });
      }, DEBOUNCE_MS);
    }),
  );

  context.subscriptions.push(
    new vscode.Disposable(() => {
      outputChannel?.dispose();
      outputChannel = undefined;
      if (debounceTimer) clearTimeout(debounceTimer);
    }),
  );

  outputChannel.appendLine("AISHA Compliance Watch active — monitoring TypeScript changes");
}
