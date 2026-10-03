/**
 * Aisha Push Channel — SSE listener for real-time notifications from Aisha.
 *
 * Connects to the AISHA backend Edge Function endpoint and listens for server-sent events.
 * Pushes model discovery results, eval completions, and improvement proposals
 * directly into the VS Code UI.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig } from "./config";
import { getAuthState, onAuthStateChanged } from "./auth";
import { recordApiCall } from "./resource-tracker";

/** Structured push event from Aisha backend */
export interface AishaPushEvent {
  type: "model_discovered" | "eval_completed" | "proposal_created" | "alert" | "info" | "recommendation" | "rules_updated" | "story_share";
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/** Callback for push event handlers */
export type PushEventHandler = (event: AishaPushEvent) => void;

const handlers: PushEventHandler[] = [];
let abortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isConnected = false;
let outputChannel: vscode.OutputChannel | undefined;
let reconnectCount = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Register a handler for incoming push events.
 */
export function onPushEvent(handler: PushEventHandler): vscode.Disposable {
  handlers.push(handler);
  return new vscode.Disposable(() => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  });
}

/**
 * Whether the push channel is currently connected.
 */
export function isPushConnected(): boolean {
  return isConnected;
}

/**
 * Start the SSE push channel.
 * Uses the authenticated user JWT.
 * Automatically reconnects on disconnect with exponential backoff.
 * Re-connects when user logs in, disconnects when user logs out.
 */
export function startPushChannel(context: vscode.ExtensionContext): void {
  const config = getDirigentConfig();
  const aishaUrl = config.aishaUrl;

  if (!aishaUrl) {
    return; // Not configured — silent skip
  }

  const token = resolveToken();
  if (token) {
    connectSSE(aishaUrl, token);
  }

  // Reconnect with new token when auth state changes (login/logout)
  context.subscriptions.push(
    onAuthStateChanged((state) => {
      disconnectPushChannel();
      const freshConfig = getDirigentConfig();
      const freshUrl = freshConfig.aishaUrl;
      if (!freshUrl) return;
      if (state.isAuthenticated && state.accessToken) {
        connectSSE(freshUrl, state.accessToken);
      }
    }),
  );

  // Reconnect on config change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aisha.dirigent.aishaUrl")) {
        disconnectPushChannel();
        const newConfig = getDirigentConfig();
        const newUrl = newConfig.aishaUrl;
        const newToken = resolveToken();
        if (newUrl && newToken) {
          connectSSE(newUrl, newToken);
        }
      }
    }),
  );
}

/**
 * Resolve the authenticated user JWT.
 */
function resolveToken(): string | undefined {
  const auth = getAuthState();
  if (auth.isAuthenticated && auth.accessToken) {
    return auth.accessToken;
  }
  return undefined;
}

/**
 * Stop the SSE push channel.
 */
export function disconnectPushChannel(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isConnected = false;
}

/**
 * Internal: connect to SSE endpoint and process events.
 */
async function connectSSE(
  aishaUrl: string,
  token: string,
  retryDelay = 5_000,
): Promise<void> {
  abortController = new AbortController();

  const url = `${aishaUrl}/functions/v1/aisha-push?stream=true`;

  try {
    const t0 = performance.now();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      recordApiCall("push", performance.now() - t0, 0, true);
      throw new Error(`HTTP ${response.status}`);
    }

    recordApiCall("push", performance.now() - t0, 0, false);
    isConnected = true;
    reconnectCount = 0; // Reset on successful connection
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE format: "data: {...}\n\n"
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const block of lines) {
        const dataLine = block
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!dataLine) continue;

        try {
          const event = JSON.parse(dataLine.slice(6)) as AishaPushEvent;
          for (const handler of handlers) {
            handler(event);
          }
        } catch {
          // Malformed event — skip
        }
      }
    }
  } catch (err) {
    if (abortController?.signal.aborted) return; // Intentional disconnect

    const msg = err instanceof Error ? err.message : String(err);

    // Don't retry on client errors (4xx) — these indicate config problems,
    // not transient network issues. Retrying would flood the backend.
    const httpStatus = /HTTP (\d+)/.exec(msg);
    if (httpStatus) {
      const status = parseInt(httpStatus[1], 10);
      if (status >= 400 && status < 500) {
        if (!outputChannel) {
          outputChannel = vscode.window.createOutputChannel("AISHA Push");
        }
        outputChannel.appendLine(
          `[${new Date().toISOString()}] Push channel disabled: ${msg}. Check aishaUrl/token configuration.`,
        );
        return; // No reconnect on 4xx
      }
    }

    if (!outputChannel) {
      outputChannel = vscode.window.createOutputChannel("AISHA Push");
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] Connection lost: ${msg}. Reconnecting in ${retryDelay}ms…`);
  } finally {
    isConnected = false;
  }

  // Exponential backoff reconnect (max 60s, max 10 attempts) — only for transient errors / normal stream close
  reconnectCount++;
  if (reconnectCount > MAX_RECONNECT_ATTEMPTS) {
    if (!outputChannel) {
      outputChannel = vscode.window.createOutputChannel("AISHA Push");
    }
    outputChannel.appendLine(
      `[${new Date().toISOString()}] Push channel stopped after ${MAX_RECONNECT_ATTEMPTS} failed reconnect attempts.`,
    );
    void vscode.window.showWarningMessage(
      vscode.l10n.t("AISHA Push channel disconnected after {0} retries. Click to retry.", MAX_RECONNECT_ATTEMPTS),
      vscode.l10n.t("Retry"),
    ).then((action) => {
      if (action === vscode.l10n.t("Retry")) {
        reconnectCount = 0;
        connectSSE(aishaUrl, token);
      }
    });
    return;
  }
  const nextDelay = Math.min(retryDelay * 2, 60_000);
  reconnectTimeout = setTimeout(() => {
    connectSSE(aishaUrl, token, nextDelay);
  }, retryDelay);
}
