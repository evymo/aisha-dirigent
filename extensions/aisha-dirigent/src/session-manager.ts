/**
 * Session Manager — Multi-session orchestration for Aisha Dirigent.
 *
 * Each VS Code instance / Copilot Chat conversation is a "session"
 * that registers with Aisha. Aisha tracks all sessions, assigns
 * domains/tasks, and coordinates work across them.
 *
 * Session identity persists per workspace (stored in .aisha/session.json).
 *
 * @module
 */

import * as vscode from "vscode";
import { callN8nAgent, type N8nAgentResponse } from "./mcp-client";
import { getAuthState } from "./auth";
import { resolveStoryContext } from "./story-context";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** Domain that a session can be assigned to. */
export type SessionDomain =
  | "frontend"
  | "backend"
  | "database"
  | "testing"
  | "devops"
  | "security"
  | "i18n"
  | "general";

/** Session state tracked locally and synced with Aisha. */
export interface AishaSession {
  /** Unique session ID (UUID) */
  id: string;
  /** Authenticated user ID (from Keycloak/AISHA ID), null if anonymous */
  userId: string | null;
  /** Authenticated user email */
  userEmail: string | null;
  /** Active story/project ID this session is working on */
  storyId: string | null;
  /** Assigned domain (set by user or Aisha) */
  domain: SessionDomain;
  /** Current task description */
  currentTask: string | null;
  /** Session status */
  status: SessionStatus;
  /** Granular working phase (only when status starts with "working:") */
  workPhase: WorkPhase | null;
  /** Human-readable detail about current activity */
  statusDetail: string | null;
  /** Currently active model ID */
  activeModel: string | null;
  /** Currently active tier */
  activeTier: "edge" | "self-hosted" | "cloud" | null;
  /** Workspace root path */
  workspace: string;
  /** Human-readable session label */
  label: string;
  /** When the session was created */
  startedAt: string;
  /** Last activity timestamp */
  lastActivityAt: string;
}

/** Top-level session status. */
export type SessionStatus = "active" | "idle" | "working" | "waiting-approval" | "blocked" | "completed";

/** Granular working phase — what AISHA is doing right now. */
export type WorkPhase =
  | "routing"     // determining which tier/model to use
  | "edge"        // processing on local edge model
  | "backend"     // processing on backend (self-hosted or cloud)
  | "eval"        // running evaluation/compliance
  | "streaming";   // streaming response to user

/** Session update directive from Aisha response. */
export interface SessionDirective {
  /** Updated domain assignment */
  domain?: SessionDomain;
  /** Updated task description */
  current_task?: string;
  /** Updated status */
  status?: SessionStatus;
  /** Message to display to the user about orchestration */
  orchestration_note?: string;
  /** Cross-session messages to relay (informational) */
  cross_session?: Array<{
    target_domain: string;
    message: string;
  }>;
}

/** Session info sent to Aisha in every request. */
export interface SessionPayload {
  session_id: string;
  session_domain: SessionDomain;
  session_label: string;
  session_status: string;
  current_task: string | null;
  workspace_root: string;
  /** Authenticated user ID (null if anonymous). */
  user_id: string | null;
  /** Authenticated user email (null if anonymous). */
  user_email: string | null;
  /** Active story/project ID (null if not set). */
  story_id: string | null;
  /** Recent conversation turns (ring buffer, newest last). */
  recent_history: ConversationTurn[];
}

/** Single conversation turn — user message + Aisha summary. */
export interface ConversationTurn {
  /** When this turn happened */
  ts: string;
  /** The user's prompt / intent */
  user: string;
  /** Short summary of Aisha's response (truncated) */
  aisha: string;
  /** Intent that was detected */
  intent?: string;
  /** Whether the turn succeeded */
  ok: boolean;
}

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────

let currentSession: AishaSession | null = null;
const sessionChangeEmitter = new vscode.EventEmitter<AishaSession | null>();

/** Event fired when session state changes. */
export const onSessionStateChanged = sessionChangeEmitter.event;

// ── Conversation history (in-memory ring buffer) ────────────────────
const MAX_HISTORY = 20;
const conversationHistory: ConversationTurn[] = [];

// ──────────────────────────────────────────
// Session lifecycle
// ──────────────────────────────────────────

/**
 * Generate a UUID v4.
 */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get the workspace root path.
 */
function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "unknown";
}

/**
 * Get the session file URI (.aisha/session.json in workspace root).
 */
function getSessionFileUri(): vscode.Uri | null {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return null;
  return vscode.Uri.joinPath(root.uri, ".aisha", "session.json");
}

/**
 * Load session from .aisha/session.json if it exists.
 */
async function loadPersistedSession(): Promise<AishaSession | null> {
  const uri = getSessionFileUri();
  if (!uri) return null;

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (parsed?.id && parsed?.domain) {
      return parsed as AishaSession;
    }
  } catch {
    // File doesn't exist or invalid — that's fine
  }
  return null;
}

/**
 * Persist session to .aisha/session.json.
 */
async function persistSession(session: AishaSession): Promise<void> {
  const uri = getSessionFileUri();
  if (!uri) return;

  try {
    const dirUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri,
      ".aisha",
    );
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // exists
  }

  await vscode.workspace.fs.writeFile(
    uri,
    new TextEncoder().encode(JSON.stringify(session, null, 2) + "\n"),
  );
}

/**
 * Initialize or restore the session for this workspace.
 * Called on extension activation.
 */
export async function initSession(): Promise<AishaSession> {
  // Try to restore persisted session
  const persisted = await loadPersistedSession();
  if (persisted) {
    persisted.status = "active";
    persisted.lastActivityAt = new Date().toISOString();
    currentSession = persisted;
    sessionChangeEmitter.fire(currentSession);
    return currentSession;
  }

  // Create new session
  const workspaceRoot = getWorkspaceRoot();
  const folderName = workspaceRoot.split("/").pop() ?? "workspace";
  const auth = getAuthState();
  const story = await resolveStoryContext();

  currentSession = {
    id: uuid(),
    userId: auth.userId,
    userEmail: auth.email,
    storyId: story.storyId,
    domain: "general",
    currentTask: null,
    status: "idle",
    workPhase: null,
    statusDetail: null,
    activeModel: null,
    activeTier: null,
    workspace: workspaceRoot,
    label: folderName,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  await persistSession(currentSession);
  sessionChangeEmitter.fire(currentSession);
  return currentSession;
}

/**
 * Get current session (initializes if needed).
 */
export async function getSession(): Promise<AishaSession> {
  if (!currentSession) {
    return initSession();
  }
  // Update activity timestamp
  currentSession.lastActivityAt = new Date().toISOString();
  return currentSession;
}

/**
 * Get current session synchronously (may return null if not initialized).
 */
export function getSessionSync(): AishaSession | null {
  return currentSession;
}

/**
 * Build session payload for Aisha requests.
 * Includes recent conversation history so Aisha knows what was discussed.
 */
export async function getSessionPayload(): Promise<SessionPayload> {
  const session = await getSession();
  // Prefer live auth state over persisted session (tokens may have refreshed)
  const auth = getAuthState();
  // Resolve story from file/config (may change between calls)
  const story = await resolveStoryContext();
  return {
    session_id: session.id,
    session_domain: session.domain,
    session_label: session.label,
    session_status: session.status,
    current_task: session.currentTask,
    workspace_root: session.workspace,
    user_id: auth.userId ?? session.userId,
    user_email: auth.email ?? session.userEmail,
    story_id: story.storyId ?? session.storyId,
    recent_history: [...conversationHistory],
  };
}

/**
 * Record a conversation turn (user prompt + Aisha response summary).
 * Called after each successful exchange with Aisha.
 */
export function recordTurn(
  userPrompt: string,
  aishaResponse: string | undefined,
  intent: string | undefined,
  ok: boolean,
): void {
  // Truncate Aisha response to keep payload reasonable
  const summary = aishaResponse
    ? aishaResponse.substring(0, 300) + (aishaResponse.length > 300 ? "…" : "")
    : "(no response)";

  conversationHistory.push({
    ts: new Date().toISOString(),
    user: userPrompt.substring(0, 200),
    aisha: summary,
    intent,
    ok,
  });

  // Ring buffer — keep only last N turns
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

/**
 * Get the recent conversation history.
 */
export function getRecentHistory(): ConversationTurn[] {
  return [...conversationHistory];
}

// ──────────────────────────────────────────
// Session mutations
// ──────────────────────────────────────────

/**
 * Assign this session to a specific domain.
 */
export async function assignDomain(domain: SessionDomain, label?: string): Promise<void> {
  const session = await getSession();
  session.domain = domain;
  if (label) session.label = label;
  await persistSession(session);
  sessionChangeEmitter.fire(session);
}

/**
 * Update session based on Aisha's response directive.
 */
export async function applyDirective(directive: SessionDirective): Promise<void> {
  const session = await getSession();

  if (directive.domain) session.domain = directive.domain;
  if (directive.current_task !== undefined) session.currentTask = directive.current_task;
  if (directive.status) session.status = directive.status;

  await persistSession(session);
  sessionChangeEmitter.fire(session);
}

/**
 * Set the current task for this session.
 */
export async function setCurrentTask(task: string | null): Promise<void> {
  const session = await getSession();
  session.currentTask = task;
  await persistSession(session);
  sessionChangeEmitter.fire(session);
}

/**
 * Mark session as completed and persist.
 */
export async function completeSession(): Promise<void> {
  const session = await getSession();
  session.status = "completed";
  session.currentTask = null;
  session.workPhase = null;
  session.statusDetail = null;
  session.activeModel = null;
  session.activeTier = null;
  await persistSession(session);
  sessionChangeEmitter.fire(session);
}

/**
 * Set the working phase — used to show granular status in the UI.
 *
 * Call `setWorkPhase("routing")` when starting to determine the tier,
 * `setWorkPhase("edge", "llama3.2", "edge")` when processing on edge, etc.
 * Call `clearWorkPhase()` when the task completes.
 */
export function setWorkPhase(
  phase: WorkPhase,
  detail?: string,
  model?: string,
  tier?: "edge" | "self-hosted" | "cloud",
): void {
  if (!currentSession) return;
  currentSession.status = "working";
  currentSession.workPhase = phase;
  currentSession.statusDetail = detail ?? null;
  currentSession.activeModel = model ?? null;
  currentSession.activeTier = tier ?? null;
  currentSession.lastActivityAt = new Date().toISOString();
  sessionChangeEmitter.fire(currentSession);
}

/**
 * Clear the working phase — session goes back to idle.
 */
export function clearWorkPhase(): void {
  if (!currentSession) return;
  currentSession.status = "idle";
  currentSession.workPhase = null;
  currentSession.statusDetail = null;
  currentSession.activeModel = null;
  currentSession.activeTier = null;
  sessionChangeEmitter.fire(currentSession);
}

/**
 * Get the current work phase status as a display string.
 */
export function getWorkPhaseLabel(): string {
  if (!currentSession || currentSession.status !== "working") return "idle";
  const phase = currentSession.workPhase ?? "working";
  const detail = currentSession.statusDetail;
  if (detail) return `${phase}: ${detail}`;
  return phase;
}

/**
 * Reset session — new ID, general domain.
 */
export async function resetSession(): Promise<AishaSession> {
  const workspaceRoot = getWorkspaceRoot();
  const folderName = workspaceRoot.split("/").pop() ?? "workspace";

  currentSession = {
    id: uuid(),
    userId: null,
    userEmail: null,
    storyId: null,
    domain: "general",
    currentTask: null,
    status: "idle",
    workPhase: null,
    statusDetail: null,
    activeModel: null,
    activeTier: null,
    workspace: workspaceRoot,
    label: folderName,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  await persistSession(currentSession!);
  sessionChangeEmitter.fire(currentSession!);
  return currentSession!;
}

// ──────────────────────────────────────────
// Aisha communication — session-aware
// ──────────────────────────────────────────

/**
 * Register this session with Aisha (call on activation).
 * Sends a lightweight "hello" so Aisha knows about this session.
 */
export async function registerWithAisha(): Promise<N8nAgentResponse | null> {
  const session = await getSession();

  const result = await callN8nAgent("dirigent-agent", {
    task: `Session registration: ${session.label} (${session.domain})`,
    intent: "session_register",
    session: {
      session_id: session.id,
      session_domain: session.domain,
      session_label: session.label,
      session_status: session.status,
      current_task: session.currentTask,
      workspace_root: session.workspace,
    },
    context: {
      event: "session_start",
    },
  });

  // Apply any directive from Aisha's response
  if (result?.directive) {
    await applyDirective(result.directive as SessionDirective);
  }

  return result;
}

/**
 * Query Aisha for all active sessions (cross-instance awareness).
 */
export async function queryActiveSessions(): Promise<N8nAgentResponse | null> {
  const session = await getSession();

  return callN8nAgent("dirigent-agent", {
    task: "List all active sessions and their current assignments",
    intent: "session_list",
    session: {
      session_id: session.id,
      session_domain: session.domain,
      session_label: session.label,
      session_status: session.status,
      current_task: session.currentTask,
      workspace_root: session.workspace,
    },
    context: {
      event: "session_query",
    },
  });
}

/**
 * Ask Aisha to decompose a project/feature into domains and tasks.
 */
export async function requestProjectPlan(
  description: string,
  contextSummary: string,
): Promise<N8nAgentResponse | null> {
  const session = await getSession();

  return callN8nAgent("dirigent-agent", {
    task: description,
    intent: "project_plan",
    session: {
      session_id: session.id,
      session_domain: session.domain,
      session_label: session.label,
      session_status: session.status,
      current_task: session.currentTask,
      workspace_root: session.workspace,
    },
    context: {
      event: "project_planning",
      context_summary: contextSummary,
    },
  });
}
