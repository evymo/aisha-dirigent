/**
 * Terminal Watcher — AISHA Dirigent terminal output monitoring.
 *
 * Watches terminal shell executions (test runs, builds, tsc) for errors.
 * When errors are detected, builds a structured Dirigent Brief and
 * sends it to the Copilot chat for the agent to act on.
 *
 * Uses VS Code Shell Integration API (`onDidEndTerminalShellExecution`)
 * to intercept command completions and parse output.
 *
 * @module
 */

import * as vscode from "vscode";
import {
  buildTerminalReport as buildValidatedReport,
  classifyCommand as classifyWatchedCommand,
  extractRelevantExcerpt as extractWatchedExcerpt,
  parseErrors as parseWatchedErrors,
  parseTestSummary as parseWatchedTestSummary,
  type TerminalError,
  type TerminalReport as SharedTerminalReport,
  type WatchedCommandType,
} from "@aisha/local-signals";
import { callRpc } from "./backend-rpc";

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────

/** Minimum time between terminal error notifications (ms). */
const NOTIFICATION_COOLDOWN_MS = 20_000;

/** Max characters of terminal output to capture per command. */
const MAX_OUTPUT_CHARS = 30_000;

/** Max error lines to include in a brief. */
const MAX_ERROR_LINES = 15;

type TerminalReport = SharedTerminalReport;

interface CommandClassification {
  type: WatchedCommandType;
  label: string;
}

function parseErrors(output: string, commandType: WatchedCommandType): TerminalError[] {
  return parseWatchedErrors(output, commandType);
}

function parseTestSummary(output: string): { failures: number; passed: number } | null {
  return parseWatchedTestSummary(output);
}

// ──────────────────────────────────────────
// Brief Building
// ──────────────────────────────────────────

/**
 * Build a structured Dirigent Brief from terminal errors.
 * This is sent to the Copilot chat for the agent to process.
 */
function buildTerminalBrief(report: TerminalReport): string {
  const parts: string[] = [];

  // Header
  parts.push(`${report.commandLabel} selhaly (exit code: ${report.exitCode ?? "N/A"}).`);
  parts.push(`Oprav následující chyby a spusť příkaz znovu.`);

  // Summary
  if (report.testFailures !== undefined) {
    parts.push("");
    parts.push(`[Souhrn testů]`);
    parts.push(`Selhalo: ${report.testFailures}, Prošlo: ${report.testPassed ?? "?"}`);
  }

  // Parsed errors
  const errors = report.errors ?? [];
  if (errors.length > 0) {
    parts.push("");
    parts.push("[Chyby]");
    const shown = errors.slice(0, MAX_ERROR_LINES);
    for (const error of shown) {
      const location = error.file
        ? `${error.file}${error.line ? `:${error.line}` : ""}`
        : "";
      parts.push(location ? `• ${location} — ${error.message}` : `• ${error.message}`);
    }
    if (errors.length > MAX_ERROR_LINES) {
      parts.push(`  ... a dalších ${errors.length - MAX_ERROR_LINES} chyb`);
    }
  }

  // Action directives
  parts.push("");
  parts.push("[Akce]");
  switch (report.commandType) {
    case "typecheck":
      parts.push("1. Oprav TypeScript chyby v uvedených souborech");
      parts.push("2. Spusť: npx tsc --noEmit");
      break;
    case "test":
    case "gate":
      parts.push("1. Přečti selhané testy a oprav implementaci nebo mock");
      parts.push("2. Spusť POUZE selhané testy: npm run test:run -- <cesta-k-testu>");
      parts.push("3. Po opravě: npm run build");
      break;
    case "build":
      parts.push("1. Oprav build chyby");
      parts.push("2. Spusť: npm run build");
      break;
    case "lint":
      parts.push("1. Oprav ESLint chyby (ne pomocí disable komentářů!)");
      parts.push("2. Spusť: npm run lint");
      break;
    case "i18n":
      parts.push("1. Doplň chybějící překlady do src/i18n/segments/{lang}/*.json");
      parts.push("2. Spusť: npm run i18n:check");
      break;
    case "migration":
      parts.push("1. Zkontroluj migrační SQL soubor");
      parts.push("2. Spusť: npm run db:migrate:local");
      break;
    case "e2e":
      parts.push("1. Zkontroluj selhané E2E testy");
      parts.push("2. Ověř že lokální AISHA stack běží: npm run warmup:local");
      parts.push("3. Spusť: npm run test:e2e:local");
      break;
    case "git_bypass":
      parts.push("⛔ KRITICKÁ VIOLATION: Použití --no-verify je ABSOLUTNĚ ZAKÁZÁNO.");
      parts.push("1. NIKDY nepoužívej git push --no-verify ani git commit --no-verify");
      parts.push("2. Pokud hook selhává → OPRAV PŘÍČINU selhání");
      parts.push("3. Vrať změny: git reset HEAD~1 (pokud byl commit proveden)");
      parts.push("4. Spusť: npm run test:gates && npm run test:run && npm run build");
      parts.push("5. Teprve po úspěchu všech hookù commitni/pushni NORMÁLNĚ");
      break;
  }

  // Raw excerpt for context
  if (report.rawExcerpt) {
    parts.push("");
    parts.push("[Výstup terminálu (výřez)]");
    parts.push("```");
    parts.push(report.rawExcerpt);
    parts.push("```");
  }

  return parts.join("\n");
}

/**
 * Build a success brief (short confirmation).
 */
function buildSuccessBrief(report: TerminalReport): string {
  if (report.commandType === "test" || report.commandType === "gate") {
    const summary = report.testPassed !== undefined
      ? ` (${report.testPassed} testů prošlo)`
      : "";
    return `✓ ${report.commandLabel} prošly${summary}. Pokračuj dalším krokem.`;
  }
  return `✓ ${report.commandLabel} — úspěch.`;
}

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────

let lastNotificationTime = 0;
let outputChannel: vscode.OutputChannel | undefined;

/** Auto-send mode: if true, error briefs go to chat automatically. */
let autoSendErrors = false;

function log(msg: string): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Terminal Watcher");
  }
  outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function canNotify(): boolean {
  const now = Date.now();
  if (now - lastNotificationTime < NOTIFICATION_COOLDOWN_MS) return false;
  lastNotificationTime = now;
  return true;
}

// ──────────────────────────────────────────
// Command line extraction
// ──────────────────────────────────────────

/**
 * Extract the command line string from a TerminalShellExecution.
 * Uses the commandLine property (VS Code 1.99+).
 */
function extractCommandLine(execution: vscode.TerminalShellExecution): string {
  try {
    const cl = execution.commandLine;
    if (cl && typeof cl === "object" && "value" in cl) {
      return (cl as { value: string }).value;
    }
    if (typeof cl === "string") {
      return cl;
    }
  } catch {
    // Fallback
  }
  return "";
}

/**
 * Classify a command line into a watched command type.
 */
function classifyCommand(commandLine: string): CommandClassification | null {
  return classifyWatchedCommand(commandLine) as CommandClassification | null;
}

// ──────────────────────────────────────────
// Output collection
// ──────────────────────────────────────────

/**
 * Collect output from a TerminalShellExecution stream.
 * Reads the async iterable and concatenates content up to MAX_OUTPUT_CHARS.
 */
async function collectOutput(execution: vscode.TerminalShellExecution): Promise<string> {
  let output = "";
  try {
    for await (const data of execution.read()) {
      output += data;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(-MAX_OUTPUT_CHARS);
        break;
      }
    }
  } catch (err) {
    log(`Output collection error: ${err}`);
  }
  return output;
}

/**
 * Extract the last N lines containing relevant error information.
 */
function extractRelevantExcerpt(output: string, maxLines: number = 30): string {
  return extractWatchedExcerpt(output, maxLines);
}

// ──────────────────────────────────────────
// Backend persistence
// ──────────────────────────────────────────

/** Max parsed errors to send to backend (avoid oversized payloads). */
const MAX_PERSISTED_ERRORS = 15;

/**
 * Persist a terminal command result to the backend via fn_log_dev_signal.
 * Fire-and-forget — never blocks the watcher flow.
 */
function persistTerminalSignal(report: TerminalReport): void {
  const signalType = report.success ? "terminal_success" : "terminal_failure";
  const severity = report.success ? "info" : "error";

  const errors = (report.errors ?? []).slice(0, MAX_PERSISTED_ERRORS).map((e) => ({
    file: e.file ?? null,
    line: e.line ?? null,
    message: e.message,
  }));

  void callRpc("fn_log_dev_signal", {
    p_signal_type: signalType,
    p_severity: severity,
    p_payload: {
      command_type: report.commandType,
      command_label: report.commandLabel,
      exit_code: report.exitCode ?? null,
      error_count: errors.length,
      errors,
      test_failures: report.testFailures ?? null,
      test_passed: report.testPassed ?? null,
    },
  });
}

// ──────────────────────────────────────────
// Core handler
// ──────────────────────────────────────────

/**
 * Handle a completed terminal shell execution.
 * Called by the `onDidEndTerminalShellExecution` listener.
 */
async function onShellExecutionEnd(event: vscode.TerminalShellExecutionEndEvent): Promise<void> {
  const commandLine = extractCommandLine(event.execution);
  if (!commandLine) return;

  const classification = classifyCommand(commandLine);
  if (!classification) {
    // Not a watched command — ignore
    return;
  }

  log(`Command completed: "${commandLine}" → ${classification.type} (exit: ${event.exitCode})`);

  const exitCode = event.exitCode;
  const success = exitCode === 0;

  // Collect output for error parsing
  const rawOutput = await collectOutput(event.execution);

  // Parse errors
  const errors = success ? [] : parseErrors(rawOutput, classification.type);

  // Test summary
  const testSummary = (classification.type === "test" || classification.type === "gate" || classification.type === "e2e")
    ? parseTestSummary(rawOutput)
    : null;

  const report: TerminalReport = buildValidatedReport({
    commandType: classification.type,
    commandLabel: classification.label,
    commandLine,
    exitCode,
    success,
    errors,
    summary: success ? "OK" : `${errors.length} chyb detekováno`,
    testFailures: testSummary?.failures,
    testPassed: testSummary?.passed,
    rawExcerpt: success ? "" : extractRelevantExcerpt(rawOutput),
    finishedAt: new Date().toISOString(),
  });

  log(`Report: ${report.summary} (errors: ${errors.length}, testFail: ${report.testFailures ?? "N/A"})`);

  // ── git_bypass: ALWAYS report, even on "success" ──
  if (classification.type === "git_bypass") {
    persistTerminalSignal({ ...report, success: false });
    const brief = buildTerminalBrief({
      ...report,
      success: false,
      summary: "⛔ VIOLATION: --no-verify bypass detekován",
      errors: [{ message: `Příkaz "${commandLine}" použil --no-verify — toto je ABSOLUTNĚ ZAKÁZÁNO.`, raw: commandLine }],
    });
    log(`⛔ CRITICAL: --no-verify bypass detected: "${commandLine}"`);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
    void vscode.window.showErrorMessage(
      "⛔ AISHA: --no-verify je ABSOLUTNĚ ZAKÁZÁNO. Oprav příčinu selhání hooků místo jejich obcházení.",
    );
    return;
  }

  if (success) {
    // Success — log it, optionally show brief confirmation
    log(`✓ ${classification.label} passed`);
    persistTerminalSignal(report);
    if (classification.type === "test" || classification.type === "gate") {
      // Show brief success notification in output channel
      const brief = buildSuccessBrief(report);
      log(brief);
    }
    return;
  }

  // ── Failure detected — build and send brief ──

  persistTerminalSignal(report);

  if (!canNotify()) {
    log(`Cooldown active, deferring error brief for "${commandLine}"`);
    return;
  }

  const brief = buildTerminalBrief(report);

  if (autoSendErrors) {
    log(`Auto-sending error brief to chat for: ${classification.label}`);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
    return;
  }

  // Ask user
  const action = await vscode.window.showWarningMessage(
    vscode.l10n.t("AISHA Dirigent: {0} — {1} chyb detekováno. Poslat do chatu k opravě?",
      classification.label, String(errors.length || "několik")),
    vscode.l10n.t("Send to Chat"),
    vscode.l10n.t("Always send"),
    vscode.l10n.t("Show Output"),
    vscode.l10n.t("Dismiss"),
  );

  if (action === vscode.l10n.t("Always send")) {
    autoSendErrors = true;
    log("Auto-send errors enabled for this session");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
  } else if (action === vscode.l10n.t("Send to Chat")) {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: brief });
  } else if (action === vscode.l10n.t("Show Output")) {
    outputChannel?.show(true);
    outputChannel?.appendLine("\n" + "=".repeat(60));
    outputChannel?.appendLine(brief);
    outputChannel?.appendLine("=".repeat(60));
  }
}

// ──────────────────────────────────────────
// Proactive --no-verify detection
// ──────────────────────────────────────────

/** Regex for detecting --no-verify in git commands. */
const NO_VERIFY_PATTERN = /git\s+(?:push|commit)\s+.*--no-verify|git\s+.*--no-verify\s+(?:push|commit)/;

/**
 * Handle a starting terminal shell execution.
 * Proactively detects --no-verify BEFORE the command completes.
 */
function onShellExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
  const commandLine = extractCommandLine(event.execution);
  if (!commandLine) return;

  if (NO_VERIFY_PATTERN.test(commandLine)) {
    log(`⛔ PROACTIVE: --no-verify detected at command START: "${commandLine}"`);
    void vscode.window.showErrorMessage(
      "⛔ AISHA: Detekováno --no-verify! Toto je ABSOLUTNĚ ZAKÁZÁNO. Oprav příčinu selhání hooků.",
    );
  }
}

// ──────────────────────────────────────────
// Registration
// ──────────────────────────────────────────

/**
 * Register the terminal watcher.
 *
 * Listens for `onDidEndTerminalShellExecution` to detect completed
 * commands and parse their output for errors.
 *
 * Called from `extension.ts activate()`.
 */
export function registerTerminalWatcher(
  context: vscode.ExtensionContext,
): void {
  // Output channel
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("AISHA Terminal Watcher");
  }
  context.subscriptions.push(outputChannel);

  // Shell execution end listener (VS Code 1.93+)
  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((event) => {
      void onShellExecutionEnd(event);
    }),
  );

  // Shell execution start listener — proactive --no-verify detection
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      onShellExecutionStart(event);
    }),
  );

  log("AISHA Terminal Watcher registered — monitoring test/build/lint/git commands");
}
