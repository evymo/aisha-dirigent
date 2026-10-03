/**
 * Safe Logger — VS Code OutputChannel-based logging for the AISHA Dirigent extension.
 *
 * Replaces direct `console.*` calls (forbidden by AISHA Development Laws — "No console.log").
 * Errors are written to a dedicated output channel that the user can open via the
 * `AISHA Dirigent` channel in the Output panel, and never leak to the developer console.
 *
 * Usage:
 *   import { safeError, safeInfo } from "./safe-logger";
 *   safeError("Bootstrap", "Fetch failed", err);
 *   safeInfo("Bootstrap", "Workspace config not available, using derived URL");
 *
 * @module
 */

import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("AISHA Dirigent");
  }
  return channel;
}

function formatMessage(scope: string, message: string, err?: unknown): string {
  const ts = new Date().toISOString();
  const detail =
    err instanceof Error
      ? err.message
      : err !== undefined
        ? String(err)
        : "";
  return detail
    ? `[${ts}] [${scope}] ${message}: ${detail}`
    : `[${ts}] [${scope}] ${message}`;
}

/**
 * Log an error to the AISHA Dirigent output channel.
 * Use instead of `console.error` / `console.warn` for failures.
 */
export function safeError(scope: string, message: string, err?: unknown): void {
  getChannel().appendLine(formatMessage(scope, `ERROR ${message}`, err));
}

/**
 * Log an informational message to the AISHA Dirigent output channel.
 * Use instead of `console.log` / `console.info` for non-error diagnostics.
 */
export function safeInfo(scope: string, message: string): void {
  getChannel().appendLine(formatMessage(scope, `INFO  ${message}`));
}
