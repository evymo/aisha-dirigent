/**
 * Story context management — caches active story ID, loads story context.
 *
 * Persistent story association via workspace `.aisha/story.json`
 * and VS Code configuration fallback.
 *
 * @module
 */

import * as vscode from "vscode";
import * as path from "path";
import { getDirigentConfig, updateLocalConfig } from "./config";

/** Persisted story info in `.aisha/story.json` */
interface StoryFile {
  story_id: string;
  updated_at: string;
}

/** In-memory story context */
export interface StoryContext {
  /** Active story ID or null if not set */
  storyId: string | null;
  /** Source of the story ID */
  source: "session" | "config" | "file" | "none";
}

// ── Story change event ──────────────────────
const storyChangeEmitter = new vscode.EventEmitter<string | null>();

/** Fires when the active story ID changes (session set, persist, or clear). */
export const onStoryChanged = storyChangeEmitter.event;

/**
 * Browse story context — tracks which story the user is viewing
 * in the AISHA Story Panel without changing the active runtime story.
 * The active story (resolveStoryContext) drives orchestration, while
 * browseStoryId only affects the panel UI.
 */
let browseStoryId: string | null = null;

/**
 * Ephemeral session story ID — highest-precedence override.
 * Lives only in memory; cleared on extension restart / logout.
 * Set after login story selection or explicit user action.
 */
let sessionStoryId: string | null = null;

/** Get the currently browsed story ID (panel navigation only). */
export function getBrowseStoryId(): string | null {
  return browseStoryId;
}

/** Set the browsed story ID. Does NOT change the active runtime story. */
export function setBrowseStoryId(id: string | null): void {
  browseStoryId = id;
}

/** Get the ephemeral session story ID (highest precedence). */
export function getSessionStoryId(): string | null {
  return sessionStoryId;
}

/**
 * Set the ephemeral session story ID. Takes highest precedence
 * in resolveStoryContext(). Pass null to clear.
 * Fires onStoryChanged event.
 */
export function setSessionStoryId(id: string | null): void {
  const prev = sessionStoryId;
  sessionStoryId = id;
  if (prev !== id) {
    storyChangeEmitter.fire(id);
  }
}

const STORY_FILE = ".aisha/story.json";

/**
 * Resolve current story ID from multiple sources (highest precedence first):
 * 1. Ephemeral session state (in-memory, set after login story pick)
 * 2. Config storyId (dirigent.local.json / env / profile)
 * 3. `.aisha/story.json` in workspace root
 */
export async function resolveStoryContext(): Promise<StoryContext> {
  // 1. Ephemeral session — highest precedence
  if (sessionStoryId) {
    return { storyId: sessionStoryId, source: "session" };
  }

  // 2. Check config (dirigent.local.json, env, profile)
  const configStoryId = getDirigentConfig().storyId;
  if (configStoryId) {
    return { storyId: configStoryId, source: "config" };
  }

  // 2. Check .aisha/story.json
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root) {
    try {
      const fileUri = vscode.Uri.joinPath(root.uri, STORY_FILE);
      const content = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(new TextDecoder().decode(content)) as StoryFile;
      if (parsed.story_id) {
        return { storyId: parsed.story_id, source: "file" };
      }
    } catch {
      // File doesn't exist or is invalid
    }
  }

  return { storyId: null, source: "none" };
}

/**
 * Persist story ID to `.aisha/story.json`.
 */
export async function persistStoryId(storyId: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showWarningMessage(
      "No workspace folder — cannot persist story ID.",
    );
    return;
  }

  const dirUri = vscode.Uri.joinPath(root.uri, ".aisha");
  const fileUri = vscode.Uri.joinPath(root.uri, STORY_FILE);

  // Ensure directory exists
  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // Directory may already exist
  }

  const data: StoryFile = {
    story_id: storyId,
    updated_at: new Date().toISOString(),
  };

  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(JSON.stringify(data, null, 2) + "\n"),
  );

  // Sync storyId to dirigent.local.json so getDirigentConfig() reflects
  // the selection and fires configChangeEmitter for UI refresh.
  await updateLocalConfig("storyId", storyId);

  // Notify listeners (chat view, panel, etc.)
  storyChangeEmitter.fire(storyId);
}

/**
 * Prompt user to set a story ID via input box.
 *
 * @returns The entered story ID or undefined if cancelled.
 */
export async function promptForStoryId(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "AISHA Story ID",
    prompt: "Enter the Story (project) ID for the current workspace",
    placeHolder: "e.g. 550e8400-e29b-41d4-a716-446655440000",
    validateInput(value: string) {
      if (!value.trim()) return "Story ID is required";
      // UUID or short ID accepted
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value.trim(),
        ) &&
        !/^[a-zA-Z0-9_-]{4,36}$/.test(value.trim())
      ) {
        return "Must be a valid UUID or alphanumeric ID (4-36 chars)";
      }
      return null;
    },
  });
}
