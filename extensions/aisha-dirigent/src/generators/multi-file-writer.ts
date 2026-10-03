/**
 * Write loop for adapters that emit MultiFileOutput.
 *
 * Held in its own file because:
 *   - executable scripts bypass safeWrite (HTML user-section markers don't
 *     belong in .sh / .mjs files — see file-safety.ts which always injects)
 *   - settings.json uses merge-json-keys semantics (deep merge with
 *     existing user entries, not full overwrite)
 *
 * generate-all.ts only contains safeWrite calls so the
 * ide-instructions-safety.gate constraint "generate-all writes only via
 * safeWrite" stays true; this file implements the raw + merge paths for
 * multi-file adapters via vscode.workspace.fs.
 *
 * @module
 */

import * as vscode from "vscode";
import { stripVolatile } from "./registry";
import { safeWrite, safeWriteExecutable } from "./file-safety";
import { mergeSettingsJson } from "./multi-file";
import type { MultiFileOutput } from "./multi-file";
import type { GenerateResult } from "./generate-all";

/**
 * Write a MultiFileOutput to the workspace. Per-file mode handling:
 *   - merge: "merge-json-keys" → deep merge JSON, preserve user entries
 *   - mode: "executable"       → safeWriteExecutable (backup + skip-identical;
 *                                 no HTML user-section marker — those are syntax
 *                                 errors in .sh/.mjs. vscode.workspace.fs has no
 *                                 chmod; settings.json command must invoke via
 *                                 shell: `bash path/to.sh` or `node path/to.mjs`)
 *   - default (markdown)       → safeWrite (user-section preserved, backup,
 *                                 auto-gen header required)
 */
export async function writeMultiFile(
  output: MultiFileOutput,
  adapterId: string,
  rootUri: vscode.Uri,
  result: GenerateResult,
): Promise<void> {
  for (const file of output.files) {
    try {
      const fileUri = vscode.Uri.joinPath(rootUri, file.path);

      let existingContent: string | null = null;
      try {
        const existing = await vscode.workspace.fs.readFile(fileUri);
        existingContent = new TextDecoder().decode(existing);
      } catch {
        // file doesn't exist yet
      }

      // merge: "merge-json-keys" — deep-merge into existing JSON (settings.json)
      if (file.merge === "merge-json-keys") {
        const merged = mergeSettingsJson(existingContent ?? "", file.content);
        if (existingContent === merged) {
          result.skipped.push(file.path);
          continue;
        }
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(merged));
        result.written.push(file.path);
        continue;
      }

      // Executable scripts (.sh / .mjs, incl. git-tracked + user-editable
      // .claude/hooks/* and .claude/statusline.sh) — route through
      // safeWriteExecutable for a timestamped backup before overwrite plus a
      // skip-when-byte-identical short-circuit. HTML user-section markers are
      // omitted (they would be syntax errors in shell/node), so the backup is
      // the content-loss guard. safeWriteExecutable reads the existing file
      // itself, so the pre-read above is unused on this path.
      if (file.mode === "executable") {
        const outcome = await safeWriteExecutable(rootUri, file.path, file.content);
        switch (outcome.outcome) {
          case "written":
            result.written.push(file.path);
            if (outcome.backupPath) result.backups.push(outcome.backupPath);
            break;
          case "skipped-identical":
            result.skipped.push(file.path);
            break;
          case "backup-failed":
            result.errors.push({
              adapter: `${adapterId}:${file.path}`,
              error: "backup-failed (write aborted)",
            });
            break;
        }
        continue;
      }

      // Default: safeWrite (markdown — preserves user-section, requires auto-gen header)
      if (
        existingContent !== null &&
        stripVolatile(existingContent) === stripVolatile(file.content)
      ) {
        result.skipped.push(file.path);
        continue;
      }
      const outcome = await safeWrite(rootUri, file.path, file.content, existingContent);
      switch (outcome.outcome) {
        case "written":
          result.written.push(file.path);
          if (outcome.preservedUserSection) result.preservedUserSections.push(file.path);
          if (outcome.backupPath) result.backups.push(outcome.backupPath);
          break;
        case "skipped-identical":
          result.skipped.push(file.path);
          break;
        case "refused-user-owned":
          result.refused.push(file.path);
          break;
        case "backup-failed":
          result.errors.push({
            adapter: `${adapterId}:${file.path}`,
            error: "backup-failed (write aborted)",
          });
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ adapter: `${adapterId}:${file.path}`, error: msg });
    }
  }
}
