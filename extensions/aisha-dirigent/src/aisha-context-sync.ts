/**
 * Aisha Context Sync — Periodic workspace context sharing with Aisha backend.
 *
 * Sends workspace context (tech stack, active files, git state, diagnostics)
 * to the backend so Aisha can proactively suggest improvements and detect
 * issues without waiting for user interaction.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig } from "./config";
import { getWorkspaceContext } from "./workspace";
import { getAuthState, isTokenExpiringSoon, silentRefresh } from "./auth";
import { recordApiCall } from "./resource-tracker";
import { getLastKnownBranch } from "./auto-flow";

/** Sync interval in milliseconds (default: 5 minutes) */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let syncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic context sync with the Aisha backend.
 */
export function startContextSync(context: vscode.ExtensionContext): void {
  const config = getDirigentConfig();
  const aishaUrl = config.aishaUrl;

  if (!aishaUrl) {
    return; // Not configured
  }

  // Initial sync after 30s (let extension fully initialize)
  const initialTimer = setTimeout(() => {
    void syncContext(aishaUrl);
  }, 30_000);
  context.subscriptions.push(new vscode.Disposable(() => clearTimeout(initialTimer)));

  // Periodic sync — only when VS Code window is focused
  syncTimer = setInterval(() => {
    if (!vscode.window.state.focused) return;
    void syncContext(aishaUrl);
  }, SYNC_INTERVAL_MS);

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
    }),
  );
}

/**
 * Send workspace context to the backend.
 */
async function syncContext(aishaUrl: string): Promise<void> {
  const t0 = performance.now();
  try {
    const token = await resolveContextToken();
    if (!token) return;

    const ctx = await getWorkspaceContext();

    // Use cached branch from auto-flow if available (avoids duplicate git exec)
    const branch = getLastKnownBranch() ?? ctx.gitBranch;

    const body = JSON.stringify({
      source: "vscode-extension",
      user_id: getAuthState().userId ?? undefined,
      context: {
        tech_stack: ctx.techStack,
        active_files: ctx.activeFilePaths,
        git_branch: branch,
        recent_commits: ctx.recentCommits,
        diagnostics: ctx.diagnosticSummary,
        dirty_files: ctx.dirtyFiles,
        active_language: ctx.activeLanguage,
      },
    });

    await fetch(`${aishaUrl}/functions/v1/ai-context-composer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    recordApiCall("context-sync", performance.now() - t0, body.length, false);
  } catch {
    recordApiCall("context-sync", performance.now() - t0, 0, true);
  }
}

async function resolveContextToken(): Promise<string | undefined> {
  const auth = getAuthState();
  if (auth.accessToken) {
    if (isTokenExpiringSoon()) {
      await silentRefresh();
    }
    const refreshedAuth = getAuthState();
    if (refreshedAuth.accessToken) {
      return refreshedAuth.accessToken;
    }
  }

  return undefined;
}
