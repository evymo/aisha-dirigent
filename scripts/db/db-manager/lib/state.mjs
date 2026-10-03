#!/usr/bin/env node
/**
 * DB Manager — State Management Module
 *
 * Core state-tracking utilities for the db-manager CLI.
 * Tracks changes to SQL source-of-truth files via MD5 hashes.
 *
 * Exported functions:
 * - hashContent(content) — deterministic MD5 hash
 * - loadState(stateFilePath) — read persisted state from disk
 * - saveState(stateFilePath, state) — write state to disk
 * - getChangedItems(currentItems, stateItems) — diff current vs saved
 *
 * @module
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Compute a deterministic MD5 hex digest for the given content.
 *
 * @param {string} content — raw file content (whitespace-sensitive by design)
 * @returns {string} 32-char lowercase hex MD5 hash
 */
export function hashContent(content) {
  return createHash("md5").update(content, "utf-8").digest("hex");
}

/**
 * Read a persisted state file from disk.
 *
 * @param {string} stateFilePath — absolute path to the JSON state file
 * @returns {Record<string, { hash: string; syncedAt?: string }>} items map, or empty object
 */
export function loadState(stateFilePath) {
  if (!existsSync(stateFilePath)) {
    return {};
  }
  try {
    const raw = readFileSync(stateFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    // Support both flat { name: { hash } } and wrapped { <category>: { name: { hash } } }
    if (typeof parsed === "object" && parsed !== null) {
      // If there's exactly one key whose value is an object of objects, unwrap it
      const keys = Object.keys(parsed);
      if (keys.length === 1 && typeof parsed[keys[0]] === "object" && parsed[keys[0]] !== null) {
        const inner = parsed[keys[0]];
        const firstVal = Object.values(inner)[0];
        if (firstVal && typeof firstVal === "object" && "hash" in firstVal) {
          return inner;
        }
      }
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist state to disk (atomic write with pretty JSON).
 *
 * @param {string} stateFilePath — absolute path to the JSON state file
 * @param {Record<string, { hash: string; syncedAt?: string }>} state — items map
 */
export function saveState(stateFilePath, state) {
  const dir = path.dirname(stateFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/**
 * Compare current items against persisted state and classify changes.
 *
 * @param {Record<string, string>} currentItems — map of name → content (raw SQL)
 * @param {Record<string, { hash: string }>} stateItems — persisted state map
 * @returns {{ added: string[]; modified: string[]; removed: string[]; unchanged: string[] }}
 */
export function getChangedItems(currentItems, stateItems) {
  const added = [];
  const modified = [];
  const unchanged = [];

  for (const [name, content] of Object.entries(currentItems)) {
    const hash = hashContent(content);
    if (!stateItems[name]) {
      added.push(name);
    } else if (stateItems[name].hash !== hash) {
      modified.push(name);
    } else {
      unchanged.push(name);
    }
  }

  const removed = Object.keys(stateItems).filter(
    (name) => !(name in currentItems)
  );

  return { added, modified, removed, unchanged };
}
