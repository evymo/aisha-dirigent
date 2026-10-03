/**
 * @aisha/ide-bridge/safe-write — client-side safe file write primitive.
 *
 * Mirrors `scripts/lib/ide-instructions-safety.mjs` (existing CLI
 * primitive used by `npm run gen:ide`) but speaks the Phase 13 WP 13.2
 * template delimiters:
 *
 *   <!-- AISHA-MANAGED-START -->
 *      ...regenerated content...
 *   <!-- AISHA-MANAGED-END -->
 *
 *   <!-- USER-CUSTOM-START -->
 *      ...preserved across syncs...
 *   <!-- USER-CUSTOM-END -->
 *
 * Three guarantees:
 *   1. User-owned content between USER-CUSTOM-START/END is preserved on
 *      every sync (extracted from existing file, re-inserted into the
 *      freshly rendered template).
 *   2. Pre-existing files WITHOUT the AISHA-MANAGED-START marker are
 *      treated as user-owned — we PREPEND a delimiter-bounded AISHA
 *      block while preserving the original content below. NEVER
 *      overwrite a hand-authored file silently.
 *   3. Every write produces a timestamped backup in
 *      `<repo>/.aisha/backups/` (rotated to last N per file).
 *
 * The package is consumed by the `aisha-ide-bridge` CLI (this same
 * package, `bin/aisha-ide-bridge.ts`) and can be embedded into other
 * IDE plug-ins that need the same merge semantics.
 *
 * Per `feedback_agent_on_user_machine_safety.md` — every primitive
 * here must satisfy: detect-user-owned, preserve-user-section,
 * backup-before-write, auto-trigger opt-in.
 */
/* eslint-disable security/detect-non-literal-fs-filename --
 * This module IS the filesystem-writing primitive. Every fs sink here operates
 * on a path that is either (a) the result of assertWithinRoot() — containment-
 * checked against the operator's rootDir, blocking ../ traversal + absolute
 * escapes — or (b) the backups dir derived from that same rootDir. The rule's
 * variable-argument heuristic can't see the containment proof; the guard is the
 * mitigation. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";

// ─── Delimiter constants (mirror Phase 13 WP 13.2 templates) ─────────────────

export const AISHA_MANAGED_START = "<!-- AISHA-MANAGED-START -->";
export const AISHA_MANAGED_END = "<!-- AISHA-MANAGED-END -->";
export const USER_CUSTOM_START = "<!-- USER-CUSTOM-START -->";
export const USER_CUSTOM_END = "<!-- USER-CUSTOM-END -->";

/** Default backup retention per file. Operator overridable via config. */
export const DEFAULT_BACKUPS_PER_FILE = 5;

// ─── Outcome envelope ────────────────────────────────────────────────────────

export type SafeWriteOutcome =
  | "written"
  | "skipped-identical"
  | "appended-to-user-owned"
  | "backup-failed";

export interface SafeWriteResult {
  outcome: SafeWriteOutcome;
  absolutePath: string;
  /** Filename inside `.aisha/backups/` (not full path), populated when a backup was written. */
  backupFile?: string;
  /** True when an existing USER-CUSTOM block was carried into the new content. */
  preservedUserSection: boolean;
  /** True when the existing file lacked AISHA-MANAGED-START → we prepended a block. */
  treatedAsUserOwned: boolean;
}

export interface SafeWriteOptions {
  /** Root directory used for backup placement (`.aisha/backups/`). */
  rootDir: string;
  /** Path relative to rootDir, e.g. `CLAUDE.md`. */
  outputPath: string;
  /**
   * Freshly rendered content from svc-ide-context (must already include
   * the AISHA-MANAGED + USER-CUSTOM delimiter pairs — Phase 13 WP 13.2
   * templates do this by default).
   */
  newContent: string;
  /** Override the default backup retention (5). */
  backupsPerFile?: number;
  /**
   * When true (default), creates `<rootDir>/.aisha/backups/<file>.<ts>.bak`
   * before every write. Set false ONLY for tests in tmp dirs.
   */
  writeBackup?: boolean;
  /**
   * Override the equality check used to skip identical writes. Default
   * strips the volatile `<!-- generated_at … -->` substring so
   * timestamp-only changes don't churn the file.
   */
  contentEquals?: (existing: string, fresh: string) => boolean;
}

/** Thrown when an outputPath would resolve outside the operator's rootDir. */
export class PathEscapeError extends Error {
  constructor(rootDir: string, outputPath: string) {
    super(`safe-write refused: "${outputPath}" escapes rootDir "${rootDir}"`);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolve `outputPath` against `rootDir` and assert it stays inside it.
 * Blocks `../` traversal and absolute paths that point elsewhere. Returns the
 * resolved absolute path on success; throws PathEscapeError otherwise.
 */
export function assertWithinRoot(rootDir: string, outputPath: string): string {
  const root = path.resolve(rootDir);
  const abs = path.resolve(root, outputPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new PathEscapeError(rootDir, outputPath);
  }
  return abs;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Synchronously write `outputPath` with safe-merge semantics.
 *
 * Note: this is intentionally synchronous — the bridge sync loop fires
 * one file at a time per workspace; async would just add complexity
 * without throughput benefit at this scale.
 */
export function safeWriteSync(opts: SafeWriteOptions): SafeWriteResult {
  const {
    rootDir,
    outputPath,
    newContent,
    backupsPerFile = DEFAULT_BACKUPS_PER_FILE,
    writeBackup = true,
    contentEquals = defaultContentEquals,
  } = opts;

  // Containment guard: this is the designated "agent writes to the user's
  // workspace" primitive, exported for embedding in other IDE plug-ins. A
  // caller (now or future) that passes a `../escape` or absolute outputPath
  // must NOT be able to write outside rootDir. Resolve + assert before any FS op.
  const absPath = assertWithinRoot(rootDir, outputPath);
  const existed = existsSync(absPath);
  const existing = existed ? readFileSync(absPath, "utf8") : null;

  // (A) New file — straight write, no merge needed.
  if (existing === null) {
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, newContent);
    return {
      outcome: "written",
      absolutePath: absPath,
      preservedUserSection: false,
      treatedAsUserOwned: false,
    };
  }

  // (B) Existing file WITHOUT AISHA-MANAGED-START → user-owned.
  //     Prepend a delimiter-bounded AISHA block to the top, preserving
  //     the original content below verbatim. NEVER overwrite silently.
  if (!existing.includes(AISHA_MANAGED_START)) {
    const aishaBlock = extractAishaManagedBlock(newContent);
    if (aishaBlock === null) {
      // Fresh content doesn't have the delimiters either — degrade to
      // backup + skip. Should never happen with WP 13.2 templates, but
      // protects against operator-supplied custom templates that broke
      // the contract.
      return runBackupAndSkip(rootDir, outputPath, existing, absPath);
    }
    let backupFile: string | undefined;
    if (writeBackup) {
      try {
        backupFile = writeBackupSync(rootDir, outputPath, existing);
        rotateBackupsSync(rootDir, outputPath, backupsPerFile);
      } catch (err) {
        console.warn(`[aisha-ide-bridge] backup write failed before prepend: ${errMsg(err)}`);
        return {
          outcome: "backup-failed",
          absolutePath: absPath,
          preservedUserSection: false,
          treatedAsUserOwned: true,
        };
      }
    }
    const prepended = aishaBlock + "\n\n<!-- USER-CONTENT (preserved from your existing file) -->\n" + existing;
    writeFileSync(absPath, prepended);
    return {
      outcome: "appended-to-user-owned",
      absolutePath: absPath,
      backupFile,
      preservedUserSection: false,
      treatedAsUserOwned: true,
    };
  }

  // (C) Existing file HAS AISHA-MANAGED-START → standard merge: drop the
  //     stale AISHA block, splice in the new one, preserve USER-CUSTOM.
  const userSection = extractUserCustomSection(existing);
  let merged = newContent;
  let preserved = false;
  if (userSection !== null && userSection.trim().length > 0) {
    merged = replaceUserCustomSection(newContent, userSection);
    preserved = true;
  }

  if (contentEquals(existing, merged)) {
    return {
      outcome: "skipped-identical",
      absolutePath: absPath,
      preservedUserSection: preserved,
      treatedAsUserOwned: false,
    };
  }

  let backupFile: string | undefined;
  if (writeBackup) {
    try {
      backupFile = writeBackupSync(rootDir, outputPath, existing);
      rotateBackupsSync(rootDir, outputPath, backupsPerFile);
    } catch (err) {
      console.warn(`[aisha-ide-bridge] backup write failed before merge: ${errMsg(err)}`);
      return {
        outcome: "backup-failed",
        absolutePath: absPath,
        preservedUserSection: preserved,
        treatedAsUserOwned: false,
      };
    }
  }

  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, merged);

  return {
    outcome: "written",
    absolutePath: absPath,
    backupFile,
    preservedUserSection: preserved,
    treatedAsUserOwned: false,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the user-custom block (delimiter-EXCLUSIVE content between
 * USER-CUSTOM-START and USER-CUSTOM-END). Returns null when either
 * delimiter is missing.
 */
export function extractUserCustomSection(content: string): string | null {
  const openIdx = content.indexOf(USER_CUSTOM_START);
  if (openIdx === -1) return null;
  const afterOpen = openIdx + USER_CUSTOM_START.length;
  const closeIdx = content.indexOf(USER_CUSTOM_END, afterOpen);
  if (closeIdx === -1) return null;
  return content.slice(afterOpen, closeIdx);
}

/**
 * Extract the AISHA-managed block INCLUDING the delimiter markers
 * (for prepending into a user-owned file). Returns null when either
 * delimiter is missing.
 */
export function extractAishaManagedBlock(content: string): string | null {
  const openIdx = content.indexOf(AISHA_MANAGED_START);
  if (openIdx === -1) return null;
  const closeIdx = content.indexOf(AISHA_MANAGED_END, openIdx);
  if (closeIdx === -1) return null;
  return content.slice(openIdx, closeIdx + AISHA_MANAGED_END.length);
}

/**
 * Replace the USER-CUSTOM section content (delimiter-EXCLUSIVE) inside
 * `target`. Both delimiters MUST already exist in `target` (Phase 13
 * WP 13.2 templates ensure this).
 */
export function replaceUserCustomSection(target: string, userInner: string): string {
  const openIdx = target.indexOf(USER_CUSTOM_START);
  if (openIdx === -1) return target; // template regression, don't modify
  const afterOpen = openIdx + USER_CUSTOM_START.length;
  const closeIdx = target.indexOf(USER_CUSTOM_END, afterOpen);
  if (closeIdx === -1) return target;
  return target.slice(0, afterOpen) + userInner + target.slice(closeIdx);
}

/**
 * Default content-equality check: strips the volatile timestamp
 * substring (`generated_at: 2026-…Z`) before comparing, so two
 * back-to-back syncs of the same envelope don't churn the file.
 */
export function defaultContentEquals(a: string, b: string): boolean {
  const strip = (s: string): string =>
    s.replace(/generated_at:?\s*["']?[\d:T.-]+Z["']?/g, "generated_at:STRIPPED")
      .replace(/dynamic,?\s+generated\s+[\d:T.-]+Z/gi, "dynamic, generated STRIPPED")
      .replace(/Auto-generated by svc-ide-context at [\d:T.-]+Z/gi, "Auto-generated by svc-ide-context at STRIPPED");
  return strip(a) === strip(b);
}

function runBackupAndSkip(
  rootDir: string,
  outputPath: string,
  existing: string,
  absPath: string,
): SafeWriteResult {
  let backupFile: string | undefined;
  try {
    backupFile = writeBackupSync(rootDir, outputPath, existing);
  } catch (err) {
    // best-effort: log to stderr but don't escalate — we're already in
    // the degraded-skip path because the AISHA template lacked delimiters.
    console.warn(`[aisha-ide-bridge] best-effort backup failed: ${errMsg(err)}`);
  }
  return {
    outcome: "backup-failed",
    absolutePath: absPath,
    backupFile,
    preservedUserSection: false,
    treatedAsUserOwned: true,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown error";
  }
}

function writeBackupSync(
  rootDir: string,
  outputPath: string,
  content: string,
): string {
  const backupsDir = path.join(rootDir, ".aisha", "backups");
  mkdirSync(backupsDir, { recursive: true });
  const flat = outputPath.replace(/[/\\]/g, "__");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${flat}.${stamp}.bak`;
  writeFileSync(path.join(backupsDir, fileName), content);
  return fileName;
}

function rotateBackupsSync(rootDir: string, outputPath: string, retain: number): void {
  const backupsDir = path.join(rootDir, ".aisha", "backups");
  if (!existsSync(backupsDir)) return;
  const flat = outputPath.replace(/[/\\]/g, "__");
  const all = readdirSync(backupsDir)
    .filter((name) => name.startsWith(`${flat}.`) && name.endsWith(".bak"))
    .sort();
  const stale = all.slice(0, Math.max(0, all.length - retain));
  for (const name of stale) {
    try {
      unlinkSync(path.join(backupsDir, name));
    } catch {
      // best effort
    }
  }
}
