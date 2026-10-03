/**
 * Instruction cache — persists instruction payloads for offline generation.
 *
 * Stores the last payload with tier metadata in `.aisha/instruction-cache.json`.
 * When the backend is unavailable, the cached payload is used to regenerate
 * IDE instruction files without losing previously fetched rules.
 *
 * @module
 */

import * as vscode from "vscode";

import type { InstructionPayload } from "./generators/registry";

/** Instruction tier levels. */
export type InstructionTier = 1 | 2 | 3;

/** Cached instruction entry. */
export interface InstructionCacheEntry {
  /** Tier that produced this payload: 1=backend, 2=local LLM, 3=baseline. */
  tier: InstructionTier;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Ruleset fingerprint (from backend, if available). */
  fingerprint: string | null;
  /** The instruction payload. */
  payload: InstructionPayload;
}

const CACHE_DIR = ".aisha";
const CACHE_FILE = "instruction-cache.json";

function getCacheUri(rootUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(rootUri, CACHE_DIR, CACHE_FILE);
}

/**
 * Read the cached instruction entry from workspace.
 * Returns null if no cache exists or if parsing fails.
 */
export async function readInstructionCache(rootUri: vscode.Uri): Promise<InstructionCacheEntry | null> {
  try {
    const data = await vscode.workspace.fs.readFile(getCacheUri(rootUri));
    const parsed = JSON.parse(new TextDecoder().decode(data)) as InstructionCacheEntry;

    // Basic validation
    if (!parsed.tier || !parsed.payload || !parsed.generatedAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write an instruction entry to the workspace cache.
 */
export async function writeInstructionCache(
  rootUri: vscode.Uri,
  entry: InstructionCacheEntry,
): Promise<void> {
  const dirUri = vscode.Uri.joinPath(rootUri, CACHE_DIR);
  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // exists
  }

  const content = JSON.stringify(entry, null, 2) + "\n";
  await vscode.workspace.fs.writeFile(
    getCacheUri(rootUri),
    new TextEncoder().encode(content),
  );
}

/**
 * Check if the cache is stale (older than maxAge).
 */
export function isCacheStale(entry: InstructionCacheEntry, maxAgeMs: number): boolean {
  const age = Date.now() - new Date(entry.generatedAt).getTime();
  return age > maxAgeMs;
}
