/**
 * Live session push — mirrors the extension's local session state into the
 * universal agent_live_sessions registry (fn_upsert_agent_live_session RPC)
 * so Mission Control and other Dirigent surfaces see VS Code activity the
 * same way they see Claude Code CLI sessions.
 *
 * Design:
 *   - Subscribes to onSessionStateChanged (every session mutation fires it) —
 *     zero changes inside session-manager mutation functions.
 *   - Debounced (5s) so a burst of phase transitions becomes one upsert.
 *   - Fail-silent: live monitoring is observational; push errors never
 *     surface to the user (matches the CLI relay's fail-open contract).
 *
 * Phase mapping (extension vocabulary → agent_phase_catalog axis='activity'):
 *   status working           → tool_use
 *   status waiting-approval  → reviewing
 *   status blocked           → reviewing
 *   status completed         → stopped
 *   status active|idle       → idle
 * The granular workPhase (routing|edge|backend|eval|streaming — axis
 * 'pipeline') rides in phase_detail.
 *
 * @module
 */

import * as vscode from "vscode";
import { onSessionStateChanged, type AishaSession } from "./session-manager";
import { authenticatedFetch, getBaseUrl, isApiReady } from "./authenticated-fetch";

const DEBOUNCE_MS = 5_000;
const SOURCE = "vscode";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSession: AishaSession | null = null;
let disposed = false;

/** Extension session status → agent_phase_catalog activity-axis slug. */
function mapStatusToPhase(status: AishaSession["status"]): string {
  switch (status) {
    case "working":
      return "tool_use";
    case "waiting-approval":
    case "blocked":
      return "reviewing";
    case "completed":
      return "stopped";
    default:
      return "idle";
  }
}

async function pushSession(session: AishaSession): Promise<void> {
  if (!isApiReady()) return;
  try {
    await authenticatedFetch(`${getBaseUrl()}/rest/v1/rpc/fn_upsert_agent_live_session`, {
      method: "POST",
      body: JSON.stringify({
        p_session_id: session.id,
        p_source: SOURCE,
        p_story_id: session.storyId ?? null,
        p_user_id: session.userId ?? null,
        p_branch: null,
        p_phase: mapStatusToPhase(session.status),
        p_phase_detail: session.workPhase ?? null,
        p_current_task: session.currentTask ?? null,
        p_last_tool: session.activeModel ?? null,
        p_last_file: null,
      }),
      trackingCategory: "rpc",
    });
  } catch {
    // Observational only — never surface push failures.
  }
}

function scheduleDebouncedPush(session: AishaSession): void {
  pendingSession = session;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (disposed || !pendingSession) return;
    const toPush = pendingSession;
    pendingSession = null;
    void pushSession(toPush);
  }, DEBOUNCE_MS);
}

/**
 * Wire the live-session push. Call once from extension activate(); returns
 * a Disposable for the extension subscription list.
 */
export function registerLiveSessionPush(): vscode.Disposable {
  disposed = false;
  const subscription = onSessionStateChanged((session) => {
    if (!session) return;
    // 'stopped' is a terminal transition the dashboard should see promptly —
    // flush it immediately instead of waiting out the debounce window.
    if (session.status === "completed") {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingSession = null;
      void pushSession(session);
      return;
    }
    scheduleDebouncedPush(session);
  });

  return new vscode.Disposable(() => {
    disposed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingSession = null;
    subscription.dispose();
  });
}
